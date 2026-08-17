import type { Context } from '@deepseek-ai/cordis';
import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { Role, TaskMode } from '../domain/types.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { installRoleTools } from '../roles/toolsets.js';
import type { AgentModelOptions } from './dispatcher.js';

export type VPhase = 'w1-pre' | 'w1-supp' | 'p' | 'w2' | 'd' | 'w3' | 'summary';

export interface ChainOrchestration {
  chainId: string;
  phase: VPhase;
  sessionId: string | null;
  waitingOn: string | null;
}

export const R20_PHASE_ORDER: VPhase[] = ['w1-pre', 'w1-supp', 'p', 'w2', 'd', 'w3', 'summary'];

/** 每 phase 的期望建卡（w1-supp 可跳过）。 */
export const R20_PHASE_EXPECT: Record<VPhase, { assignee: Role; mode: TaskMode } | null> = {
  'w1-pre': { assignee: 'w', mode: 'file' },
  'w1-supp': { assignee: 'w', mode: 'external' }, // 按需；V 判断不需要时跳过
  p: { assignee: 'p', mode: 'openspec' },
  w2: { assignee: 'w', mode: 'kb' },
  d: { assignee: 'd', mode: 'align' },
  w3: { assignee: 'w', mode: 'kb' },
  summary: null,
};

interface AgentLike {
  followup(msg: { content: { type: string; text: string }[]; source: { kind: string } }): void;
  whenIdle(): Promise<void>;
  session: { events: Array<{ name?: string; arguments?: Record<string, unknown> }> };
}

export class VOrchestrator {
  private readonly kanban: KanbanService;
  private readonly agents: { create(o: unknown): Promise<{ agent: AgentLike }>; resume(o: unknown): Promise<{ agent: AgentLike }> };
  private readonly config: KanbanConfig;
  private readonly orchestrations: Map<string, ChainOrchestration>;
  private readonly wiki: WikiVaultClient;
  private readonly defaultModel: AgentModelOptions | undefined;
  constructor(
    kanban: KanbanService,
    agents: { create(o: unknown): Promise<{ agent: AgentLike }>; resume(o: unknown): Promise<{ agent: AgentLike }> },
    config: KanbanConfig,
    orchestrations: Map<string, ChainOrchestration>,
    wiki: WikiVaultClient,
    defaultModel?: AgentModelOptions,
  ) { this.kanban = kanban; this.agents = agents; this.config = config; this.orchestrations = orchestrations; this.wiki = wiki; this.defaultModel = defaultModel; }

  private currentPhase(chainId: string): ChainOrchestration {
    let o = this.orchestrations.get(chainId);
    if (!o) {
      o = { chainId, phase: 'w1-pre', sessionId: null, waitingOn: null };
      this.orchestrations.set(chainId, o);
    }
    return o;
  }

  async wakeV(chainId: string): Promise<void> {
    const orch = this.currentPhase(chainId);
    if (orch.phase === 'summary') return; // 链完成由 completeTask 机械规则产生
    const state = await this.kanban.snapshot();
    const chain = state.chains.get(chainId);
    if (!chain) throw new Error('unknown chain: ' + chainId);
    // P1-2：w1-pre 任务完成后，把预取产物挂到规格卡附件（幂等：规格卡已有 file-prefetch 附件则跳过）。
    // 挂载成功后规格卡才满足 /openspec: 批准前置校验（T10.5 validateSpecCardForApproval）。
    // 仅 draft 可挂附件（T10.5），批准后唤醒不误挂。
    const specCard = chain.specCardId ? state.specCards.get(chain.specCardId) : null;
    if (specCard && specCard.status === 'draft' && !specCard.attachments.some((a) => a.kind === 'file-prefetch')) {
      const w1pre = [...state.tasks.values()].find((t) => t.chainId === chainId && t.assignee === 'w' && t.mode === 'file');
      const w1Handoff = w1pre ? state.handoffs.get(w1pre.id) : null;
      if (w1pre && w1pre.status === 'done' && w1Handoff) {
        const ref = String(w1Handoff.metadata['ref'] ?? `/workspaces/${chainId}/${w1pre.id}`);
        await this.kanban.addSpecCardAttachment(specCard.id, { name: 'w1-pre repo facts', kind: 'file-prefetch', ref }, 'v');
      }
    }
    if (chain.status === 'completed' || chain.status === 'aborted') return;

    // B4 阶段门控：规格卡 approved（链 executing）之前，V 只处理阶段 0（w1-pre 建卡/挂附件），
    // 不推进 phase、不建执行链任务；draft 时 V 待命，等 spec-card/approved 事件唤醒（event-waker 已订阅）。
    const approved = chain.status === 'executing' && specCard?.status === 'approved';
    if (orch.phase !== 'w1-pre' && !approved) return;

    // w1-supp 为按需补充阶段：规格卡已含 W1-pre 附件（已覆盖）时由驱动直接跳过（不建卡）。
    if (orch.phase === 'w1-supp') {
      const fresh = await this.kanban.snapshot();
      const sc = chain.specCardId ? fresh.specCards.get(chain.specCardId) : null;
      if (sc && sc.attachments.some((a) => a.kind === 'file-prefetch')) {
        orch.phase = this.advance(orch.phase);
        orch.waitingOn = 'task/completed';
      }
    }

    const expect = R20_PHASE_EXPECT[orch.phase];
    if (expect === null) return; // summary：不再建卡

    // B6 幂等：当前 phase 期望卡（R20_PHASE_EXPECT 匹配 assignee+mode）已存在且未终态 → 不重复建卡直接待命
    // （防插件重启后重复建卡、V 一轮连发多卡）。
    const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chainId);
    const existing = chainTasks.find((t) => t.assignee === expect.assignee && t.mode === expect.mode);
    const terminal: ReadonlyArray<string> = ['done', 'archived'];
    if (existing && !terminal.includes(existing.status)) return;

    const context = [
      '# V 编排轮次（R20 逐阶段创建）',
      `chain=${chainId} phase=${orch.phase}`,
      `NEXT_TASK_ASSIGNEE=${expect.assignee} MODE=${expect.mode}`,
      specCard ? `## 规格卡\n${specCard.sections.problem}\n${specCard.sections.solution}` : '',
      '## 当前任务\n' + [...state.tasks.values()].filter((t) => t.chainId === chainId).map((t) => `${t.id} ${t.assignee}/${t.mode} ${t.status}`).join('\n'),
      '## 立即动作（本轮唯一任务）',
      `调用 kanban_create 创建本阶段唯一任务卡：chainId=${chainId}，assignee=${expect.assignee}，mode=${expect.mode}，title 自拟（如 "W1-pre 仓库预取"），body 写入任务说明。`,
      '规则：只创建一张卡（上一阶段完成事件后才进入下一阶段）；w1-supp 阶段若规格卡已覆盖则直接跳过（不建卡）；禁止跨阶段并行；禁止自己实现任务；不要调用 kanban_heartbeat/kanban_list 探测（看板状态已在上文给出）。',
    ].join('\n\n');

    const agent = await this.getVAgent(orch);
    agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
    await agent.whenIdle();

    // R4 建卡数量硬闸：一轮只允许一张期望匹配卡推进 phase——取第一张匹配卡，其余建卡不推进
    // （提取 kanban_create 调用；假实现从会话事件取，真实实现同名）。
    const creates = agent.session.events.filter((e) => e.name === 'kanban_create');
    const firstMatch = creates.find((e) => e.arguments?.['assignee'] === expect.assignee && e.arguments?.['mode'] === expect.mode);
    if (firstMatch) {
      orch.phase = this.advance(orch.phase);
      orch.waitingOn = 'task/completed';
    }
    // 不匹配：phase 不动，等待下一次事件重试（防 V 建错卡）
  }

  private advance(phase: VPhase): VPhase {
    const i = R20_PHASE_ORDER.indexOf(phase);
    return R20_PHASE_ORDER[Math.min(i + 1, R20_PHASE_ORDER.length - 1)];
  }

  private async getVAgent(orch: ChainOrchestration): Promise<AgentLike> {
    const agentOptions = this.modelOptions('v');
    // B3：resume 与 create 都传 setup——恢复的 V 会话同样装配角色工具面（agent scope 注册随会话重建），
    // 与 agent-runner.ts 的 installRoleTools 用法一致。
    const setup = async (agentCtx: Context): Promise<void> => {
      await installRoleTools(agentCtx, 'v', { kanban: this.kanban, wiki: this.wiki });
    };
    if (orch.sessionId) {
      const h = await this.agents.resume({ resumeSessionId: orch.sessionId, agentOptions, setup });
      return h.agent;
    }
    const h = await this.agents.create({
      sessionId: `kbn-v-${orch.chainId}`,
      meta: { cwd: this.workspaceDir() },
      agentOptions,
      setup,
    });
    orch.sessionId = `kbn-v-${orch.chainId}`;
    return h.agent;
  }

  private modelOptions(role: Role): AgentModelOptions | undefined {
    const m = this.config.roles?.models?.[role];
    if (m?.provider && m?.model) return { provider: m.provider, model: m.model };
    if (this.defaultModel?.provider && this.defaultModel?.model) {
      return this.defaultModel.reasoningEffort
        ? { provider: this.defaultModel.provider, model: this.defaultModel.model, reasoningEffort: this.defaultModel.reasoningEffort }
        : { provider: this.defaultModel.provider, model: this.defaultModel.model };
    }
    return undefined;
  }

  private workspaceDir(): string {
    return (this.config.storageDir ?? '').replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd());
  }
}

import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { Role, TaskMode } from '../domain/types.js';

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
  constructor(
    kanban: KanbanService,
    agents: { create(o: unknown): Promise<{ agent: AgentLike }>; resume(o: unknown): Promise<{ agent: AgentLike }> },
    config: KanbanConfig,
    orchestrations: Map<string, ChainOrchestration>,
  ) { this.kanban = kanban; this.agents = agents; this.config = config; this.orchestrations = orchestrations; }

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
    const specCard = chain.specCardId ? state.specCards.get(chain.specCardId) : null;
    if (specCard && !specCard.attachments.some((a) => a.kind === 'file-prefetch')) {
      const w1pre = [...state.tasks.values()].find((t) => t.chainId === chainId && t.assignee === 'w' && t.mode === 'file');
      const w1Handoff = w1pre ? state.handoffs.get(w1pre.id) : null;
      if (w1pre && w1pre.status === 'done' && w1Handoff) {
        const ref = String(w1Handoff.metadata['ref'] ?? `/workspaces/${chainId}/${w1pre.id}`);
        await this.kanban.addSpecCardAttachment(specCard.id, { name: 'w1-pre repo facts', kind: 'file-prefetch', ref }, 'v');
      }
    }
    if (chain.status === 'completed' || chain.status === 'aborted') return;

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
    const context = [
      '# V 编排轮次（R20 逐阶段创建）',
      `chain=${chainId} phase=${orch.phase}`,
      `NEXT_TASK_ASSIGNEE=${expect.assignee} MODE=${expect.mode}`,
      specCard ? `## 规格卡\n${specCard.sections.problem}\n${specCard.sections.solution}` : '',
      '## 当前任务\n' + [...state.tasks.values()].filter((t) => t.chainId === chainId).map((t) => `${t.id} ${t.assignee}/${t.mode} ${t.status}`).join('\n'),
      '规则：只创建一张卡（上一阶段完成事件后才进入下一阶段）；w1-supp 阶段若规格卡已覆盖则直接跳过（不建卡）；禁止跨阶段并行；禁止自己实现任务。',
    ].join('\n\n');

    const agent = await this.getVAgent(orch);
    agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
    await agent.whenIdle();

    // 校验 V 本轮建卡：提取 kanban_create 调用（假实现从会话事件取；真实实现同名）
    const creates = agent.session.events.filter((e) => e.name === 'kanban_create');
    const matched = creates.some((e) => e.arguments?.['assignee'] === expect.assignee && e.arguments?.['mode'] === expect.mode);
    if (matched) {
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
    const preset = this.config.roles?.personaPresets?.v ?? 'dsh-kanban/persona-v';
    if (orch.sessionId) {
      const h = await this.agents.resume({ resumeSessionId: orch.sessionId });
      return h.agent;
    }
    const h = await this.agents.create({
      sessionId: `kbn-v-${orch.chainId}`,
      meta: { agentPreset: preset },
      setup: () => { /* T15 注册 V 编排工具面（kanban_create/link/comment/show + spec_card_view） */ },
    });
    orch.sessionId = `kbn-v-${orch.chainId}`;
    return h.agent;
  }
}

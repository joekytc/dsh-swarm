import type { Context } from '@deepseek-ai/cordis';
import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { Role, TaskMode } from '../domain/types.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { installRoleTools } from '../roles/toolsets.js';
import { toolArgs, toolName } from './session-events.js';
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
  d: { assignee: 'd', mode: 'execute' }, // R20：D=执行者（实际写代码/git 提交推送），非只读对齐/校验
  w3: { assignee: 'w', mode: 'kb' },
  summary: null,
};

/** M5：每阶段建卡的 body 生成指令（角色定位确定性模板，消除 V 自由发挥导致的角色漂移）。
 *  P=计划者（绝不执行）、D=唯一执行者（TARGET_REPO 必须取自规格卡 file-prefetch 附件 ref，禁止回退/猜测）、
 *  W=KB/预取（绝不执行代码）。V 把对应模板写入 kanban_create 的 body。 */
const PHASE_INSTRUCTIONS: Partial<Record<VPhase, string>> = {
  'w1-pre': [
    '## W1-pre 任务体要求（仓库预取）',
    'body 写入仓库预取指令：只读获取目标仓库事实（本地路径/远端 URL/当前分支/未提交改动/目标文件基线），产出 manifest 写入交接 metadata.ref = 目标仓库绝对路径（供规格卡附件与 D 定位仓库）。',
  ].join('\n'),
  'w1-supp': [
    '## W1-supp 任务体要求（按需补充预取）',
    'body 写入补充预取指令：仅当规格卡事实覆盖不足时补充（external/kb 资料），原汁原味入交接。禁止任何 git/代码操作。',
  ].join('\n'),
  p: [
    '## P 阶段任务体要求（计划者，非执行者）',
    'body 写入规划指令：读规格卡 + W1-pre 仓库事实，产出 openspec 实施计划（proposal/design/tasks）写入任务工作区，complete 带 artifacts_path。',
    '铁律：P 是计划者，绝不执行任何 git/worktree/commit/push/代码改动；不得把执行步骤当作 P 的交付。',
  ].join('\n'),
  w2: [
    '## W2 阶段任务体要求（KB 同步）',
    'body 写入 KB 同步指令：读父任务交接（P 产物路径）→ wiki_write 同步为项目页 → complete(kb_url, page_path)。禁止任何 git/代码操作。',
  ].join('\n'),
  d: [
    '## D 阶段任务体要求（执行者，唯一，非只读对齐/校验）',
    'body 写入执行指令：执行规格卡 solution/testing —— git worktree/branch → 改代码/README → git commit → git push → 自检（跑测试/构建）并附产物证据（changed_files/commit_hash/push）。',
    'body 第一行以 TARGET_REPO=<真实仓库绝对路径> 声明目标仓库：必须取自规格卡 file-prefetch 附件 ref（W1-pre 交接的真实路径），禁止写 kanban 存储目录、禁止猜测回退。',
    '禁止把 D 任务体写成"只读对齐/校验/审核"类措辞——D 是唯一执行者，必须实际改代码并提交推送。',
  ].join('\n'),
  w3: [
    '## W3 阶段任务体要求（KB 收尾同步）',
    'body 写入 KB 收尾同步指令：读 D 交接 → wiki_write 同步 → complete(kb_url)。禁止任何 git/代码操作。',
  ].join('\n'),
};

interface AgentLike {
  followup(msg: { content: { type: string; text: string }[]; source: { kind: string } }): void;
  whenIdle(): Promise<void>;
  session: { events: Array<{ name?: string; arguments?: unknown }> };
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

    // 阶段推进循环（修复轮 6，举一反三）：跳过已完成（终态卡）阶段、按需跳过 w1-supp，
    // 停在需要建卡的阶段建卡并推进；避免「推进 phase 后不建下一卡」造成的流水线停滞。
    for (;;) {
      // B4 阶段门控（每轮按当前 phase 重查）：规格卡 approved（链 executing）之前，V 只处理 w1-pre。
      const approvedHere = chain.status === 'executing' && specCard?.status === 'approved';
      if (orch.phase !== 'w1-pre' && !approvedHere) return;

      // w1-supp 按需跳过：规格卡已含 W1-pre 附件（已覆盖）或已批准（事实已固化）时直接推进（不建卡）。
      if (orch.phase === 'w1-supp') {
        const fresh = await this.kanban.snapshot();
        const sc = chain.specCardId ? fresh.specCards.get(chain.specCardId) : null;
        if (sc && (sc.status === 'approved' || sc.attachments.some((a) => a.kind === 'file-prefetch'))) {
          orch.phase = this.advance(orch.phase);
          orch.waitingOn = 'task/completed';
          continue;
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
      // 仅当当前 phase 的 (assignee,mode) 在整个 R20 序列唯一时，"已终态 existing 卡 = 本阶段自己的卡已完成"
      // 才成立；w2/w3 同为 (w,kb) 时 existing 可能是上一阶段（w2）的卡，不能据此推进（否则 w3 被误跳过）。
      const sameExpectCount = R20_PHASE_ORDER.filter((p) => {
        const e = R20_PHASE_EXPECT[p];
        return e !== null && e.assignee === expect.assignee && e.mode === expect.mode;
      }).length;
      if (existing && terminal.includes(existing.status) && sameExpectCount === 1) {
        // 该阶段工作已完成但 phase 未推进（firstMatch 历史缺陷等）→ 直接推进并继续循环建下一阶段卡
        orch.phase = this.advance(orch.phase);
        orch.waitingOn = 'task/completed';
        continue;
      }

      const context = [
        '# V 编排轮次（R20 逐阶段创建）',
        `chain=${chainId} phase=${orch.phase}`,
        `NEXT_TASK_ASSIGNEE=${expect.assignee} MODE=${expect.mode}`,
        // M5：D 阶段额外注入 testing 段（执行指令依赖 solution/testing）；附件 ref 供 V 取真实仓库路径写 TARGET_REPO
        specCard ? `## 规格卡\n${specCard.sections.problem}\n${specCard.sections.solution}${orch.phase === 'd' ? '\n' + specCard.sections.testing : ''}\n附件：${specCard.attachments.map((a) => `${a.kind}:${a.ref}`).join(' | ') || '(无)'}` : '',
        '## 当前任务\n' + [...state.tasks.values()].filter((t) => t.chainId === chainId).map((t) => `${t.id} ${t.assignee}/${t.mode} ${t.status}`).join('\n'),
        '## 立即动作（本轮唯一任务）',
        `调用 kanban_create 创建本阶段唯一任务卡：chainId=${chainId}，assignee=${expect.assignee}，mode=${expect.mode}，title 自拟（如 \"W1-pre 仓库预取\"），body 按下述阶段要求撰写。`,
        PHASE_INSTRUCTIONS[orch.phase] ?? '',
        '规则：只创建一张卡（上一阶段完成事件后才进入下一阶段）；w1-supp 阶段若规格卡已覆盖则直接跳过（不建卡）；禁止跨阶段并行；禁止自己实现任务；不要调用 kanban_heartbeat/kanban_list 探测（看板状态已在上文给出）。',
      ].join('\n\n');

      const agent = await this.getVAgent(orch);
      agent.followup({ content: [{ type: 'text', text: context }], source: { kind: 'user' } });
      await agent.whenIdle();

      // R4 建卡数量硬闸：本轮只允许一张期望匹配卡推进 phase——取第一张匹配卡，其余建卡不推进
      // （提取 kanban_create 调用；假实现从会话事件取，真实实现同名）。
      // 修复轮 6：session.events 条目形态为 {type, data:{name, arguments}}，name 在 data 下且
      // arguments 是 JSON 字符串——统一经 toolName/toolArgs（src/dispatcher/session-events.ts）读取。
      const creates = agent.session.events.filter((e) => toolName(e) === 'kanban_create');
      const firstMatch = creates.find((e) => {
        const a = toolArgs(e);
        return a.assignee === expect.assignee && a.mode === expect.mode;
      });
      if (firstMatch) {
        orch.phase = this.advance(orch.phase);
        orch.waitingOn = 'task/completed';
      }
      // 建卡后停止本轮，等本阶段完成事件推进下一阶段（不跨阶段并行建卡）
      return;
    }
  }

  private advance(phase: VPhase): VPhase {
    const i = R20_PHASE_ORDER.indexOf(phase);
    return R20_PHASE_ORDER[Math.min(i + 1, R20_PHASE_ORDER.length - 1)];
  }

  private async getVAgent(orch: ChainOrchestration): Promise<AgentLike> {
    const agentOptions = this.modelOptions('v');
    // B3：resume 与 create 都传 setup——恢复的 V 会话同样装配角色工具面（agent scope 注册随会话重建），
    // 与 agent-runner.ts 的 installRoleTools 用法一致。
    // 修复轮 6：V 后台编排会话与 P/W/D 一致，显式设置 approval=never + sandbox=workspace-write，
    // 避免在无 preset 装配时因默认审批策略在后台无应答者而挂起（卡死调度器首轮 tick）。
    const setup = async (agentCtx: Context): Promise<void> => {
      const session = (agentCtx as unknown as { agent?: { session?: { append?(k: string, v: unknown): void } } }).agent?.session;
      session?.append?.('approval/policy', { policy: 'never', source: 'delegation' });
      session?.append?.('sandbox/mode', { mode: 'workspace-write', source: 'delegation' });
      // R21 对齐（2026-08-17）：V=butler·orchestrator 零执行能力——先挂 kanban-v 裁剪 preset
      // （组合仅 persona + agent-instructions，无 bash/fs/run_code/web/skill/delegation 等执行/探索工具），
      // 再注入 kanban/spec 工具面；从基座层面落实「V 只路由、不执行」。
      const presets = (agentCtx as { get?(n: string): unknown }).get?.('agentPresets') as
        | { mount(ctx: Context, id?: string): Promise<unknown> }
        | undefined;
      if (presets) {
        try {
          await presets.mount(agentCtx, 'kanban-v');
        } catch (err) {
          // preset 挂载失败不阻断：角色工具面仍注册，仅缺 persona/instructions 基座
          console.error('[dsh-kanban][debug] V preset mount failed kanban-v: ' + String(err));
        }
      }
      await installRoleTools(agentCtx, 'v', { kanban: this.kanban, wiki: this.wiki });
    };
    if (orch.sessionId) {
      // 修复轮 6：V 会话首轮创建后保持 live，resume 会抛 "cannot prepare session while it is live"。
      // 优先复用 agents registry 中仍 live 的会话（followup 续用），仅当会话已下线时才 resume。
      const live = (this.agents as { get?(id: string): AgentLike | undefined }).get?.(orch.sessionId);
      if (live) return live;
      const h = await this.agents.resume({ resumeSessionId: orch.sessionId, agentOptions, setup });
      return h.agent;
    }
    // M2(Q5)：V 编排会话同样创建在发起 /plan: 的主 agent 工作空间（Chain.workspaceDir），回退 kanban 存储
    const ws = await this.chainWorkspace(orch.chainId);
    const h = await this.agents.create({
      sessionId: `kbn-v-${orch.chainId}`,
      meta: { cwd: ws },
      agentOptions,
      setup,
    });
    orch.sessionId = `kbn-v-${orch.chainId}`;
    return h.agent;
  }

  /** M2(Q5)：链的 workspaceDir（发起 /plan: 的主 agent 工作空间），缺失回退 kanban 存储。 */
  private async chainWorkspace(chainId: string): Promise<string> {
    const state = await this.kanban.snapshot();
    return state.chains.get(chainId)?.workspaceDir ?? this.workspaceDir();
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

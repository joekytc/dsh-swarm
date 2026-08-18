// src/domain/kanban-service.ts
import type { EventStore } from './event-store.js';
import { project, applyTo } from './projection.js';
import { can, type Actor } from './permissions.js';
import type { AuditEvidence, BoardState, Chain, Handoff, KanbanEvent, SpecCard, SpecCardAttachment, SpecCardSections, Task, TaskMode, Role } from './types.js';
import { hasDeliveryEvidence } from './delivery-evidence.js';

export type KanbanListener = (event: KanbanEvent) => void;

let seqCounter = 0;
const nid = (p: string) => `${p}_${(++seqCounter).toString(36)}_${Date.now().toString(36)}`;

/** 看板领域门面：三界面（工具/CLI/UI）统一路由的唯一入口。 */
export class KanbanService {
  private state: BoardState;
  private readonly store: EventStore;
  private emitQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<KanbanListener>();
  // D23：链完成验收核对钩子（dispatcher 注入：读主会话事件/产物归属核对 → auditWarning）
  private onChainCompletedHook: ((chainId: string) => void | Promise<void>) | null = null;

  constructor(store: EventStore) {
    this.store = store;
    // P0-3：同步重投影，消除"构造后立即调用基于空状态"的竞态
    this.state = project(store.readAllSync());
  }

  private async emit(ev: Omit<KanbanEvent, 'seq'>): Promise<KanbanEvent> {
    let emitted: KanbanEvent | undefined;
    const pending = this.emitQueue.then(async () => {
      const candidate = applyTo(this.state, { ...ev, seq: -1 });
      const full = await this.store.append(ev);
      this.state = { ...candidate, events: [...candidate.events.slice(0, -1), full] };
      emitted = full;
      this.publish(full);
    });
    this.emitQueue = pending.catch(() => {});
    await pending;
    return emitted!;
  }

  /** D23：注入链完成核对钩子（由调度层设置；仅一个消费者）。 */
  setOnChainCompleted(hook: (chainId: string) => void | Promise<void>): void {
    this.onChainCompletedHook = hook;
  }

  /** T22：订阅持久化后的看板事件；返回解除订阅函数。listener 异常不影响已落盘状态。 */
  subscribe(listener: KanbanListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** T22：返回 seq >= 入参 的事件（与 EventStore.readSince 同为 inclusive 语义）。 */
  async eventsSince(seq: number): Promise<KanbanEvent[]> {
    return this.store.readSince(seq);
  }

  private publish(event: KanbanEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('[dsh-kanban] event listener failed', error);
      }
    }
  }

  private async chainOf(chainId: string): Promise<Chain> {
    const c = this.state.chains.get(chainId);
    if (!c) throw new Error('unknown chain: ' + chainId);
    return c;
  }

  async createChain(input: { title: string; ownerSessionId: string; workspaceDir?: string | null }, actor: Actor): Promise<Chain> {
    if (!can('create-chain', actor, null)) throw new Error('permission denied');
    const chain: Chain = { id: nid('ch'), title: input.title, status: 'planning', rootTaskId: null, specCardId: null, ownerSessionId: input.ownerSessionId, workspaceDir: input.workspaceDir ?? null, createdAt: Date.now() };
    await this.emit({ chainId: chain.id, taskId: null, kind: 'chain/created', payload: { ...chain }, author: actor, at: Date.now() });
    return chain;
  }

  async createSpecCard(chainId: string, sections: SpecCardSections, actor: Actor): Promise<SpecCard> {
    if (!can('spec-edit', actor, null)) throw new Error('permission denied');
    const card: SpecCard = { id: nid('sc'), chainId, status: 'draft', sections, attachments: [], rawDialogueRef: null, approvedAt: null, approvedBy: null };
    await this.emit({ chainId, taskId: null, kind: 'spec-card/created', payload: { ...card }, author: actor, at: Date.now() });
    return card;
  }

  async editSpecCard(cardId: string, sections: SpecCardSections, actor: Actor): Promise<SpecCard> {
    if (!can('spec-edit', actor, null)) throw new Error('permission denied');
    const card = this.state.specCards.get(cardId);
    if (!card || card.status !== 'draft') throw new Error('spec card not editable');
    const updated = { ...card, sections };
    await this.emit({ chainId: card.chainId, taskId: null, kind: 'spec-card/edited', payload: { ...updated }, author: actor, at: Date.now() });
    return updated;
  }

  async approveSpecCard(cardId: string, actor: Actor): Promise<SpecCard> {
    if (!can('spec-approve', actor, null)) throw new Error('permission denied');
    const card = this.state.specCards.get(cardId);
    if (!card) throw new Error('unknown spec card: ' + cardId);
    await this.emit({ chainId: card.chainId, taskId: null, kind: 'spec-card/approved', payload: { id: cardId }, author: actor, at: Date.now() });
    const updated = this.state.specCards.get(cardId)!;
    // 规格卡批准 → 链路进入 executing（语义正确的事件：chain/executing）
    await this.emit({ chainId: card.chainId, taskId: null, kind: 'chain/executing', payload: {}, author: actor, at: Date.now() });
    return updated;
  }

  async createTask(input: { chainId: string; title: string; body?: string; assignee: Role; mode: TaskMode; parents?: string[] }, actor: Actor): Promise<Task> {
    if (!can('create-task', actor, null)) throw new Error('permission denied');
    const chain = await this.chainOf(input.chainId);
    const task: Task = { id: nid('t'), chainId: input.chainId, title: input.title, body: input.body ?? '', assignee: input.assignee, status: 'todo', mode: input.mode, priority: 1, parents: input.parents ?? [], children: [], createdBy: actor === 'human' ? 'human' : 'v', attempts: 0, heartbeats: [], sessionId: '', reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'not-required' };
    task.sessionId = 'kbn-' + task.id; // 确定性会话 id：与角色会话 id 一致，供追踪定位与 resume
    await this.emit({ chainId: input.chainId, taskId: task.id, kind: 'task/created', payload: { ...task }, author: actor, at: Date.now() });
    if (chain.rootTaskId === null) {
      await this.emit({ chainId: input.chainId, taskId: task.id, kind: 'chain/root-task-set', payload: { rootTaskId: task.id }, author: actor, at: Date.now() });
    }
    return task;
  }

  async claimTask(taskId: string, actor: Actor): Promise<Task> {
    if (!can('claim', actor, null)) throw new Error('permission denied');
    const t = this.state.tasks.get(taskId);
    if (!t) throw new Error('unknown task: ' + taskId);
    await this.emit({ chainId: t.chainId, taskId, kind: 'task/claimed', payload: {}, author: actor, at: Date.now() });
    return this.state.tasks.get(taskId)!;
  }

  async completeTask(taskId: string, handoff: Handoff, actor: Actor, opts: { boundTaskId?: string } = {}): Promise<Task> {
    const t = this.state.tasks.get(taskId);
    if (!t) throw new Error('unknown task: ' + taskId);
    if (!can('complete', actor, t, opts)) throw new Error('permission denied');
    if (!handoff.summary.trim()) throw new Error('handoff summary required');
    // C2：D(execute) 完成必须带 git 产物证据（changed_files + commit/push 至少其一）——
    // 执行者语义硬校验；human 为信任锚（GUI 强制收尾）可豁免，但 C1 链完成门禁仍会拦截无证据链。
    if (t.assignee === 'd' && t.mode === 'execute' && actor !== 'human' && !hasDeliveryEvidence(handoff)) {
      throw new Error('delivery evidence required: D(execute) complete must carry changed_files + (commit_hash|push)');
    }
    await this.emit({ chainId: t.chainId, taskId, kind: 'task/completed', payload: { ...handoff }, author: actor, at: Date.now() });
    // P0-3 链完成机械规则：仅当「最后完成的执行任务是 W3（w/kb）且链上 D(execute) 已 done 且
    // 交付物证据满足（changed_files + commit/push）」且无未终态任务时 → 链 completed（不靠 agent 自觉）。
    // 收紧判据：中间阶段（如 P done 后 W2 尚未创建）无未终态任务也不得误收链。
    // C1：D(execute) 无产物证据 → 不判链完成（human 强制 complete 的 D 卡同样被拦截，防漂移被掩盖）。
    // 'align' 为旧链路兼容（只读对齐/校验语义已废弃，R20 起新卡一律 'execute'）。
    const terminal: Task['status'][] = ['done', 'archived'];
    const chain = this.state.chains.get(t.chainId);
    const chainTasks = [...this.state.tasks.values()].filter((x) => x.chainId === t.chainId);
    const openTasks = chainTasks.filter((x) => !terminal.includes(x.status));
    const dTask = chainTasks.find((x) => (x.mode === 'execute' || x.mode === 'align') && x.status === 'done');
    const dDone = !!dTask;
    const dEvidenceOk = dTask ? (dTask.mode === 'align' ? true : hasDeliveryEvidence(this.state.handoffs.get(dTask.id))) : false;
    const completedEvents = this.state.events.filter((e) => e.chainId === t.chainId && e.kind === 'task/completed' && e.taskId);
    const lastTask = completedEvents.length ? this.state.tasks.get(completedEvents[completedEvents.length - 1].taskId as string) : undefined;
    const w3Done = !!lastTask && lastTask.assignee === 'w' && lastTask.mode === 'kb' && dDone && dEvidenceOk;
    if (chain && chain.status === 'executing' && openTasks.length === 0 && w3Done) {
      await this.emit({ chainId: t.chainId, taskId: null, kind: 'chain/completed', payload: {}, author: 'system', at: Date.now() });
      // D23：链完成 → 调度层验收核对（主会话越权写产物 → chain/audit-warning）。
      // 钩子内异常不阻断 completeTask 本身（核对失败仅记录，链路仍 completed）。
      if (this.onChainCompletedHook) {
        try {
          await this.onChainCompletedHook(t.chainId);
        } catch (error) {
          console.error('[dsh-kanban] chain completion audit hook failed: ' + String(error));
        }
      }
    }
    return this.state.tasks.get(taskId)!;
  }

  /** D23：链完成验收核对发警告（仅 system/dispatcher 可发）。Chain 状态保持 completed。 */
  async auditWarning(chainId: string, evidence: AuditEvidence[], actor: Actor): Promise<KanbanEvent> {
    if (actor !== 'system') throw new Error('permission denied: only dispatcher may raise audit warnings');
    await this.chainOf(chainId);
    return this.emit({ chainId, taskId: null, kind: 'chain/audit-warning', payload: { evidence }, author: actor, at: Date.now() });
  }

  /** D23：用户确认产物归属（仅 human，GUI confirm-audit action）。放行最终汇报。 */
  async confirmAudit(chainId: string, actor: Actor): Promise<KanbanEvent> {
    if (!can('audit-confirm', actor, null)) throw new Error('permission denied');
    await this.chainOf(chainId);
    const audit = this.state.auditWarnings.get(chainId);
    if (!audit) throw new Error('no audit warning for chain: ' + chainId);
    return this.emit({ chainId, taskId: null, kind: 'chain/audit-confirmed', payload: {}, author: actor, at: Date.now() });
  }

  async blockTask(taskId: string, reason: string, actor: Actor, opts: { boundTaskId?: string } = {}): Promise<Task> {
    const t = this.state.tasks.get(taskId);
    if (!t) throw new Error('unknown task: ' + taskId);
    if (!can('block', actor, t, opts)) throw new Error('permission denied');
    if (!reason.trim()) throw new Error('block reason required');
    await this.emit({ chainId: t.chainId, taskId, kind: 'task/blocked', payload: { reason }, author: actor, at: Date.now() });
    return this.state.tasks.get(taskId)!;
  }

  async unblockTask(taskId: string, actor: Actor): Promise<Task> {
    const t = this.state.tasks.get(taskId);
    if (!t) throw new Error('unknown task: ' + taskId);
    if (!can('unblock', actor, t)) throw new Error('permission denied');
    await this.emit({ chainId: t.chainId, taskId, kind: 'task/unblocked', payload: {}, author: actor, at: Date.now() });
    return this.state.tasks.get(taskId)!;
  }

  async heartbeat(taskId: string, actor: Actor, opts: { boundTaskId?: string } = {}): Promise<Task> {
    const t = this.state.tasks.get(taskId);
    if (!t) throw new Error('unknown task: ' + taskId);
    if (!can('heartbeat', actor, t, opts)) throw new Error('permission denied');
    await this.emit({ chainId: t.chainId, taskId, kind: 'task/heartbeat', payload: {}, author: actor, at: Date.now() });
    return this.state.tasks.get(taskId)!;
  }

  /** 标记任务失败（runner 异常/心跳超时回收）；投影递增 attempts。重试由调度器重派（failed→claimed），达上限由看门狗熔断。 */
  async failTask(taskId: string, reason: string, actor: Actor): Promise<Task> {
    const t = this.state.tasks.get(taskId);
    if (!t) throw new Error('unknown task: ' + taskId);
    if (actor !== 'system') throw new Error('permission denied: only dispatcher may fail tasks');
    if (!reason.trim()) throw new Error('fail reason required');
    await this.emit({ chainId: t.chainId, taskId, kind: 'task/failed', payload: { reason }, author: actor, at: Date.now() });
    return this.state.tasks.get(taskId)!;
  }

  async comment(taskId: string, body: string, actor: Actor): Promise<KanbanEvent> {
    const t = this.state.tasks.get(taskId);
    if (!t) throw new Error('unknown task: ' + taskId);
    if (!can('comment', actor, t)) throw new Error('permission denied');
    return this.emit({ chainId: t.chainId, taskId, kind: 'task/commented', payload: { body }, author: actor, at: Date.now() });
  }

  async archiveTask(taskId: string, actor: Actor): Promise<Task> {
    const t = this.state.tasks.get(taskId);
    if (!t) throw new Error('unknown task: ' + taskId);
    if (!can('archive', actor, t)) throw new Error('permission denied');
    await this.emit({ chainId: t.chainId, taskId, kind: 'task/archived', payload: {}, author: actor, at: Date.now() });
    return this.state.tasks.get(taskId)!;
  }

  /** T10.5：仅 draft 规格卡可挂附件（V 挂 W1-pre 预取产物 / human GUI 上传）。 */
  async addSpecCardAttachment(cardId: string, attachment: SpecCardAttachment, actor: Actor): Promise<SpecCard> {
    const card = this.state.specCards.get(cardId);
    if (!card) throw new Error('unknown spec card: ' + cardId);
    if (!can('spec-attach', actor, null)) throw new Error('permission denied');
    if (card.status !== 'draft') throw new Error('spec card not editable');
    const updated = { ...card, attachments: [...card.attachments, attachment] };
    await this.emit({ chainId: card.chainId, taskId: null, kind: 'spec-card/edited', payload: { ...updated }, author: actor, at: Date.now() });
    return updated;
  }

  async snapshot(): Promise<BoardState> {
    // P0-3：重投影为权威（事件日志是唯一事实源；非法转换在此抛错）
    this.state = project(await this.store.readAll());
    return this.state;
  }

  async listTasks(opts: { assignee?: Role; status?: Task['status'] } = {}): Promise<Task[]> {
    return [...this.state.tasks.values()].filter((t) =>
      (opts.assignee === undefined || t.assignee === opts.assignee) &&
      (opts.status === undefined || t.status === opts.status));
  }
}

// src/domain/kanban-service.ts
import type { EventStore } from './event-store.js';
import { project, applyTo } from './projection.js';
import { can, type Actor } from './permissions.js';
import type { BoardState, Chain, Handoff, KanbanEvent, SpecCard, SpecCardAttachment, SpecCardSections, Task, TaskMode, Role } from './types.js';

export type KanbanListener = (event: KanbanEvent) => void;

let seqCounter = 0;
const nid = (p: string) => `${p}_${(++seqCounter).toString(36)}_${Date.now().toString(36)}`;

/** 看板领域门面：三界面（工具/CLI/UI）统一路由的唯一入口。 */
export class KanbanService {
  private state: BoardState;
  private readonly store: EventStore;
  private emitQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<KanbanListener>();

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

  async createChain(input: { title: string; ownerSessionId: string }, actor: Actor): Promise<Chain> {
    if (!can('create-chain', actor, null)) throw new Error('permission denied');
    const chain: Chain = { id: nid('ch'), title: input.title, status: 'planning', rootTaskId: null, specCardId: null, ownerSessionId: input.ownerSessionId, createdAt: Date.now() };
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
    const task: Task = { id: nid('t'), chainId: input.chainId, title: input.title, body: input.body ?? '', assignee: input.assignee, status: 'todo', mode: input.mode, priority: 1, parents: input.parents ?? [], children: [], createdBy: actor === 'human' ? 'human' : 'v', attempts: 0, heartbeats: [] };
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
    await this.emit({ chainId: t.chainId, taskId, kind: 'task/completed', payload: { ...handoff }, author: actor, at: Date.now() });
    // P0-3 链完成机械规则：本任务 done 后，若链上无未终态任务且链 executing → 链 completed（不靠 agent 自觉）
    const terminal: Task['status'][] = ['done', 'archived'];
    const chain = this.state.chains.get(t.chainId);
    const openTasks = [...this.state.tasks.values()].filter((x) => x.chainId === t.chainId && !terminal.includes(x.status));
    if (chain && chain.status === 'executing' && openTasks.length === 0) {
      await this.emit({ chainId: t.chainId, taskId: null, kind: 'chain/completed', payload: {}, author: 'system', at: Date.now() });
    }
    return this.state.tasks.get(taskId)!;
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

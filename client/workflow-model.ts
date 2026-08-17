import type { AuditEvidence, BoardState, Chain, Task } from '../src/domain/types.js';

export type WorkflowLineState = 'complete' | 'active' | 'pending' | 'blocked';

export interface TaskCardView {
  task: Task;
  phase: string;
  statusLabel: string;
  activityLabel: string;
  dependencyLabel: string;
  lineState: WorkflowLineState;
  selected: boolean;
  related: boolean;
}

export interface ChainWorkflowView {
  chain: Chain;
  tasks: TaskCardView[];
  blockedSummary: string | null;
  /** D23：链完成验收核对视图（completed 链若存在未确认的 audit-warning，UI 阻塞最终汇报）。 */
  audit: { warned: boolean; confirmed: boolean; evidenceCount: number; evidence: AuditEvidence[] } | null;
  sortRank: number;
  lastActivityAt: number;
}

const STATUS_LABEL: Record<Task['status'], string> = {
  triage: '分诊',
  todo: '待办',
  ready: '就绪',
  running: '执行中',
  blocked: '受阻',
  done: '完成',
  failed: '失败',
  archived: '已归档',
};

export function statusLabelOf(status: Task['status']): string {
  return STATUS_LABEL[status];
}

export function phaseOf(task: Task, ordered: Task[]): string {
  if (task.assignee === 'p') return 'P';
  if (task.assignee === 'd') return 'D';
  if (task.assignee === 'w' && task.mode === 'file') return 'W1-pre';
  if (task.assignee === 'w' && task.mode === 'external') return 'W1-supp';
  if (task.assignee === 'w' && task.mode === 'kb') {
    const dIndex = ordered.findIndex((value) => value.assignee === 'd');
    return dIndex >= 0 && ordered.indexOf(task) > dIndex ? 'W3' : 'W2';
  }
  return task.assignee.toUpperCase();
}

export function lineStateOf(task: Task, selectedTaskId: string | null): WorkflowLineState {
  if (task.status === 'blocked' || task.status === 'failed') return 'blocked';
  if (task.id === selectedTaskId || task.status === 'running') return 'active';
  if (task.status === 'done' || task.status === 'archived') return 'complete';
  return 'pending';
}

function taskOrder(tasks: Task[], state: BoardState): Task[] {
  const seq = new Map<string, number>();
  for (const ev of state.events) {
    if (ev.kind === 'task/created' && ev.taskId) seq.set(ev.taskId, ev.seq);
  }
  return [...tasks].sort((a, b) => {
    const aSeq = seq.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bSeq = seq.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aSeq - bSeq || a.id.localeCompare(b.id);
  });
}

function activityLabel(task: Task, state: BoardState, now: number): string {
  let lastAt = 0;
  for (const h of task.heartbeats) lastAt = Math.max(lastAt, h);
  for (const ev of state.events) {
    if (ev.taskId === task.id) lastAt = Math.max(lastAt, ev.at);
  }
  if (!lastAt) return '待启动';
  const diff = Math.max(0, now - lastAt);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function blockedSummary(chainId: string, state: BoardState): string | null {
  let latest: string | null = null;
  let latestSeq = -1;
  for (const ev of state.events) {
    if (ev.chainId !== chainId) continue;
    if (ev.kind === 'task/blocked' || ev.kind === 'task/failed') {
      if (ev.seq > latestSeq) {
        latestSeq = ev.seq;
        latest = String(ev.payload['reason'] ?? '');
      }
    }
  }
  return latest;
}

function relatedIds(state: BoardState, chainId: string, selectedTaskId: string): Set<string> {
  const set = new Set<string>();
  const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chainId);
  const byId = new Map(chainTasks.map((t) => [t.id, t]));
  const childrenBy = new Map<string, string[]>();
  for (const t of chainTasks) {
    for (const p of t.parents) {
      const list = childrenBy.get(p) ?? [];
      list.push(t.id);
      childrenBy.set(p, list);
    }
  }
  if (!byId.has(selectedTaskId)) return set;
  set.add(selectedTaskId);
  let frontier = [selectedTaskId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const t = byId.get(id);
      if (!t) continue;
      for (const p of t.parents) if (byId.has(p) && !set.has(p)) { set.add(p); next.push(p); }
      for (const c of childrenBy.get(id) ?? []) if (byId.has(c) && !set.has(c)) { set.add(c); next.push(c); }
    }
    frontier = next;
  }
  return set;
}

function sortRankOf(chain: Chain, tasks: Task[]): number {
  if (tasks.some((t) => t.status === 'blocked' || t.status === 'failed')) return 0;
  if (chain.status === 'executing') return 1;
  if (chain.status === 'planning') return 2;
  return 3;
}

/** T25/T32：纯投影 view model。UI 只消费该结果，不复制领域状态机。 */
export function deriveWorkflowBoard(
  state: BoardState,
  opts: { selectedTaskId: string | null; now: number; archivedOnly?: boolean },
): ChainWorkflowView[] {
  const archivedOnly = opts.archivedOnly ?? false;
  const views: ChainWorkflowView[] = [];
  for (const chain of state.chains.values()) {
    const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chain.id);
    // T32：归档链路（aborted，或全部任务已归档）默认折叠进“已完成”筛选，不混入活动视图
    const archived = chain.status === 'aborted' || (chainTasks.length > 0 && chainTasks.every((t) => t.status === 'archived'));
    // D17：选中任务所在链路即使整链归档也保留在活动视图，详情只读直到返回列表后移除
    const selectedInChain = opts.selectedTaskId != null && chainTasks.some((t) => t.id === opts.selectedTaskId);
    if (archived !== archivedOnly && !selectedInChain) continue;
    const ordered = taskOrder(chainTasks, state);
    const related = opts.selectedTaskId ? relatedIds(state, chain.id, opts.selectedTaskId) : new Set<string>();
    let lastActivityAt = chain.createdAt;
    for (const ev of state.events) {
      if (ev.chainId === chain.id) lastActivityAt = Math.max(lastActivityAt, ev.at);
    }
    const auditRec = state.auditWarnings.get(chain.id);
    views.push({
      chain,
      sortRank: sortRankOf(chain, chainTasks),
      lastActivityAt,
      blockedSummary: blockedSummary(chain.id, state),
      audit: auditRec
        ? {
            warned: true,
            confirmed: auditRec.confirmedAt !== null,
            evidenceCount: auditRec.evidence.length,
            evidence: auditRec.evidence,
          }
        : null,
      tasks: ordered.map((task) => ({
        task,
        phase: phaseOf(task, ordered),
        statusLabel: statusLabelOf(task.status),
        activityLabel: activityLabel(task, state, opts.now),
        // D15/D17：阻塞/失败任务优先展示阻塞原因，其余展示父依赖
        dependencyLabel: task.status === 'blocked' || task.status === 'failed'
          ? blockedSummary(chain.id, state) ?? ''
          : task.parents.map((id) => state.tasks.get(id)?.title ?? id).join(', '),
        lineState: lineStateOf(task, opts.selectedTaskId),
        selected: task.id === opts.selectedTaskId,
        related: opts.selectedTaskId === task.id || related.has(task.id),
      })),
    });
  }

  views.sort((a, b) => a.sortRank - b.sortRank || b.lastActivityAt - a.lastActivityAt);
  return views;
}

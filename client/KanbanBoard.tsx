import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardState, Handoff, Task } from '../src/domain/types.js';
import type { BoardClientSnapshot } from './board-store.js';
import { deriveWorkflowBoard, type ChainFilter } from './workflow-model.js';
import { WorkflowRail } from './WorkflowRail.js';
import { TaskDrawer } from './TaskDrawer.js';

/** 折叠面板默认全打开（用户决策）：只记录用户手动折叠的链路（collapsed 集合），未折叠即展开。 */
function defaultCollapsed(): Set<string> { return new Set(); }

/** T26/T27/T32：列表（多链路垂直轨道）↔ 原位任务详情切换；归档筛选、详情未读提示、乐观操作失败回滚后的可重试错误。
 *  折叠面板默认全打开：collapsed 集合只含用户手动折叠的链路，新链路默认展开。 */
export function KanbanBoard(props: {
  snapshot: BoardClientSnapshot;
  postAction(action: unknown): Promise<unknown>;
  /** purge 类操作无事件流，成功后需重拉权威快照。 */
  onResync?(): Promise<void>;
}) {
  const { board } = props.snapshot;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsed());
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<ChainFilter>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(() => history.state?.kanbanTaskId ?? null);
  const [failedAction, setFailedAction] = useState<{ taskId: string; action: unknown } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const saved = useRef<{ collapsed: string[]; scrollTop: number }>({ collapsed: [], scrollTop: 0 });
  const snapshotRef = useRef(props.snapshot);
  snapshotRef.current = props.snapshot;
  const detailOpenedSeq = useRef<number | null>(null);

  useEffect(() => {
    const onPop = () => {
      const id = history.state?.kanbanTaskId ?? null;
      detailOpenedSeq.current = id ? snapshotRef.current.lastSeq : null;
      setSelectedId(id);
      if (!id) {
        setCollapsed(new Set(saved.current.collapsed));
        requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = saved.current.scrollTop; });
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId) history.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const views = useMemo(
    () => (board ? deriveWorkflowBoard(board, { selectedTaskId: selectedId, now: Date.now(), statusFilter }) : []),
    [board, selectedId, statusFilter],
  );

  const runAction = async (action: unknown) => {
    try {
      await props.postAction(action);
    } catch {
      const a = action as { taskId?: string };
      setFailedAction({ taskId: a.taskId ?? '', action });
    }
  };

  /** 状态筛选：多选并集；再次点击取消选中。 */
  const toggleFilter = (f: ChainFilter) => {
    setStatusFilter((current) => {
      const next = new Set(current);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  };

  /** 折叠面板：点击链路标题切换折叠/展开（默认全打开，collapsed 记录手动折叠的链路）。 */
  const toggleChain = (chainId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(chainId)) next.delete(chainId); else next.add(chainId);
      return next;
    });
  };

  if (!board) {
    return <div className="dsh-kb-loading">加载看板…</div>;
  }

  const selectedView = selectedId
    ? views.flatMap((v) => v.tasks).find((v) => v.task.id === selectedId) ?? null
    : null;

  if (selectedView) {
    const task: Task = selectedView.task;
    const chain = board.chains.get(task.chainId)!;
    const specCard = chain.specCardId ? board.specCards.get(chain.specCardId) ?? null : null;
    const handoff = board.handoffs.get(task.id) ?? null;
    const parentHandoffs: Handoff[] = task.parents
      .map((id) => board.handoffs.get(id))
      .filter((h): h is Handoff => h !== undefined);
    const parentTasks: Task[] = task.parents
      .map((id) => board.tasks.get(id))
      .filter((t): t is Task => t !== undefined);
    const chainTasks = views.find((v) => v.chain.id === task.chainId)?.tasks ?? [];
    const selectedIndex = chainTasks.findIndex((v) => v.task.id === task.id);
    const related = chainTasks.filter((v) => v.related).map((v) => v.task);
    const upstream = related.filter((t) => chainTasks.findIndex((v) => v.task.id === t.id) < selectedIndex);
    const downstream = related.filter((t) => chainTasks.findIndex((v) => v.task.id === t.id) > selectedIndex);
    // T32：详情打开后到达的该任务新事件 → 头部未读提示，不自动切换 tab/列表
    const unreadCount = board.events.filter((e) => e.taskId === task.id && e.seq > (detailOpenedSeq.current ?? props.snapshot.lastSeq)).length;
    return (
      <TaskDrawer
        task={task}
        chain={chain}
        events={board.events}
        handoff={handoff}
        parentHandoffs={parentHandoffs}
        parentTasks={parentTasks}
        specCard={specCard}
        upstream={upstream}
        downstream={downstream}
        unreadCount={unreadCount}
        actionError={props.snapshot.actionError}
        readOnly={task.status === 'archived'}
        onRetry={failedAction && failedAction.taskId === task.id ? () => void runAction(failedAction.action) : undefined}
        onComment={(body) => void runAction({ type: 'comment', taskId: task.id, body })}
        onAction={(action) => void runAction(action)}
        onClose={() => history.back()}
      />
    );
  }

  const openTask = (taskId: string) => {
    detailOpenedSeq.current = props.snapshot.lastSeq;
    saved.current = { collapsed: [...collapsed], scrollTop: listRef.current?.scrollTop ?? 0 };
    history.pushState({ ...history.state, kanbanTaskId: taskId }, '');
    setSelectedId(taskId);
  };

  return (
    <div className="dsh-kb-tab-body" ref={listRef}>
      <div className="dsh-kb-toolbar">
        <input
          aria-label="搜索链路"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索链路/任务"
        />
      </div>
      <WorkflowRail
        chains={views}
        collapsedChainIds={collapsed}
        query={query}
        statusFilter={statusFilter}
        onToggleFilter={toggleFilter}
        onToggleChain={toggleChain}
        onOpenTask={openTask}
        onConfirmAudit={(chainId) => void runAction({ type: 'confirm-audit', chainId })}
        onRenameChain={(chainId, title) => void runAction({ type: 'rename', chainId, title })}
        onDeleteChain={async (chainId) => {
          // 直连 postAction：失败 throw 上抛删除弹窗展示（runAction 吞错仅服务 TaskDrawer 重试条）
          await props.postAction({ type: 'delete', chainId });
          await props.onResync?.();
        }}
      />
    </div>
  );
}

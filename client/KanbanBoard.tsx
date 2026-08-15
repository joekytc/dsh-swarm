import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardState, Handoff, Task } from '../src/domain/types.js';
import type { BoardClientSnapshot } from './board-store.js';
import { deriveWorkflowBoard } from './workflow-model.js';
import { WorkflowRail } from './WorkflowRail.js';
import { TaskDrawer } from './TaskDrawer.js';

function defaultExpanded(board: BoardState | null): string | null {
  if (!board) return null;
  const executing = [...board.chains.values()].filter((c) => c.status === 'executing');
  if (executing.length > 0) return executing[0].id;
  return board.chains.values().next().value?.id ?? null;
}

/** T26/T27：列表（多链路垂直轨道）↔ 原位任务详情切换；浏览器历史/Esc 返回。 */
export function KanbanBoard(props: {
  snapshot: BoardClientSnapshot;
  postAction(action: unknown): Promise<unknown>;
}) {
  const { board } = props.snapshot;
  const [expandedChainId, setExpandedChainId] = useState<string | null>(() => defaultExpanded(board));
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => history.state?.kanbanTaskId ?? null);
  const listRef = useRef<HTMLDivElement>(null);
  const saved = useRef<{ expandedChainId: string | null; scrollTop: number }>({ expandedChainId: null, scrollTop: 0 });

  useEffect(() => {
    const onPop = () => {
      const id = history.state?.kanbanTaskId ?? null;
      setSelectedId(id);
      if (!id) {
        setExpandedChainId(saved.current.expandedChainId);
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
    () => (board ? deriveWorkflowBoard(board, { selectedTaskId: selectedId, now: Date.now() }) : []),
    [board, selectedId],
  );

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
    const chainTasks = views.find((v) => v.chain.id === task.chainId)?.tasks ?? [];
    const selectedIndex = chainTasks.findIndex((v) => v.task.id === task.id);
    const related = chainTasks.filter((v) => v.related).map((v) => v.task);
    const upstream = related.filter((t) => chainTasks.findIndex((v) => v.task.id === t.id) < selectedIndex);
    const downstream = related.filter((t) => chainTasks.findIndex((v) => v.task.id === t.id) > selectedIndex);
    return (
      <TaskDrawer
        task={task}
        chain={chain}
        events={board.events}
        handoff={handoff}
        parentHandoffs={parentHandoffs}
        specCard={specCard}
        upstream={upstream}
        downstream={downstream}
        onComment={(body) => void props.postAction({ type: 'comment', taskId: task.id, body })}
        onAction={(action) => void props.postAction(action)}
        onClose={() => history.back()}
      />
    );
  }

  const openTask = (taskId: string) => {
    saved.current = { expandedChainId, scrollTop: listRef.current?.scrollTop ?? 0 };
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
        expandedChainId={expandedChainId}
        query={query}
        onExpand={setExpandedChainId}
        onOpenTask={openTask}
      />
    </div>
  );
}

import { useEffect, useMemo } from 'react';
import { createBoardStore, type BoardStore } from './board-store.js';
import { useKanbanBoard } from './useKanbanBoard.js';
import { KanbanBoard } from './KanbanBoard.js';
import { ConnectionBanner } from './ConnectionBanner.js';

/** T30：会话中心 conversation.view 第三个 tab（对话→轨迹→看板）。全高布局，无浮层/拖拽/宽度记忆。 */
export function KanbanTab(props: { store?: BoardStore } = {}) {
  const own = useMemo(() => props.store ?? createBoardStore(), [props.store]);
  const snapshot = useKanbanBoard(own);

  useEffect(() => {
    if (props.store) return;
    void own.start();
    return () => { own.stop(); };
  }, [own, props.store]);

  return (
    <div className="dsh-kb-tab" role="region" aria-label="看板">
      <ConnectionBanner connection={snapshot.connection} lastSuccessAt={snapshot.lastSuccessAt} onRetry={() => void own.retry()} />
      {snapshot.board
        ? <KanbanBoard snapshot={snapshot} postAction={(action) => own.postAction(action)} />
        : <div className="dsh-kb-loading">加载看板…</div>}
    </div>
  );
}

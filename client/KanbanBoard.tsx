import { useState } from 'react';
import type { Chain, SpecCard, Task } from '../src/domain/types.js';
import { foldBoard, type BoardColumn } from './board-fold.js';
import { BoardCard } from './BoardCard.js';
import { TaskDrawer } from './TaskDrawer.js';

const COLUMNS: Array<{ key: BoardColumn; label: string }> = [
  { key: 'todo', label: '待办' },
  { key: 'running', label: '执行中' },
  { key: 'blocked', label: '受阻' },
  { key: 'failed', label: '失败' },
  { key: 'done', label: '完成' },
];

/** 看板页面（T17/T18）：列/卡 + 抽屉（轨迹/评论/交接证据/规格卡）。 */
export function KanbanBoard(props: {
  tasks: Task[]; chains: Chain[]; specCards: SpecCard[]; events: Array<{ seq: number; chainId: string; taskId: string | null; kind: string; author: string; at: number; payload: Record<string, unknown> }>;
  onAction(action: { type: 'block' | 'unblock' | 'archive' | 'complete'; taskId: string }): void;
  onComment(taskId: string, body: string): void;
}) {
  const { tasks, chains, specCards, events } = props;
  const [openId, setOpenId] = useState<string | null>(null);
  const board = foldBoard(tasks);
  const chainById = new Map(chains.map((c) => [c.id, c]));
  const specById = new Map(specCards.map((s) => [s.id, s]));
  const openTask = openId ? tasks.find((t) => t.id === openId) ?? null : null;
  const openChain = openTask ? chainById.get(openTask.chainId) : undefined;
  const openSpec = openChain?.specCardId ? specById.get(openChain.specCardId) ?? null : null;
  const openHandoff = null; // 交接证据由事件流提供（handoffs 经事件溯源投影，接入时注入）
  return (
    <div className="kanban-board">
      <div className="kanban-columns">
        {COLUMNS.map((col) => (
          <div key={col.key} className="kanban-column" data-column={col.key}>
            <h3>{col.label} <span className="count">{board.columns[col.key].length}</span></h3>
            {board.columns[col.key].map((t) => {
              const chain = chainById.get(t.chainId);
              const spec = chain?.specCardId ? specById.get(chain.specCardId) ?? null : null;
              return chain
                ? <BoardCard key={t.id} task={t} chain={chain} specCard={spec} onOpen={() => setOpenId(t.id)} />
                : null;
            })}
          </div>
        ))}
      </div>
      {openTask && openChain && (
        <TaskDrawer
          task={openTask}
          events={events as never}
          handoff={openHandoff}
          specCard={openSpec}
          onComment={(body) => props.onComment(openTask.id, body)}
          onAction={(a) => props.onAction(a as never)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

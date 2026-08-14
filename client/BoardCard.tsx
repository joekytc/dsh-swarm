import type { Chain, SpecCard, Task } from '../src/domain/types.js';

export const ROLE_COLOR: Record<Task['assignee'], string> = { v: '#3b82f6', p: '#a855f7', w: '#22c55e', d: '#f97316' };

export function BoardCard(props: { task: Task; chain: Chain; specCard: SpecCard | null; onOpen: (task: Task) => void }) {
  const { task, chain, specCard } = props;
  const doneChildren = task.children.filter(() => true).length; // 完整 N/M 由 foldBoard 注入；此处占位
  return (
    <button className="board-card" onClick={() => props.onOpen(task)} style={{ borderLeft: `4px solid ${ROLE_COLOR[task.assignee]}` }}>
      <div className="board-card-head">
        <span className="badge role" style={{ background: ROLE_COLOR[task.assignee] }}>{task.assignee.toUpperCase()}</span>
        <span className="badge mode">{task.mode}</span>
        <span className="badge chain" style={{ background: chain.status === 'executing' ? '#0ea5e9' : '#64748b' }}>{chain.title.slice(0, 8)}</span>
      </div>
      <div className="board-card-title">{task.title}</div>
      <div className="board-card-meta">
        {task.heartbeats.length > 0 && <span>{Math.round((Date.now() - task.heartbeats.at(-1)!) / 1000)}s</span>}
        {specCard && <span>📋 spec</span>}
        <span>{task.id}</span>
        {doneChildren > 0 && <span>{doneChildren} ✓</span>}
      </div>
    </button>
  );
}

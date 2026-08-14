import type { Handoff, KanbanEvent, SpecCard, Task } from '../src/domain/types.js';

export function TaskDrawer(props: {
  task: Task; events: KanbanEvent[]; handoff: Handoff | null; specCard: SpecCard | null;
  onComment(body: string): void; onAction(action: { type: string; taskId: string }): void; onClose(): void;
}) {
  const { task, events, handoff, specCard } = props;
  const timeline = events.filter((e) => e.taskId === task.id);
  const comments = timeline.filter((e) => e.kind === 'task/commented');
  return (
    <div className="task-drawer">
      <header><strong>{task.title}</strong> <span>{task.id}</span><button onClick={props.onClose}>×</button></header>
      <section>
        <h4>轨迹时间线</h4>
        <ol>{timeline.map((e) => <li key={e.seq}><code>{e.kind}</code> @{e.at} by {e.author}</li>)}</ol>
      </section>
      {handoff && (
        <section>
          <h4>交接证据</h4>
          <p>{handoff.summary}</p>
          {Object.entries(handoff.metadata).map(([k, v]) => (
            <p key={k}><strong>{k}:</strong> <code>{typeof v === 'string' ? v : JSON.stringify(v)}</code></p>
          ))}
        </section>
      )}
      {specCard && (
        <section>
          <h4>规格卡</h4>
          <p><strong>Problem:</strong> {specCard.sections.problem}</p>
          <p><strong>Testing:</strong> {specCard.sections.testing}</p>
        </section>
      )}
      <section>
        <h4>评论线程</h4>
        {comments.map((c, i) => <p key={i}><strong>{c.author}:</strong> {String(c.payload['body'])}</p>)}
        <input placeholder="评论…" onKeyDown={(e) => { if (e.key === 'Enter') { props.onComment((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }} />
      </section>
      <section>
        <h4>状态操作</h4>
        <button onClick={() => props.onAction({ type: 'block', taskId: task.id })}>block</button>
        <button onClick={() => props.onAction({ type: 'unblock', taskId: task.id })}>unblock</button>
        <button onClick={() => props.onAction({ type: 'archive', taskId: task.id })}>archive</button>
      </section>
    </div>
  );
}

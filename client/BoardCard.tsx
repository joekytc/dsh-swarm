import type { TaskCardView } from './workflow-model.js';

/** T26：双行 Profile 任务卡。Profile 只用于头像/节点强调，不整卡染色。 */
export function BoardCard(props: { view: TaskCardView; onOpen: (taskId: string) => void }) {
  const { view } = props;
  const { task } = view;
  return (
    <button
      type="button"
      className={`dsh-kb-task dsh-kb-task--${view.lineState}`}
      data-selected={view.selected || undefined}
      onClick={() => props.onOpen(task.id)}
      aria-label={`${view.phase} ${task.title} ${view.statusLabel}`}
    >
      <span className={`dsh-kb-profile dsh-kb-profile--${task.assignee}`}>{task.assignee.toUpperCase()}</span>
      <span className="dsh-kb-task__title">{task.title}</span>
      <span className="dsh-kb-task__status">{view.statusLabel}</span>
      <span className="dsh-kb-task__meta">
        {view.phase} · {view.activityLabel}{view.dependencyLabel ? ` · ${view.dependencyLabel}` : ''}
      </span>
    </button>
  );
}

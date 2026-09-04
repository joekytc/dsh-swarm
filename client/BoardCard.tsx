import type { TaskCardView } from './workflow-model.js';
import { openSession, useSessionIds } from './session-bridge.js';

/** T26：双行 Profile 任务卡。Profile 只用于头像/节点强调，不整卡染色。
 *  角色卡标题不可改（仅需求链标题可改），根元素为 div role=button。
 *  「会话」按钮：真实会话（resumeSessionId ?? sessionId）在宿主列表时显示，点击应用内跳转，不触发开详情。 */
export function BoardCard(props: { view: TaskCardView; onOpen: (taskId: string) => void }) {
  const { view } = props;
  const { task } = view;
  const blocked = view.lineState === 'blocked' && view.dependencyLabel.length > 0;
  const sessionIds = useSessionIds();
  const sessionId = task.resumeSessionId ?? task.sessionId;
  return (
    <div
      role="button"
      tabIndex={0}
      className={`dsh-kb-task dsh-kb-task--${view.lineState}${view.related ? ' dsh-kb-task--related' : ''}`}
      data-selected={view.selected || undefined}
      onClick={() => props.onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onOpen(task.id); }
      }}
      aria-label={`${view.phase} ${task.title} ${view.statusLabel}`}
    >
      <span className={`dsh-kb-profile dsh-kb-profile--${task.assignee}`}>{task.assignee.toUpperCase()}</span>
      <span className="dsh-kb-task__title">{task.title}</span>
      <span className="dsh-kb-task__status-row">
        {sessionIds.has(sessionId) && (
          <button
            type="button"
            className="dsh-kb-task__session"
            onClick={(e) => { e.stopPropagation(); openSession(sessionId); }}
            onKeyDown={(e) => { e.stopPropagation(); }}
          >
            会话
          </button>
        )}
        <span className="dsh-kb-task__status">{view.statusLabel}</span>
      </span>
      <span className="dsh-kb-task__meta">
        {view.phase} · {view.activityLabel}{!blocked && view.dependencyLabel ? ` · ${view.dependencyLabel}` : ''}
      </span>
      {blocked && (
        <span className="dsh-kb-task__warn">
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M8 1.5 14.5 13.5h-13L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M8 6.2v3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11.6" r="0.9" fill="currentColor" />
          </svg>
          <span>{view.dependencyLabel}</span>
        </span>
      )}
    </div>
  );
}

import type { ChainWorkflowView } from './workflow-model.js';
import { BoardCard } from './BoardCard.js';

function matches(view: ChainWorkflowView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (view.chain.title.toLowerCase().includes(q)) return true;
  return view.tasks.some((item) => item.task.title.toLowerCase().includes(q));
}

/** T26/T32：多链路垂直轨道。活动链路展开、阻塞链路折叠时仍露出警告摘要；搜索命中期间临时展开；“已完成”筛选切换归档视图。 */
export function WorkflowRail(props: {
  chains: ChainWorkflowView[];
  expandedChainId: string | null;
  query: string;
  archivedOnly: boolean;
  onToggleArchived(): void;
  onExpand(chainId: string): void;
  onOpenTask(taskId: string): void;
}) {
  const searching = props.query.trim().length > 0;
  return (
    <div className="dsh-kb-rail">
      <label className="dsh-kb-filter">
        <input type="checkbox" checked={props.archivedOnly} onChange={props.onToggleArchived} aria-label="显示已完成链路" />
        <span>已完成</span>
      </label>
      <div className="dsh-kb-rail__list" role="list" aria-label="任务链路">
        {props.chains.map((view) => {
          if (!matches(view, props.query)) return null;
          const matched = searching ? view.tasks.filter((item) => item.task.title.toLowerCase().includes(props.query.trim().toLowerCase())) : view.tasks;
          const expanded = searching || view.chain.id === props.expandedChainId;
          const done = view.tasks.filter((item) => item.task.status === 'done' || item.task.status === 'archived').length;
          const blocked = view.tasks.some((item) => item.task.status === 'blocked' || item.task.status === 'failed');
          const summary = view.blockedSummary ?? (blocked ? '链路受阻' : `${done}/${view.tasks.length}`);
          return (
            <section key={view.chain.id} className={`dsh-kb-chain dsh-kb-chain--${view.chain.status}`}>
              <button
                type="button"
                className="dsh-kb-chain__title"
                aria-expanded={expanded}
                onClick={() => props.onExpand(view.chain.id)}
              >
                <span className="dsh-kb-chain__name">{view.chain.title}</span>
                <span className="dsh-kb-chain__meta">{done}/{view.tasks.length}</span>
              </button>
              {(blocked || view.blockedSummary) && (
                <div className="dsh-kb-chain__warning">{summary}</div>
              )}
              {expanded && (
                <ol className="dsh-kb-nodes">
                  {(matched.length > 0 ? matched : view.tasks).map((item) => (
                    <li key={item.task.id} className={`dsh-kb-node dsh-kb-node--${item.lineState}`}>
                      <BoardCard view={item} onOpen={props.onOpenTask} />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

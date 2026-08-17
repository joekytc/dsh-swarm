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
  /** D23：用户 GUI 确认链完成产物归属（POST /kanban/action {type:'confirm-audit'}）。 */
  onConfirmAudit?(chainId: string): void;
}) {
  const searching = props.query.trim().length > 0;
  const visible = props.chains.filter((view) => matches(view, props.query));
  return (
    <div className="dsh-kb-rail">
      <label className="dsh-kb-filter">
        <input type="checkbox" checked={props.archivedOnly} onChange={props.onToggleArchived} aria-label="显示已完成链路" />
        <span>已完成</span>
      </label>
      <div className="dsh-kb-rail__list" role="list" aria-label="任务链路">
        {visible.length === 0 ? (
          <div className="dsh-kb-empty" role="status">
            {searching ? '无匹配链路' : '暂无看板任务，输入 /plan: 开启新链路'}
          </div>
        ) : visible.map((view) => {
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
              {/* D23：completed 链存在未确认 audit-warning → 顶部警告行 + 确认按钮（阻塞最终汇报直至确认） */}
              {view.audit && !view.audit.confirmed && (
                <div className="dsh-kb-chain__warning dsh-kb-chain__audit">
                  <span>⚠ 主 agent 疑似越权写工作区产物（{view.audit.evidenceCount} 条线索），最终汇报已阻塞，请核对产物归属</span>
                  <button type="button" className="dsh-kb-audit-confirm" onClick={() => props.onConfirmAudit?.(view.chain.id)}>
                    确认产物归属
                  </button>
                </div>
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

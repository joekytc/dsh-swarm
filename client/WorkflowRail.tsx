import { useState } from 'react';
import { CHAIN_FILTERS, CHAIN_FILTER_LABEL, type ChainFilter, type ChainWorkflowView } from './workflow-model.js';
import { BoardCard } from './BoardCard.js';
import { RenameModal } from './RenameModal.js';

function matches(view: ChainWorkflowView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (view.chain.title.toLowerCase().includes(q)) return true;
  return view.tasks.some((item) => item.task.title.toLowerCase().includes(q));
}

/** T26/T32：多链路垂直轨道。折叠面板默认全打开（collapsed 集合只含手动折叠链路）；阻塞链路折叠时仍露出警告摘要；搜索命中期间临时展开；“已完成”筛选切换归档视图。
 *  T7：链标题行右侧铅笔改名（div role=button 内嵌按钮，避免 button-in-button）。 */
export function WorkflowRail(props: {
  chains: ChainWorkflowView[];
  /** 用户手动折叠的链路集合；不在集合内即展开（默认全打开）。 */
  collapsedChainIds: ReadonlySet<string>;
  query: string;
  /** 链路状态筛选（多选并集；空=默认视图）。 */
  statusFilter: ReadonlySet<ChainFilter>;
  onToggleFilter(filter: ChainFilter): void;
  onToggleChain(chainId: string): void;
  onOpenTask(taskId: string): void;
  /** 会话跳转后切回对话视图：透传给 BoardCard，由宿主 conversation shell owner props（openView）下发。 */
  onOpenView?(view: string, focus: string): void;
  /** D23：用户 GUI 确认链完成产物归属（POST /kanban/action {type:'confirm-audit'}）。 */
  onConfirmAudit?(chainId: string): void;
  /** T7：GUI 链标题改名（POST /kanban/action {type:'rename', chainId, title}）。 */
  onRenameChain?(chainId: string, title: string): void;
  /** 整链硬删除（POST /kanban/action {type:'delete', chainId}）；失败 throw 由弹窗展示。 */
  onDeleteChain?(chainId: string): Promise<void>;
  /** 人工恢复被 blocked 的链（POST /kanban/action {type:'reopen-chain', chainId, reason}）；失败 throw 由弹窗展示。 */
  onReopenChain?(chainId: string, reason: string): Promise<void>;
}) {
  const searching = props.query.trim().length > 0;
  const visible = props.chains.filter((view) => matches(view, props.query));
  const [renamingChainId, setRenamingChainId] = useState<string | null>(null);
  const renamingChain = renamingChainId ? props.chains.find((v) => v.chain.id === renamingChainId)?.chain : undefined;
  const [deletingChainId, setDeletingChainId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // 2026-09-15 恢复能力：blocked 链 → 人工恢复（理由必填，审计留痕）。
  const [reopeningChainId, setReopeningChainId] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenOk, setReopenOk] = useState(false);
  const reopeningView = reopeningChainId ? props.chains.find((v) => v.chain.id === reopeningChainId) : undefined;
  const closeReopen = () => {
    setReopeningChainId(null);
    setReopenReason('');
    setReopenError(null);
    setReopenOk(false);
  };
  /** 校验必给反馈（此前按钮 disabled 且无禁用样式 → 用户点击毫无反应）；请求在途禁用防重复；成功后显式提示。 */
  const confirmReopen = async () => {
    if (!reopeningChainId) return;
    if (!reopenReason.trim()) {
      setReopenError('请填写恢复理由（必填，用于审计留痕）');
      return;
    }
    setReopenError(null);
    setReopenBusy(true);
    try {
      await props.onReopenChain?.(reopeningChainId, reopenReason.trim());
      setReopenOk(true); // 明确成功反馈，800ms 后自动关闭
      window.setTimeout(() => closeReopen(), 800);
    } catch (err) {
      setReopenError('恢复失败：' + String(err)); // 失败保留弹窗，理由可改后重试
    } finally {
      setReopenBusy(false);
    }
  };
  const deletingView = deletingChainId ? props.chains.find((v) => v.chain.id === deletingChainId) : undefined;
  const confirmDelete = async () => {
    if (!deletingChainId) return;
    setDeleteError(null);
    try {
      await props.onDeleteChain?.(deletingChainId);
      setDeletingChainId(null);
    } catch (err) {
      setDeleteError(String(err));
    }
  };
  return (
    <div className="dsh-kb-rail">
      <div className="dsh-kb-filters" role="group" aria-label="按链路状态筛选">
        {CHAIN_FILTERS.map((f) => {
          const active = props.statusFilter.has(f);
          return (
            <button
              key={f}
              type="button"
              className={`dsh-kb-filter${active ? ' dsh-kb-filter--active' : ''}`}
              aria-pressed={active}
              onClick={() => props.onToggleFilter(f)}
            >
              {CHAIN_FILTER_LABEL[f]}
            </button>
          );
        })}
      </div>
      <div className="dsh-kb-rail__list" role="list" aria-label="任务链路">
        {visible.length === 0 ? (
          <div className="dsh-kb-empty" role="status">
            {searching ? '无匹配链路' : '暂无看板任务，输入 /plan: 开启新链路'}
          </div>
        ) : visible.map((view) => {
          const matched = searching ? view.tasks.filter((item) => item.task.title.toLowerCase().includes(props.query.trim().toLowerCase())) : view.tasks;
          const expanded = searching || !props.collapsedChainIds.has(view.chain.id);
          const done = view.tasks.filter((item) => item.task.status === 'done' || item.task.status === 'archived').length;
          const blocked = view.tasks.some((item) => item.task.status === 'blocked' || item.task.status === 'failed');
          const summary = view.blockedSummary ?? (blocked ? '链路受阻' : `${done}/${view.tasks.length}`);
          return (
            <section key={view.chain.id} className={`dsh-kb-chain dsh-kb-chain--${view.chain.status}`}>
              <div
                role="button"
                tabIndex={0}
                className="dsh-kb-chain__title"
                aria-expanded={expanded}
                onClick={() => props.onToggleChain(view.chain.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onToggleChain(view.chain.id); }
                }}
              >
                <span className="dsh-kb-chain__chevron" aria-hidden="true" />
                <span className="dsh-kb-chain__name">{view.chain.title}</span>
                <span className="dsh-kb-chain__meta">{done}/{view.tasks.length}</span>
                {props.onDeleteChain && (
                  <button
                    type="button"
                    className="dsh-kb-chain__delete"
                    aria-label="删除需求"
                    title="删除需求（整链硬删除，不可恢复）"
                    onClick={(e) => { e.stopPropagation(); setDeleteError(null); setDeletingChainId(view.chain.id); }}
                    onKeyDown={(e) => { e.stopPropagation(); }}
                  >
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M6.6 6.5v4.5M9.4 6.5v4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
                {props.onRenameChain && (
                  <button
                    type="button"
                    className="dsh-kb-chain__rename"
                    aria-label="改链标题"
                    title="修改链路标题"
                    onClick={(e) => { e.stopPropagation(); setRenamingChainId(view.chain.id); }}
                    onKeyDown={(e) => { e.stopPropagation(); }}
                  >
                    ✎
                  </button>
                )}
                {/* 人工恢复（2026-09-15）：仅 blocked 链显示；文字按钮（低频高价值，明确性优先，⟳ 易被误读为刷新） */}
                {props.onReopenChain && view.chain.status === 'blocked' && (
                  <button
                    type="button"
                    className="dsh-kb-chain__reopen"
                    aria-label="人工恢复链路"
                    title="将 blocked 链恢复为 executing，编排器继续推进后续阶段"
                    onClick={(e) => { e.stopPropagation(); setReopenError(null); setReopenReason(''); setReopeningChainId(view.chain.id); }}
                    onKeyDown={(e) => { e.stopPropagation(); }}
                  >
                    恢复
                  </button>
                )}
              </div>
              {(blocked || view.blockedSummary) && (
                <div className="dsh-kb-chain__warning" title={summary}>{summary}</div>
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
                      <BoardCard view={item} onOpen={props.onOpenTask} onOpenView={props.onOpenView} />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>
      {renamingChain && props.onRenameChain && (
        <RenameModal
          title="改链标题"
          initialValue={renamingChain.title}
          onSave={(title) => { props.onRenameChain?.(renamingChain.id, title); setRenamingChainId(null); }}
          onCancel={() => setRenamingChainId(null)}
        />
      )}
      {reopeningView && props.onReopenChain && (
        <div className="dsh-kb-rename-overlay" onClick={(e) => { e.stopPropagation(); closeReopen(); }}>
          <div
            className="dsh-kb-rename-modal"
            role="dialog"
            aria-modal="true"
            aria-label="人工恢复链路"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dsh-kb-rename-modal__label">人工恢复链路</div>
            <div className="dsh-kb-delete-modal__text">
              将「{reopeningView.chain.title || '未命名需求'}」从 blocked 恢复为 executing，编排器继续推进后续阶段。
            </div>
            <input
              className="dsh-kb-comment-input"
              aria-label="恢复理由"
              placeholder="恢复理由（必填）"
              autoFocus
              value={reopenReason}
              onChange={(e) => { setReopenReason(e.target.value); if (reopenError) setReopenError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void confirmReopen(); }}
            />
            <div className="dsh-kb-rename-modal__hint">恢复理由必填（审计留痕）；填写后点「确认恢复」。</div>
            {reopenError && <div className="dsh-kb-delete-modal__error" role="alert">{reopenError}</div>}
            {reopenOk && <div className="dsh-kb-rename-modal__success" role="status">✓ 已恢复，编排器将继续推进后续阶段</div>}
            <div className="dsh-kb-rename-modal__actions">
              <button type="button" className="dsh-kb-rename-cancel" disabled={reopenBusy} onClick={closeReopen}>取消</button>
              <button type="button" className="dsh-kb-rename-save" disabled={reopenBusy || reopenOk} onClick={() => void confirmReopen()}>
                {reopenOk ? '已恢复' : reopenBusy ? '恢复中…' : '确认恢复'}
              </button>
            </div>
          </div>
        </div>
      )}
      {deletingView && props.onDeleteChain && (
        <div className="dsh-kb-rename-overlay" onClick={(e) => { e.stopPropagation(); setDeletingChainId(null); }}>
          <div
            className="dsh-kb-rename-modal"
            role="dialog"
            aria-modal="true"
            aria-label="删除需求"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dsh-kb-rename-modal__label">删除需求</div>
            <div className="dsh-kb-delete-modal__text">
              将永久删除「{deletingView.chain.title || '未命名需求'}」及其下 {deletingView.tasks.length} 张角色卡，不可恢复。确认删除？
            </div>
            {deleteError && <div className="dsh-kb-delete-modal__error" role="alert">删除失败：{deleteError}</div>}
            <div className="dsh-kb-rename-modal__actions">
              <button type="button" className="dsh-kb-rename-cancel" onClick={() => setDeletingChainId(null)}>取消</button>
              <button type="button" className="dsh-kb-delete-confirm" onClick={() => void confirmDelete()}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

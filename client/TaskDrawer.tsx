import { useState } from 'react';
import type { Chain, Handoff, KanbanEvent, SpecCard, Task } from '../src/domain/types.js';
import { statusLabelOf } from './workflow-model.js';
import { foldTimeline } from './timeline-model.js';

const ROLE_NAME: Record<Task['assignee'], string> = {
  v: 'orchestrator', p: 'planner', w: 'wiki-bridge', d: 'fullstack-dev', pt: 'plan-review', dt: 'impl-review',
};

const TABS = [
  ['overview', '概览'], ['timeline', '轨迹'], ['handoff', '交接'], ['spec', '规格'], ['comments', '评论'],
] as const;

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value ?? '');
}

function formatTime(at: number): string {
  return new Date(at).toLocaleString();
}

/** T27/T32：原位任务详情，固定五区；未读提示、乐观操作失败重试、破坏性操作二次确认。 */
export function TaskDrawer(props: {
  task: Task;
  chain: Chain;
  events: KanbanEvent[];
  handoff: Handoff | null;
  parentHandoffs: Handoff[];
  parentTasks?: Task[];
  specCard: SpecCard | null;
  upstream: Task[];
  downstream: Task[];
  unreadCount?: number;
  actionError?: { taskId: string; message: string } | null;
  readOnly?: boolean;
  onRetry?: () => void;
  onComment(body: string): void;
  onAction(action: { type: string; taskId: string; reason?: string; summary?: string; metadata?: Record<string, unknown>; body?: string }): void | Promise<unknown>;
  onClose(): void;
}) {
  const { task, events, handoff, specCard, chain } = props;
  const [tab, setTab] = useState<string>('overview');
  const [pending, setPending] = useState<{ kind: 'archive' | 'waive'; value: string } | null>(null);
  // 2026-09-15：豁免弹窗反馈三态（校验提示 / 在途 / 成功）——此前点击无任何反馈
  const [waiveError, setWaiveError] = useState<string | null>(null);
  const [waiveBusy, setWaiveBusy] = useState(false);
  const [waiveOk, setWaiveOk] = useState(false);
  const timeline = events.filter((e) => e.taskId === task.id).toSorted((a, b) => a.seq - b.seq);
  const comments = timeline.filter((e) => e.kind === 'task/commented');
  // 2026-09-15 恢复能力：评审卡存在 failed/gave-up 结论 → 可人工豁免（理由必填，审计留痕）。
  const reviewOutcome = task.mode === 'review-plan' || task.mode === 'review-impl'
    ? events.filter((e) => e.taskId === task.id && e.kind.startsWith('review/')).at(-1)?.kind ?? null
    : null;
  const canWaive = (reviewOutcome === 'review/failed' || reviewOutcome === 'review/gave-up');
  const submitComment = (el: HTMLInputElement) => {
    const value = el.value.trim();
    if (!value) return;
    props.onComment(value);
    el.value = '';
  };
  const arm = (kind: 'archive') => {
    setPending({ kind, value: '' });
    if (kind === 'archive') {
      window.setTimeout(() => setPending((current) => (current?.kind === 'archive' ? null : current)), 3000);
    }
  };
  const submitArchive = () => {
    if (pending?.kind !== 'archive') return;
    setPending(null);
    props.onAction({ type: 'archive', taskId: task.id });
  };
  /** 豁免提交（2026-09-15）：校验必给反馈 + 在途禁用 + 成功显式提示；失败保留输入可重试。 */
  const submitWaive = async () => {
    if (pending?.kind !== 'waive') return;
    const reason = pending.value.trim();
    if (!reason) {
      setWaiveError('请填写豁免理由（必填，用于审计留痕）');
      return;
    }
    setWaiveError(null);
    setWaiveBusy(true);
    try {
      await props.onAction({ type: 'waive-review', taskId: task.id, reason });
      setWaiveOk(true);
      window.setTimeout(() => { setPending(null); setWaiveOk(false); }, 800);
    } catch (err) {
      setWaiveError('豁免失败：' + String(err));
    } finally {
      setWaiveBusy(false);
    }
  };
  return (
    <div className="dsh-kb-detail">
      <header className="dsh-kb-detail__header">
        <button type="button" aria-label="返回任务列表" onClick={props.onClose}>←</button>
        <span className={`dsh-kb-profile dsh-kb-profile--${task.assignee}`}>{task.assignee.toUpperCase()}</span>
        <div className="dsh-kb-detail__identity">
          <strong>{task.title}</strong>
          <span>{task.id} · {task.mode} · attempt {task.attempts + 1}</span>
        </div>
        {props.unreadCount ? (
          <button type="button" className="dsh-kb-unread" onClick={() => setTab('timeline')}>{props.unreadCount} 条新更新</button>
        ) : null}
        {!props.readOnly && (
          <div className="dsh-kb-detail__actions">
          {task.status === 'blocked' && <button type="button" onClick={() => props.onAction({ type: 'unblock', taskId: task.id })}>解除阻塞</button>}
          {task.status === 'failed' && <button type="button" onClick={() => props.onAction({ type: 'retry', taskId: task.id })}>重试</button>}
          {['done', 'failed', 'blocked'].includes(task.status) && (
            <button type="button" data-confirming={pending?.kind === 'archive' || undefined} onClick={pending?.kind === 'archive' ? submitArchive : () => arm('archive')}>
              {pending?.kind === 'archive' ? '确认归档' : '归档'}
            </button>
          )}
          {canWaive && (
            <button
              type="button"
              onClick={() => { setPending({ kind: 'waive', value: '' }); setWaiveError(null); setWaiveOk(false); }}
            >
              豁免评审
            </button>
          )}
          </div>
        )}
      </header>
      {props.actionError?.taskId === task.id && (
        <div className="dsh-kb-action-error" role="alert">
          <span>操作失败：{props.actionError.message}</span>
          {props.onRetry && <button type="button" onClick={props.onRetry}>重试操作</button>}
        </div>
      )}
      <div role="tablist" aria-label="任务详情">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'overview' && (
        <section role="tabpanel">
          <h4>Workflow 上下文</h4>
          <p>{props.upstream.at(-1)?.title ?? '无上游'} → {task.title} → {props.downstream[0]?.title ?? '无下游'}</p>
          <dl>
            <dt>Profile</dt><dd>{task.assignee.toUpperCase()} / {ROLE_NAME[task.assignee]}</dd>
            <dt>状态</dt><dd>{statusLabelOf(task.status)}</dd>
            <dt>Chain</dt><dd>{chain.title}</dd>
            <dt>优先级</dt><dd>{task.priority}</dd>
            <dt>心跳</dt><dd>{task.heartbeats.length}</dd>
            <dt>依赖</dt><dd>{props.parentTasks && props.parentTasks.length > 0 ? props.parentTasks.map((p) => p.title).join(' → ') : '无'}</dd>
            <dt>重试</dt><dd>{task.attempts} 次{task.status === 'failed' ? ' · 可立即重试' : task.status === 'blocked' ? ' · 解除阻塞后可重试' : ''}</dd>
          </dl>
          <p>{task.body || '无附加任务描述'}</p>
        </section>
      )}
      {tab === 'timeline' && (
        <section role="tabpanel">
          {(() => {
            const items = foldTimeline(timeline);
            return (
              <ol className="dsh-kb-timeline">
                {items.map((item, i) => (
                  <li
                    key={item.seq}
                    className={`dsh-kb-timeline__item dsh-kb-timeline__item--${item.status}${i === 0 ? ' dsh-kb-timeline__item--latest' : ''}`}
                    data-exception={item.exception || undefined}
                  >
                    <div className="dsh-kb-timeline__axis">
                      <span className="dsh-kb-timeline__dot" aria-hidden="true" />
                    </div>
                    <div className="dsh-kb-timeline__body">
                      <div className="dsh-kb-timeline__row">
                        <strong className="dsh-kb-timeline__label">
                          {item.count ? `${item.label}（${item.count} 次）` : item.label}
                        </strong>
                        <time dateTime={new Date(item.at).toISOString()}>{formatTime(item.at)}</time>
                      </div>
                      {item.summary && <p className="dsh-kb-timeline__summary" title={item.summary}>{item.summary}</p>}
                      <span className="dsh-kb-timeline__author">{item.author}</span>
                    </div>
                  </li>
                ))}
              </ol>
            );
          })()}
        </section>
      )}
      {tab === 'handoff' && (
        <section role="tabpanel">
          {props.parentTasks && props.parentTasks.length > 0 && (
            <>
              <h4>父任务原文</h4>
              {props.parentTasks.map((p) => (
                <p key={p.id}><strong>{p.title}</strong>{p.body ? `：${p.body}` : '（无正文）'}</p>
              ))}
            </>
          )}
          {props.parentHandoffs.length > 0 && (
            <>
              <h4>父任务交接</h4>
              {props.parentHandoffs.map((h, i) => (
                <p key={i}><strong>{h.summary}</strong> {formatValue(h.metadata)}</p>
              ))}
            </>
          )}
          <h4>当前任务交接</h4>
          <p>{handoff?.summary ?? '当前任务尚无交接'}</p>
          {handoff && Object.entries(handoff.metadata).map(([key, value]) => (
            <p key={key}><strong>{key}</strong>: {formatValue(value)}</p>
          ))}
        </section>
      )}
      {tab === 'spec' && (
        <section role="tabpanel">
          <h4>Problem</h4><p>{specCard?.sections.problem ?? '无规格卡'}</p>
          <h4>Solution</h4><p>{specCard?.sections.solution ?? '无'}</p>
          <h4>User stories</h4><p>{specCard?.sections.user_stories.join('; ') || '无'}</p>
          <h4>Implementation decisions</h4><p>{specCard?.sections.impl_decisions.join('; ') || '无'}</p>
          <h4>Testing</h4><p>{specCard?.sections.testing ?? '无'}</p>
          <h4>Out of scope</h4><p>{specCard?.sections.out_of_scope ?? '无'}</p>
          <h4>附件</h4>
          {specCard && specCard.attachments.length > 0 ? (
            <ul className="dsh-kb-spec-attachments">
              {specCard.attachments.map((a) => (
                <li key={`${a.name}-${a.ref}`}>
                  <span className="dsh-kb-spec-attachment__kind">{a.kind}</span>
                  <strong>{a.name}</strong> <code>{a.ref}</code>
                </li>
              ))}
            </ul>
          ) : <p>无附件</p>}
        </section>
      )}
      {tab === 'comments' && (
        <section role="tabpanel">
          {comments.map((event) => (
            <p key={event.seq}>
              <strong>{event.author}</strong> <time dateTime={new Date(event.at).toISOString()}>{formatTime(event.at)}</time>
              : {String(event.payload['body'])}
            </p>
          ))}
          {!props.readOnly && (
            <input
              className="dsh-kb-comment-input"
              aria-label="添加评论"
              placeholder="添加评论，回车发送"
              onKeyDown={(e) => { if (e.key === 'Enter') submitComment(e.target as HTMLInputElement); }}
            />
          )}
        </section>
      )}
      {/* 豁免评审弹窗（2026-09-15）：由行内编辑改为弹窗确认——行内输入框会挤压 header 按钮（文字被迫竖排） */}
      {!props.readOnly && pending?.kind === 'waive' && (
        <div className="dsh-kb-rename-overlay" onClick={(e) => { e.stopPropagation(); if (!waiveBusy) { setPending(null); setWaiveError(null); } }}>
          <div
            className="dsh-kb-rename-modal"
            role="dialog"
            aria-modal="true"
            aria-label="豁免评审"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dsh-kb-rename-modal__label">豁免评审</div>
            <div className="dsh-kb-delete-modal__text">
              豁免「{task.title}」（{task.id}）的评审结论：被评审卡置为 waived，链路按评审通过继续推进（该评审的遗留问题仍作为非阻塞建议传下游）。请填写豁免理由。
            </div>
            <input
              className="dsh-kb-comment-input"
              aria-label="豁免理由"
              placeholder="豁免理由（必填）"
              autoFocus
              value={pending.value}
              onChange={(e) => { setPending({ kind: 'waive', value: e.target.value }); if (waiveError) setWaiveError(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitWaive(); }}
            />
            <div className="dsh-kb-rename-modal__hint">豁免理由必填（审计留痕）；填写后点「确认豁免」。</div>
            {waiveError && <div className="dsh-kb-delete-modal__error" role="alert">{waiveError}</div>}
            {waiveOk && <div className="dsh-kb-rename-modal__success" role="status">✓ 已豁免，链路将继续推进</div>}
            <div className="dsh-kb-rename-modal__actions">
              <button type="button" className="dsh-kb-rename-cancel" disabled={waiveBusy} onClick={() => { setPending(null); setWaiveError(null); }}>取消</button>
              <button type="button" className="dsh-kb-rename-save" disabled={waiveBusy || waiveOk} onClick={() => void submitWaive()}>
                {waiveOk ? '已豁免' : waiveBusy ? '豁免中…' : '确认豁免'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

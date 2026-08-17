import { useState } from 'react';
import type { Chain, Handoff, KanbanEvent, SpecCard, Task } from '../src/domain/types.js';
import { statusLabelOf } from './workflow-model.js';

const ROLE_NAME: Record<Task['assignee'], string> = {
  v: 'orchestrator', p: 'planner', w: 'wiki-bridge', d: 'fullstack-dev',
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
  onAction(action: { type: string; taskId: string; reason?: string; summary?: string; metadata?: Record<string, unknown>; body?: string }): void;
  onClose(): void;
}) {
  const { task, events, handoff, specCard, chain } = props;
  const [tab, setTab] = useState<string>('overview');
  const [pending, setPending] = useState<{ kind: 'block' | 'complete' | 'archive'; value: string } | null>(null);
  const timeline = events.filter((e) => e.taskId === task.id).toSorted((a, b) => a.seq - b.seq);
  const comments = timeline.filter((e) => e.kind === 'task/commented');
  const submitComment = (el: HTMLInputElement) => {
    const value = el.value.trim();
    if (!value) return;
    props.onComment(value);
    el.value = '';
  };
  const arm = (kind: 'block' | 'complete' | 'archive') => {
    setPending({ kind, value: '' });
    if (kind === 'archive') {
      window.setTimeout(() => setPending((current) => (current?.kind === 'archive' ? null : current)), 3000);
    }
  };
  // T32 fix：complete/block 服务端强制要求 summary/reason，在确认态内联收集，避免 400 后永久失败
  const submitPayload = (kind: 'block' | 'complete') => {
    if (pending?.kind !== kind || !pending.value.trim()) return;
    const value = pending.value;
    setPending(null);
    if (kind === 'block') props.onAction({ type: 'block', taskId: task.id, reason: value });
    else props.onAction({ type: 'complete', taskId: task.id, summary: value });
  };
  const submitArchive = () => {
    if (pending?.kind !== 'archive') return;
    setPending(null);
    props.onAction({ type: 'archive', taskId: task.id });
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
          {task.status === 'running' && <button type="button" onClick={() => arm('complete')}>完成</button>}
          {task.status === 'running' && <button type="button" onClick={() => arm('block')}>阻塞</button>}
          {task.status === 'blocked' && <button type="button" onClick={() => props.onAction({ type: 'unblock', taskId: task.id })}>解除阻塞</button>}
          {task.status === 'failed' && <button type="button" onClick={() => props.onAction({ type: 'retry', taskId: task.id })}>重试</button>}
          {['done', 'failed', 'blocked'].includes(task.status) && (
            <button type="button" data-confirming={pending?.kind === 'archive' || undefined} onClick={pending?.kind === 'archive' ? submitArchive : () => arm('archive')}>
              {pending?.kind === 'archive' ? '确认归档' : '归档'}
            </button>
          )}
          {pending?.kind === 'complete' && (
            <span className="dsh-kb-action-form">
              <input aria-label="交接摘要" value={pending.value} onChange={(e) => setPending({ kind: 'complete', value: e.target.value })} placeholder="交接摘要" />
              <button type="button" disabled={!pending.value.trim()} onClick={() => submitPayload('complete')}>确认完成</button>
              <button type="button" onClick={() => setPending(null)}>取消</button>
            </span>
          )}
          {pending?.kind === 'block' && (
            <span className="dsh-kb-action-form">
              <input aria-label="阻塞原因" value={pending.value} onChange={(e) => setPending({ kind: 'block', value: e.target.value })} placeholder="阻塞原因" />
              <button type="button" disabled={!pending.value.trim()} onClick={() => submitPayload('block')}>确认阻塞</button>
              <button type="button" onClick={() => setPending(null)}>取消</button>
            </span>
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
          <ol>
            {timeline.map((event) => (
              <li key={event.seq}><code>{event.kind}</code><span>seq {event.seq} · {event.author} · {event.at}</span></li>
            ))}
          </ol>
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
              aria-label="添加评论"
              onKeyDown={(e) => { if (e.key === 'Enter') submitComment(e.target as HTMLInputElement); }}
            />
          )}
        </section>
      )}
    </div>
  );
}

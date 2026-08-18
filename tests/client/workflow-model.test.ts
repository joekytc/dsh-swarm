import { describe, it, expect } from 'vitest';
import { deriveWorkflowBoard } from '../../client/workflow-model.js';
import { workflowFixture } from './workflow-fixtures.js';

describe('workflow model', () => {
  it('orders blocked before executing and never relates another chain', () => {
    const state = workflowFixture();
    const view = deriveWorkflowBoard(state, { selectedTaskId: 't_d', now: 10_000 });
    expect(view.map((item) => item.chain.id)).toEqual(['ch_blocked', 'ch_running', 'ch_done']);
    expect(view.find((item) => item.chain.id === 'ch_running')!.tasks.find((item) => item.task.id === 't_d')!.selected).toBe(true);
    expect(view.find((item) => item.chain.id === 'ch_blocked')!.tasks.every((item) => item.related === false)).toBe(true);
  });

  it('derives R20 labels and line semantics', () => {
    const view = deriveWorkflowBoard(workflowFixture(), { selectedTaskId: null, now: 10_000 });
    const tasks = view.find((item) => item.chain.id === 'ch_running')!.tasks;
    expect(tasks.map((item) => item.phase)).toEqual(['W1-pre', 'P', 'W2', 'D', 'W3']);
    expect(tasks.map((item) => item.lineState)).toEqual(['complete', 'complete', 'complete', 'active', 'pending']);
  });

  it('exposes the blocked chain summary even when unrelated', () => {
    const view = deriveWorkflowBoard(workflowFixture(), { selectedTaskId: null, now: 10_000 });
    expect(view.find((item) => item.chain.id === 'ch_blocked')!.blockedSummary).toBe('kb-unreachable');
  });

  it('keeps archived chains out of the active view and reveals them via 已完成 statusFilter', () => {
    const state = workflowFixture();
    const active = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000 });
    expect(active.find((item) => item.chain.id === 'ch_archived')).toBeUndefined();
    const archived = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000, statusFilter: new Set(['completed']) });
    expect(archived.map((item) => item.chain.id)).toEqual(['ch_done', 'ch_archived']); // ch_done(completed, 最近活动 900) + ch_archived(aborted, 700)
    expect(archived.some((item) => item.chain.id === 'ch_archived' && item.tasks.map((t) => t.task.id).join() === 't_arch')).toBe(true);
  });

  it('状态筛选：执行中/阻塞/失败 多选并集过滤链路', () => {
    const state = workflowFixture();
    // 默认视图（空筛选）：ch_blocked、ch_running、ch_done（归档隐藏）
    const all = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000 });
    expect(all.map((item) => item.chain.id)).toEqual(['ch_blocked', 'ch_running', 'ch_done']);
    // 执行中：ch_running（executing）
    const exec = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000, statusFilter: new Set(['executing']) });
    expect(exec.map((item) => item.chain.id)).toEqual(['ch_running']);
    // 阻塞：ch_blocked（含 blocked 任务）
    const blocked = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000, statusFilter: new Set(['blocked']) });
    expect(blocked.map((item) => item.chain.id)).toEqual(['ch_blocked']);
    // 执行中 + 阻塞 并集：两者都显示
    const both = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000, statusFilter: new Set(['executing', 'blocked']) });
    expect(both.map((item) => item.chain.id).sort()).toEqual(['ch_blocked', 'ch_running'].sort());
  });

  it('状态筛选：失败 链路（含 failed 任务）', () => {
    const state = workflowFixture();
    state.tasks.get('t_blocked')!.status = 'failed';
    const failed = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000, statusFilter: new Set(['failed']) });
    expect(failed.map((item) => item.chain.id)).toEqual(['ch_blocked']);
    // 空筛选默认视图不含该链之外的变化
    const all = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000 });
    expect(all.map((item) => item.chain.id)).toContain('ch_blocked');
  });


  it('exposes audit view for completed chain with unconfirmed warning; null otherwise', () => {
    const state = workflowFixture();
    state.auditWarnings.set('ch_done', {
      evidence: [{ source: 'main-session-scan', detail: 'main wrote under workspaces', paths: ['/x/leak.md'] }],
      warnedAt: 900, warnedSeq: 10, confirmedAt: null, confirmedBy: null, confirmedSeq: null,
    });
    const view = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000 });
    const done = view.find((item) => item.chain.id === 'ch_done')!;
    expect(done.audit!.warned).toBe(true);
    expect(done.audit!.confirmed).toBe(false);
    expect(done.audit!.evidenceCount).toBe(1);
    const running = view.find((item) => item.chain.id === 'ch_running')!;
    expect(running.audit).toBeNull();
  });

  it('marks audit confirmed once the user confirms ownership', () => {
    const state = workflowFixture();
    state.auditWarnings.set('ch_done', {
      evidence: [{ source: 'main-session-scan', detail: 'd', paths: ['/x'] }],
      warnedAt: 900, warnedSeq: 10, confirmedAt: 1000, confirmedBy: 'human', confirmedSeq: 11,
    });
    const view = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000 });
    const done = view.find((item) => item.chain.id === 'ch_done')!;
    expect(done.audit!.warned).toBe(true);
    expect(done.audit!.confirmed).toBe(true);
  });

  it('keeps the selected archived chain visible until returning to the list', () => {
    const state = workflowFixture();
    for (const t of state.tasks.values()) if (t.chainId === 'ch_running') t.status = 'archived';
    const selected = deriveWorkflowBoard(state, { selectedTaskId: 't_d', now: 10_000 });
    expect(selected.find((item) => item.chain.id === 'ch_running')).toBeTruthy();
    const back = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000 });
    expect(back.find((item) => item.chain.id === 'ch_running')).toBeUndefined();
  });
});

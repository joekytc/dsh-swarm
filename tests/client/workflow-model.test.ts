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

  it('keeps archived chains out of the active view and reveals them via archivedOnly', () => {
    const state = workflowFixture();
    const active = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000 });
    expect(active.find((item) => item.chain.id === 'ch_archived')).toBeUndefined();
    const archived = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000, archivedOnly: true });
    expect(archived.map((item) => item.chain.id)).toEqual(['ch_archived']);
    expect(archived[0].tasks.map((item) => item.task.id)).toEqual(['t_arch']);
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

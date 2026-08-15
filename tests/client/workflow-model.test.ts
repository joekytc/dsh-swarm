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
});

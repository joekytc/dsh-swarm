import { describe, it, expect } from 'vitest';
import { deriveWorkflowBoard } from '../../client/workflow-model.js';
import { workflowFixture } from './workflow-fixtures.js';

describe('workflow board data', () => {
  it('orders chain tasks by task/created seq, not id order', () => {
    const state = workflowFixture();
    const view = deriveWorkflowBoard(state, { selectedTaskId: null, now: 10_000 });
    const tasks = view.find((item) => item.chain.id === 'ch_running')!.tasks.map((item) => item.task.id);
    expect(tasks).toEqual(['t_pre', 't_p', 't_w2', 't_d', 't_w3']);
  });
});

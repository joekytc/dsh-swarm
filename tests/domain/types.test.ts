import { describe, it, expect } from 'vitest';
import type { KanbanEvent, Task, Chain, SpecCard } from '../../src/domain/types.js';

describe('domain types', () => {
  it('constructs a task event', () => {
    const ev: KanbanEvent = {
      seq: 1, chainId: 'ch_1', taskId: 't_1',
      kind: 'task/created', payload: { title: 'x' }, author: 'v', at: 1000,
    };
    expect(ev.seq).toBe(1);
  });
  it('constructs a task with all lifecycle fields', () => {
    const t: Task = {
      id: 't_1', chainId: 'ch_1', title: 'prefetch', body: '', assignee: 'w',
      status: 'ready', mode: 'file', priority: 1, parents: [], children: [],
      createdBy: 'v', attempts: 0, heartbeats: [],
    };
    expect(t.status).toBe('ready');
  });
  it('chain and spec card statuses are closed unions', () => {
    const c: Chain = { id: 'ch_1', title: 'x', status: 'planning', rootTaskId: null, specCardId: null, ownerSessionId: 's_1', workspaceDir: null, createdAt: 1000 };
    const s: SpecCard = { id: 'sc_1', chainId: 'ch_1', status: 'draft', sections: { problem: '', solution: '', user_stories: [], impl_decisions: [], testing: '', out_of_scope: '' }, attachments: [], rawDialogueRef: null, approvedAt: null, approvedBy: null };
    expect(c.status).toBe('planning');
    expect(s.status).toBe('draft');
  });
});

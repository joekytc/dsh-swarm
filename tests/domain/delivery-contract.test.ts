import { describe, it, expect } from 'vitest';
import { missingDeliveryKeys, hasRequiredDelivery, missingParentDelivery } from '../../src/domain/delivery-contract.js';
import type { BoardState, Task } from '../../src/domain/types.js';

const task = (id: string, assignee: Task['assignee'], mode: Task['mode']): Task => ({
  id, chainId: 'ch_1', title: 'x', body: '', assignee, status: 'done', mode, priority: 1,
  parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [], sessionId: 'kbn-' + id,
  reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'not-required',
});

describe('delivery-contract (R20 上游对下游负责)', () => {
  it('w:file requires non-empty ref', () => {
    expect(missingDeliveryKeys('w', 'file', undefined)).toEqual(['ref']);
    expect(missingDeliveryKeys('w', 'file', { summary: 's', metadata: { ref: '/ws' }, completedAt: 0 })).toEqual([]);
    expect(hasRequiredDelivery('w', 'file', { summary: 's', metadata: { ref: '  ' }, completedAt: 0 })).toBe(false);
  });

  it('w:kb requires kb_url + page_path (both non-empty)', () => {
    expect(missingDeliveryKeys('w', 'kb', { summary: 's', metadata: { kb_url: 'http://x' }, completedAt: 0 })).toEqual(['page_path']);
    expect(missingDeliveryKeys('w', 'kb', { summary: 's', metadata: { kb_url: 'http://x', page_path: '/kb/1' }, completedAt: 0 })).toEqual([]);
  });

  it('p:openspec requires artifacts_path', () => {
    expect(missingDeliveryKeys('p', 'openspec', { summary: 's', metadata: {}, completedAt: 0 })).toEqual(['artifacts_path']);
  });

  it('d:execute has no hard-delivery key (git evidence judged separately)', () => {
    expect(missingDeliveryKeys('d', 'execute', { summary: 's', metadata: {}, completedAt: 0 })).toEqual([]);
  });

  it('missingParentDelivery lists missing keys per done parent', () => {
    const w2 = task('t_w2', 'w', 'kb');
    const p = task('t_p', 'p', 'openspec');
    const state = {
      tasks: new Map([[w2.id, w2], [p.id, p]]),
      handoffs: new Map([[w2.id, { summary: 's', metadata: { kb_url: 'http://x' }, completedAt: 0 }]]),
    } as unknown as BoardState;
    expect(missingParentDelivery(state, [w2.id, p.id])).toEqual([
      { taskId: 't_w2', assignee: 'w', mode: 'kb', missing: ['page_path'] },
      { taskId: 't_p', assignee: 'p', mode: 'openspec', missing: ['artifacts_path'] },
    ]);
  });
});
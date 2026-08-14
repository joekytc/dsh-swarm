import { describe, it, expect } from 'vitest';
import { project } from '../../src/domain/projection.js';
import type { KanbanEvent } from '../../src/domain/types.js';

function mk(seq: number, kind: KanbanEvent['kind'], payload: Record<string, unknown>, taskId: string | null = null): KanbanEvent {
  return { seq, chainId: 'ch_1', taskId, kind, payload, author: 'v', at: seq * 1000 };
}

describe('projection', () => {
  it('rebuilds board from event log', () => {
    const events: KanbanEvent[] = [
      mk(0, 'chain/created', { id: 'ch_1', title: 'c', ownerSessionId: 's_1' }),
      mk(1, 'task/created', { id: 't_1', title: 'w1', assignee: 'w', mode: 'file' }, 't_1'),
      mk(2, 'task/claimed', {}, 't_1'),
      mk(3, 'task/completed', { summary: 'done', metadata: { kb_url: 'http://x' } }, 't_1'),
    ];
    const state = project(events);
    expect(state.chains.get('ch_1')!.status).toBe('planning');
    const t = state.tasks.get('t_1')!;
    expect(t.status).toBe('done');
    expect(state.handoffs.get('t_1')!.metadata.kb_url).toBe('http://x');
  });
  it('rejects illegal event sequence during replay', () => {
    const events: KanbanEvent[] = [
      mk(0, 'chain/created', { id: 'ch_1', title: 'c', ownerSessionId: 's_1' }),
      mk(1, 'task/completed', { summary: 'x' }, 't_1'), // 无 task/created 就 complete
    ];
    expect(() => project(events)).toThrow();
  });
});

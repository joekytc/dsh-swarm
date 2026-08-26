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
  it('applies chain/title-updated and task/renamed to the snapshot', () => {
    const events: KanbanEvent[] = [
      mk(0, 'chain/created', { id: 'ch_1', title: '【需求】旧', ownerSessionId: 's_1' }),
      mk(1, 'task/created', { id: 't_1', title: 'p', assignee: 'w', mode: 'file' }, 't_1'),
      mk(2, 'chain/title-updated', { from: '【需求】旧', to: '【需求】新' }),
      mk(3, 'task/renamed', { from: 'p', to: 'p-新' }, 't_1'),
    ];
    const state = project(events);
    expect(state.chains.get('ch_1')!.title).toBe('【需求】新');
    expect(state.tasks.get('t_1')!.title).toBe('p-新');
    // 非状态转换：chain 状态不变
    expect(state.chains.get('ch_1')!.status).toBe('planning');
  });
  it('rejects rename events for unknown chain/task during replay', () => {
    expect(() => project([
      mk(0, 'chain/created', { id: 'ch_1', title: 'c', ownerSessionId: 's_1' }),
      { ...mk(1, 'chain/title-updated', { from: 'c', to: 'x' }, null), chainId: 'ch_unknown' },
    ])).toThrow(/unknown chain/);
  });
  it('infra failure does not increment attempts; unblock resets attempts (RC4)', () => {
    const base: KanbanEvent[] = [
      mk(0, 'chain/created', { id: 'ch_1', title: 'c', ownerSessionId: 's_1' }),
      mk(1, 'task/created', { id: 't_1', title: 'w1', assignee: 'w', mode: 'file' }, 't_1'),
      mk(2, 'task/claimed', {}, 't_1'),
      mk(3, 'task/failed', { reason: 'runner-error: cannot prepare session while it is live', infra: true }, 't_1'),
    ];
    let state = project(base);
    expect(state.tasks.get('t_1')!.attempts).toBe(0); // infra 不计数
    const withQualityFail: KanbanEvent[] = [
      ...base,
      mk(4, 'task/claimed', {}, 't_1'),
      mk(5, 'task/failed', { reason: 'invalid prefetch manifest: x', infra: false }, 't_1'),
    ];
    state = project(withQualityFail);
    expect(state.tasks.get('t_1')!.attempts).toBe(1); // 任务质量失败计数
    const withUnblock: KanbanEvent[] = [
      ...withQualityFail,
      mk(6, 'task/blocked', { reason: 'gave_up: max retries' }, 't_1'),
      mk(7, 'task/unblocked', {}, 't_1'),
    ];
    state = project(withUnblock);
    expect(state.tasks.get('t_1')!.attempts).toBe(0); // unblock 重置
  });
});

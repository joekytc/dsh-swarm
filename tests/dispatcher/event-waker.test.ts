import { describe, it, expect } from 'vitest';
import { EventWaker } from '../../src/dispatcher/event-waker.js';
import type { KanbanEvent } from '../../src/domain/types.js';

function ev(seq: number, kind: KanbanEvent['kind'], chainId: string): KanbanEvent {
  return { seq, chainId, taskId: null, kind, payload: {}, author: 'system', at: seq };
}

describe('EventWaker', () => {
  it('wakes V on spec-card/approved', async () => {
    const wakes: string[] = [];
    const waker = new EventWaker({ on: () => () => {} } as never, { staleTimeoutSeconds: 1, maxRetries: 3, heartbeatIntervalSeconds: 1 } as never);
    waker.setWakeImpl(async (chainId: string) => { wakes.push(chainId); });
    await waker.onEvent(ev(1, 'spec-card/approved', 'ch_1'));
    expect(wakes).toEqual(['ch_1']);
  });
  it('does not wake V on chain/created (v2: V only acts after spec approval)', async () => {
    const wakes: string[] = [];
    const waker = new EventWaker({ on: () => () => {} } as never, {} as never);
    waker.setWakeImpl(async (chainId: string) => { wakes.push(chainId); });
    await waker.onEvent(ev(1, 'chain/created', 'ch_1'));
    expect(wakes).toEqual([]);
  });
  it('does not wake twice for same chain while in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const wakes: string[] = [];
    const waker = new EventWaker({ on: () => () => {} } as never, {} as never);
    waker.setWakeImpl(async (chainId: string) => { wakes.push(chainId); await gate; });
    const p1 = waker.onEvent(ev(1, 'task/completed', 'ch_1'));
    const p2 = waker.onEvent(ev(2, 'task/completed', 'ch_1'));
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([p1, p2]);
    expect(wakes).toEqual(['ch_1']);
  });
});

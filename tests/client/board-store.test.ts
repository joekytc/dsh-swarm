import { describe, it, expect, vi } from 'vitest';
import { createBoardStore, type EventSourceLike } from '../../client/board-store.js';

function baseline(lastSeq = 0) {
  return { chains: [], tasks: [], specCards: [], handoffs: [], events: [], lastSeq };
}

function fakeSource(url: string): EventSourceLike & { url: string; close: ReturnType<typeof vi.fn> } {
  return {
    url,
    onopen: null,
    onmessage: null,
    onerror: null,
    close: vi.fn(),
  };
}

describe('board store', () => {
  it('loads one baseline and folds the next event', async () => {
    let source: EventSourceLike | undefined;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(baseline(0)), { status: 200 }));
    const store = createBoardStore({ fetchImpl, eventSourceFactory: (url) => (source = fakeSource(url)) });
    await store.start();
    source!.onmessage?.({
      data: JSON.stringify({
        seq: 1, chainId: 'ch_1', taskId: null, kind: 'chain/created',
        payload: { id: 'ch_1', title: 'A', status: 'planning', rootTaskId: null, specCardId: null, ownerSessionId: 's', createdAt: 1 },
        author: 'human', at: 1,
      }),
      lastEventId: '1',
    } as MessageEvent);
    expect(store.getSnapshot().lastSeq).toBe(1);
    expect(store.getSnapshot().board?.chains.has('ch_1')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicates and resyncs a seq gap', async () => {
    let source: EventSourceLike | undefined;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(baseline(3)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(baseline(8)), { status: 200 }));
    const store = createBoardStore({ fetchImpl, eventSourceFactory: (url) => (source = fakeSource(url)) });
    await store.start();
    source!.onmessage?.({ data: JSON.stringify({ seq: 3 }), lastEventId: '3' } as MessageEvent);
    source!.onmessage?.({ data: JSON.stringify({ seq: 7 }), lastEventId: '7' } as MessageEvent);
    await vi.waitFor(() => expect(store.getSnapshot().lastSeq).toBe(8));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps last board visible and reports reconnecting on source error', async () => {
    let source: EventSourceLike | undefined;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(baseline(2)), { status: 200 }));
    const store = createBoardStore({ fetchImpl, eventSourceFactory: (url) => (source = fakeSource(url)) });
    await store.start();
    expect(store.getSnapshot().connection).toBe('ready');
    source!.onerror?.({} as Event);
    expect(store.getSnapshot().connection).toBe('reconnecting');
    expect(store.getSnapshot().board).not.toBeNull();
  });

  it('stops and does not accept late events', async () => {
    let source: EventSourceLike | undefined;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(baseline(0)), { status: 200 }));
    const store = createBoardStore({ fetchImpl, eventSourceFactory: (url) => (source = fakeSource(url)) });
    await store.start();
    store.stop();
    expect(store.getSnapshot().lastSeq).toBe(0);
  });
});

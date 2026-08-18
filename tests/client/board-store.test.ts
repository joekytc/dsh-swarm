import { describe, it, expect, vi } from 'vitest';
import { createBoardStore, type EventSourceLike } from '../../client/board-store.js';
import type { Task } from '../../src/domain/types.js';

function baseline(lastSeq = 0) {
  return { chains: [], tasks: [], specCards: [], handoffs: [], auditWarnings: [], events: [], lastSeq };
}

function baselineWithRunningTask(lastSeq = 1) {
  const task: Task = {
    id: 't_1', chainId: 'ch_1', title: 'block me', body: '', assignee: 'w', status: 'running',
    mode: 'kb', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [10],
    sessionId: 'kbn-t_1', reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'not-required',
  };
  return {
    chains: [{ id: 'ch_1', title: 'c', status: 'executing', rootTaskId: 't_1', specCardId: null, ownerSessionId: 's', createdAt: 1 }],
    tasks: [task],
    specCards: [],
    handoffs: [],
    auditWarnings: [],
    events: [{ seq: 1, chainId: 'ch_1', taskId: 't_1', kind: 'task/created', payload: { ...task }, author: 'v', at: 1 }],
    lastSeq,
  };
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
        payload: { id: 'ch_1', title: 'A', status: 'planning', rootTaskId: null, specCardId: null, ownerSessionId: 's', workspaceDir: null, createdAt: 1 },
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

  it('applies optimistic status and rolls back on failure', async () => {
    let source: EventSourceLike | undefined;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith('/kanban/board')) return new Response(JSON.stringify(baselineWithRunningTask()), { status: 200 });
      throw new Error('action failed');
    });
    const store = createBoardStore({ fetchImpl, eventSourceFactory: (url) => (source = fakeSource(url)) });
    await store.start();
    await expect(store.postAction({ type: 'block', taskId: 't_1' })).rejects.toThrow('action failed');
    expect(store.getSnapshot().board?.tasks.get('t_1')?.status).toBe('running');
    expect(store.getSnapshot().actionError?.taskId).toBe('t_1');
    expect(store.getSnapshot().actionError?.message).toContain('action failed');
  });

  it('keeps the optimistic status when the action succeeds', async () => {
    let source: EventSourceLike | undefined;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith('/kanban/board')) return new Response(JSON.stringify(baselineWithRunningTask()), { status: 200 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const store = createBoardStore({ fetchImpl, eventSourceFactory: (url) => (source = fakeSource(url)) });
    await store.start();
    await store.postAction({ type: 'block', taskId: 't_1' });
    expect(store.getSnapshot().board?.tasks.get('t_1')?.status).toBe('blocked');
    expect(store.getSnapshot().actionError).toBeNull();
  });
});

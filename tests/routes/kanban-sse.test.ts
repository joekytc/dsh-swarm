import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { serveKanbanEvents } from '../../src/routes/kanban-sse.js';
import type { KanbanEvent } from '../../src/domain/types.js';

function event(seq: number): KanbanEvent {
  return { seq, chainId: 'ch_1', taskId: null, kind: 'chain/created', payload: {}, author: 'human', at: seq };
}

describe('kanban SSE bridge', () => {
  it('replays events after the client last seq and streams later events once', async () => {
    const req = Object.assign(new EventEmitter(), { url: '/kanban/events?after=3', headers: {} });
    const writes: string[] = [];
    const res = Object.assign(new EventEmitter(), {
      setHeader: vi.fn(), flushHeaders: vi.fn(), write: (chunk: string) => { writes.push(chunk); return true; }, end: vi.fn(),
    });
    let listener: ((value: KanbanEvent) => void) | undefined;
    const service = {
      subscribe(fn: (value: KanbanEvent) => void) { listener = fn; return () => { listener = undefined; }; },
      eventsSince: vi.fn(async () => [event(4), event(5)]),
    };
    await serveKanbanEvents(req as never, res as never, service as never, { heartbeatMs: 60_000 });
    listener?.(event(5));
    listener?.(event(6));
    expect(writes.join('')).toContain('id: 4');
    expect(writes.join('')).toContain('id: 5');
    expect(writes.join('').match(/id: 5/g)).toHaveLength(1);
    expect(writes.join('')).toContain('id: 6');
    req.emit('close');
  });

  it('honors Last-Event-ID header for reconnects', async () => {
    const req = Object.assign(new EventEmitter(), { url: '/kanban/events', headers: { 'last-event-id': '2' } });
    const writes: string[] = [];
    const res = Object.assign(new EventEmitter(), {
      setHeader: vi.fn(), flushHeaders: vi.fn(), write: (chunk: string) => { writes.push(chunk); return true; }, end: vi.fn(),
    });
    const service = {
      subscribe: () => () => {},
      eventsSince: vi.fn(async () => [event(3), event(4)]),
    };
    await serveKanbanEvents(req as never, res as never, service as never, { heartbeatMs: 60_000 });
    expect(service.eventsSince).toHaveBeenCalledWith(3);
    expect(writes.join('')).toContain('id: 4');
    req.emit('close');
  });
});

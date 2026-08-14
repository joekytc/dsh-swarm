import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerKanbanHttp } from '../../src/routes/kanban-http.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import type { KanbanProvider } from '../../src/services/kanban-provider.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

function mockRes() {
  const chunks: Buffer[] = [];
  const res: ServerResponse = {
    statusCode: 0,
    setHeader(k: string, v: unknown) { (this as unknown as { h: Record<string, unknown> }).h[k] = v; },
    end(s?: unknown) { chunks.push(Buffer.isBuffer(s) ? s : Buffer.from(String(s ?? ''))); },
    h: {},
  } as unknown as ServerResponse;
  return { res, body: () => chunks.join('') };
}

function mockReq(method: string, url: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as { method?: string }).method = method;
  (req as { url?: string }).url = url;
  if (body !== undefined) {
    setTimeout(() => {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    }, 0);
  }
  return req;
}

describe('kanban HTTP bridge', () => {
  it('serves board snapshot on GET /kanban/board', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      const provider = { service: svc } as unknown as KanbanProvider;
      let route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> } | undefined;
      const fakeCtx = { webServer: { register(r: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) { route = r; return () => {}; } } } as never;
      registerKanbanHttp(fakeCtx, provider);
      const { res, body } = mockRes();
      await route!.handler(mockReq('GET', '/kanban/board'), res);
      const data = JSON.parse(body());
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].title).toBe('t1');
      expect(data.chains[0].id).toBe(chain.id);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('blocks a task via POST /kanban/action', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(t.id, 'system'); // todo→running，block 才合法
      const provider = { service: svc } as unknown as KanbanProvider;
      let route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> } | undefined;
      const fakeCtx = { webServer: { register(r: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) { route = r; return () => {}; } } } as never;
      registerKanbanHttp(fakeCtx, provider);
      const { res, body } = mockRes();
      await route!.handler(mockReq('POST', '/kanban/action', JSON.stringify({ type: 'block', taskId: t.id })), res);
      expect(JSON.parse(body())).toEqual({ ok: true });
      const state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not register when webServer absent (CLI/headless)', () => {
    const fakeCtx = {} as never; // 无 webServer 服务
    expect(() => registerKanbanHttp(fakeCtx, { service: {} } as unknown as KanbanProvider)).not.toThrow();
  });
});
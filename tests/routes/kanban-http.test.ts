import { describe, it, expect, vi } from 'vitest';
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

async function routeFor(svc: KanbanService, runner?: { runTask(taskId: string): Promise<void> } | null) {
  const provider = { service: svc, runner } as unknown as KanbanProvider;
  let route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> } | undefined;
  const webServerObj = { register(r: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) { route = r; return () => {}; } };
  const fakeCtx = { get: (name: string) => (name === 'webServer' ? webServerObj : undefined) } as never;
  registerKanbanHttp(fakeCtx, provider);
  return route!;
}

async function postAction(route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> }, payload: unknown) {
  const { res, body } = mockRes();
  await route.handler(mockReq('POST', '/kanban/action', JSON.stringify(payload)), res);
  return JSON.parse(body());
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
      const webServerObj = { register(r: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) { route = r; return () => {}; } };
      const fakeCtx = { get: (name: string) => (name === 'webServer' ? webServerObj : undefined) } as never;
      registerKanbanHttp(fakeCtx, provider);
      const { res, body } = mockRes();
      await route!.handler(mockReq('GET', '/kanban/board'), res);
      const data = JSON.parse(body());
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].title).toBe('t1');
      expect(data.chains[0].id).toBe(chain.id);
      expect(data.lastSeq).toBe(data.events.at(-1).seq);
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
      const webServerObj = { register(r: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) { route = r; return () => {}; } };
      const fakeCtx = { get: (name: string) => (name === 'webServer' ? webServerObj : undefined) } as never;
      registerKanbanHttp(fakeCtx, provider);
      const { res, body } = mockRes();
      await route!.handler(mockReq('POST', '/kanban/action', JSON.stringify({ type: 'block', taskId: t.id, reason: 'GUI block' })), res);
      expect(JSON.parse(body())).toEqual({ ok: true });
      const state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not register when webServer absent (CLI/headless)', () => {
    const fakeCtx = { get: () => undefined } as never; // 无 webServer 服务
    expect(() => registerKanbanHttp(fakeCtx, { service: {} } as unknown as KanbanProvider)).not.toThrow();
  });

  it('validates and records a human comment action', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      const route = await routeFor(svc);
      const result = await postAction(route, { type: 'comment', taskId: t.id, body: '请补充失败路径' });
      expect(result).toEqual({ ok: true });
      expect((await svc.snapshot()).events.at(-1)?.kind).toBe('task/commented');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('records a human complete action with summary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(t.id, 'system');
      const route = await routeFor(svc);
      const result = await postAction(route, { type: 'complete', taskId: t.id, summary: 'GUI done', metadata: { note: 'x' } });
      expect(result).toEqual({ ok: true });
      expect((await svc.snapshot()).tasks.get(t.id)!.status).toBe('done');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('dispatches retry for a failed task through the runner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(t.id, 'system');
      await svc.failTask(t.id, 'boom', 'system');
      const runTask = vi.fn(async () => {});
      const route = await routeFor(svc, { runTask });
      const result = await postAction(route, { type: 'retry', taskId: t.id });
      expect(result).toEqual({ ok: true });
      expect(runTask).toHaveBeenCalledWith(t.id);
      expect((await svc.snapshot()).tasks.get(t.id)!.status).toBe('failed'); // claim 由 runner 异步执行
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects retry for non-failed tasks with a friendly error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(t.id, 'system'); // running，非 failed
      const runTask = vi.fn(async () => {});
      const result = await postAction(await routeFor(svc, { runTask }), { type: 'retry', taskId: t.id });
      expect(result.error).toContain('invalid state');
      expect(result.error).toContain('running');
      expect(runTask).not.toHaveBeenCalled();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects retry with a friendly error when the dispatcher runner is not ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(t.id, 'system');
      await svc.failTask(t.id, 'boom', 'system');
      const result = await postAction(await routeFor(svc), { type: 'retry', taskId: t.id });
      expect(result.error).toContain('dispatcher not ready');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects unknown actions and empty required fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      const route = await routeFor(svc);
      expect((await postAction(route, { type: 'nope', taskId: t.id })).error).toContain('unknown action');
      expect((await postAction(route, { type: 'block', taskId: t.id, reason: '  ' })).error).toContain('reason required');
      expect((await postAction(route, { type: 'complete', taskId: t.id, summary: '' })).error).toContain('summary required');
      expect((await postAction(route, { type: 'comment', taskId: t.id, body: '' })).error).toContain('body required');
      expect((await postAction(route, { type: 'archive' })).error).toContain('taskId required');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

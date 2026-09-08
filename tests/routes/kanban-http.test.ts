import { describe, it, expect, vi, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerKanbanHttp } from '../../src/routes/kanban-http.js';
import { INSTALL_GUIDANCE } from '../../src/services/ocr-cli.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { ConfigProvider } from '../../src/services/config-provider.js';
import type { KanbanProvider } from '../../src/services/kanban-provider.js';
import type { LlmRuntimeLike } from '../../src/services/llm-catalog.js';
import type { KanbanConfig } from '../../src/config.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

const tempDirs: string[] = [];
function newTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });

function baseConfig(storageDir = '/tmp/kb'): KanbanConfig {
  return {
    storageDir, wikiVault: { baseUrl: 'http://10.0.0.1:3000', pagePrefix: 'projects/' },
    roles: { models: {} }, dispatcher: { staleTimeoutSeconds: 1, maxRetries: 1, heartbeatIntervalSeconds: 1, maxProtocolViolations: 2, maxReworksPerRole: { pt: 2, dt: 3 } },
    prefixRoutes: { plan: '/plan:', openspec: '/openspec:', learning: '/learning', send: '/sms' },
    memory: { enabled: true, maxIndexEntries: 8 }, ui: { enabled: true, contentMinWidth: 715, contentMaxWidth: 780, sseHeartbeatSeconds: 20 },
    gates: { enabled: true, timeoutMs: 600000, forbidden: ['rm -rf /', 'git push'] },
    imDelivery: { enabled: false, botId: '', targetId: '' },
    reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } },
  };
}

function stubConfigProvider(storageDir?: string): ConfigProvider {
  const fakeCtx = { on: () => {}, off: () => {}, set: () => {}, get: () => undefined, reflect: { provide: () => {} } } as never;
  return new ConfigProvider(fakeCtx, baseConfig(storageDir), storageDir ?? newTempDir('cfg-stub-'));
}

function stubLlm(): LlmRuntimeLike {
  return { listProviders: () => [], listModels: async () => [], resolveModelInfo: async () => ({}) };
}

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

async function routeFor(svc: KanbanService, runner?: { runTask(taskId: string): Promise<void> } | null, onChainDeleted?: (chainId: string) => Promise<void> | void) {
  const provider = { service: svc, runner, onChainDeleted: onChainDeleted ?? null } as unknown as KanbanProvider;
  let route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> } | undefined;
  const webServerObj = { register(r: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) { route = r; return () => {}; } };
  const fakeCtx = { get: (name: string) => (name === 'webServer' ? webServerObj : undefined) } as never;
  registerKanbanHttp(fakeCtx, provider, stubConfigProvider(), stubLlm());
  return route!;
}

async function postAction(route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> }, payload: unknown) {
  const { res, body } = mockRes();
  await route.handler(mockReq('POST', '/kanban/action', JSON.stringify(payload)), res);
  return { status: res.statusCode, body: JSON.parse(body()) };
}

describe('kanban HTTP bridge', () => {
  it('serves board snapshot on GET /kanban/board', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      const route = await routeFor(svc);
      const { res, body } = mockRes();
      await route!.handler(mockReq('GET', '/kanban/board'), res);
      const data = JSON.parse(body());
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].title).toBe('t1');
      expect(data.chains[0].id).toBe(chain.id);
      expect(data.lastSeq).toBe(data.events.at(-1).seq);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('delete chain purges events and fires onChainDeleted hook (E/F)', async () => {
    const svc = new KanbanService(new FileEventStore(newTempDir('kb-http-del-')));
    const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
    await svc.createTask({ chainId: chain.id, title: 't', assignee: 'p', mode: 'openspec' }, 'v');
    const deleted: string[] = [];
    const route = await routeFor(svc, null, (id) => { deleted.push(id); });
    const r = await postAction(route!, { type: 'delete', chainId: chain.id });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(deleted).toEqual([chain.id]);
    const state = await svc.snapshot();
    expect(state.chains.size).toBe(0);
    expect(state.tasks.size).toBe(0);
    expect(state.events.length).toBe(0); // purge 物理移除全部链事件
  });

  it('blocks a task via POST /kanban/action', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      await svc.claimTask(t.id, 'system'); // todo→running，block 才合法
      const route = await routeFor(svc);
      const { res, body } = mockRes();
      await route!.handler(mockReq('POST', '/kanban/action', JSON.stringify({ type: 'block', taskId: t.id, reason: 'GUI block' })), res);
      expect(JSON.parse(body())).toEqual({ ok: true });
      const state = await svc.snapshot();
      expect(state.tasks.get(t.id)!.status).toBe('blocked');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not register when webServer absent (CLI/headless)', () => {
    const fakeCtx = { get: () => undefined } as never; // 无 webServer 服务
    expect(() => registerKanbanHttp(fakeCtx, { service: {} } as unknown as KanbanProvider, stubConfigProvider(), stubLlm())).not.toThrow();
  });

  it('validates and records a human comment action', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      const route = await routeFor(svc);
      const result = await postAction(route, { type: 'comment', taskId: t.id, body: '请补充失败路径' });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });
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
      const result = await postAction(route, { type: 'complete', taskId: t.id, summary: 'GUI done', metadata: { note: 'x', kb_url: 'http://x', page_path: '/kb/x' } });
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });
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
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ ok: true });
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
      expect(result.status).toBe(409);
      expect(result.body.error).toContain('invalid state');
      expect(result.body.error).toContain('running');
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
      expect(result.status).toBe(503);
      expect(result.body.error).toContain('dispatcher not ready');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects retry for an unknown task with 404', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const runTask = vi.fn(async () => {});
      const result = await postAction(await routeFor(svc, { runTask }), { type: 'retry', taskId: 't_does_not_exist' });
      expect(result.status).toBe(404);
      expect(result.body.error).toContain('unknown task');
      expect(runTask).not.toHaveBeenCalled();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });


  it('confirms chain audit via POST /kanban/action {type:confirm-audit, chainId}', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      await svc.auditWarning(chain.id, [{ source: 's', detail: 'd', paths: ['p'] }], 'system');
      const route = await routeFor(svc);
      const ok = await postAction(route, { type: 'confirm-audit', chainId: chain.id });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ ok: true });
      const state = await svc.snapshot();
      expect(state.events.at(-1)?.kind).toBe('chain/audit-confirmed');
      expect(state.auditWarnings.get(chain.id)!.confirmedAt).toBeTruthy();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects confirm-audit without chainId', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const route = await routeFor(svc);
      const res = await postAction(route, { type: 'confirm-audit' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('chainId required');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('renames a chain and a task via POST /kanban/action {type:rename}', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: '【需求】旧', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 'p', assignee: 'w', mode: 'kb' }, 'v');
      const route = await routeFor(svc);
      const r1 = await postAction(route, { type: 'rename', chainId: chain.id, title: '【需求】新' });
      expect(r1.status).toBe(200);
      expect(r1.body).toEqual({ ok: true });
      const r2 = await postAction(route, { type: 'rename', taskId: t.id, title: 'p-新' });
      expect(r2.status).toBe(200);
      const state = await svc.snapshot();
      expect(state.chains.get(chain.id)!.title).toBe('【需求】新');
      expect(state.tasks.get(t.id)!.title).toBe('p-新');
      expect(state.events.at(-1)?.kind).toBe('task/renamed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects rename without chainId/taskId or with empty title', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const route = await routeFor(svc);
      const r1 = await postAction(route, { type: 'rename', title: 'x' });
      expect(r1.status).toBe(400);
      expect(r1.body.error).toContain('chainId or taskId');
      const r2 = await postAction(route, { type: 'rename', chainId: 'ch_x', title: '   ' });
      expect(r2.status).toBe(400);
      expect(r2.body.error).toContain('title required');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects unknown actions and empty required fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-http-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: 'c', ownerSessionId: 's' }, 'human');
      const t = await svc.createTask({ chainId: chain.id, title: 't1', assignee: 'w', mode: 'kb' }, 'v');
      const route = await routeFor(svc);
      expect((await postAction(route, { type: 'nope', taskId: t.id })).body.error).toContain('unknown action');
      expect((await postAction(route, { type: 'block', taskId: t.id, reason: '  ' })).body.error).toContain('reason required');
      expect((await postAction(route, { type: 'complete', taskId: t.id, summary: '' })).body.error).toContain('summary required');
      expect((await postAction(route, { type: 'comment', taskId: t.id, body: '' })).body.error).toContain('body required');
      expect((await postAction(route, { type: 'archive' })).body.error).toContain('taskId required');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

function configRoute(svc: KanbanService): { route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> }; cp: ConfigProvider } {
  const dir = newTempDir('cfg-route-');
  const cp = stubConfigProvider(dir);
  const llm: LlmRuntimeLike = {
    listProviders: () => [{ id: 'openai', name: 'OpenAI' }],
    listModels: async () => [{ id: 'gpt-test', name: 'GPT Test' }],
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: 'high', name: 'High' }] } }),
  };
  let route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> } | undefined;
  const webServerObj = { register(r: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) { route = r; return () => {}; } };
  const fakeCtx = { get: (n: string) => (n === 'webServer' ? webServerObj : undefined) } as never;
  registerKanbanHttp(fakeCtx, { service: svc } as never, cp, llm);
  return { route: route!, cp };
}

describe('config HTTP', () => {
  it('GET /kanban/config 返回 effective + sources', async () => {
    const dir = newTempDir('cfg-http-');
    const svc = new KanbanService(new FileEventStore(dir));
    const { route } = configRoute(svc);
    const { res, body } = mockRes();
    await route.handler(mockReq('GET', '/kanban/config'), res);
    expect(res.statusCode).toBe(200);
    const d = JSON.parse(body());
    expect(d.effective.wikiVault.baseUrl).toBe('http://10.0.0.1:3000');
    expect(d.sources['wikiVault.baseUrl']).toBe('inherited');
  });

  it('PUT /kanban/config 非法 baseUrl → 400 + fields', async () => {
    const dir = newTempDir('cfg-http-');
    const svc = new KanbanService(new FileEventStore(dir));
    const { route } = configRoute(svc);
    const { res, body } = mockRes();
    await route.handler(mockReq('PUT', '/kanban/config', JSON.stringify({ wikiVault: { baseUrl: 'bad', pagePrefix: 'x/' }, roles: { models: {} } })), res);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(body()).fields).toContain('wikiVault.baseUrl');
  });

  it('PUT /kanban/config 合法 → 200 ok + 热生效 + GET 可见', async () => {
    const dir = newTempDir('cfg-http-');
    const svc = new KanbanService(new FileEventStore(dir));
    const { route } = configRoute(svc);
    const put = await (() => {
      const { res, body } = mockRes();
      return route.handler(mockReq('PUT', '/kanban/config', JSON.stringify({ wikiVault: { baseUrl: 'http://9.9.9.9:1', pagePrefix: 'projects/' }, roles: { models: {} } })), res).then(() => ({ status: res.statusCode, body: JSON.parse(body()) }));
    })();
    expect(put.status).toBe(200);
    expect(put.body.ok).toBe(true);
    expect(put.body.effective.wikiVault.baseUrl).toBe('http://9.9.9.9:1');
    expect(put.body.sources['wikiVault.baseUrl']).toBe('override');
    const get = await (() => {
      const { res, body } = mockRes();
      return route.handler(mockReq('GET', '/kanban/config'), res).then(() => ({ status: res.statusCode, body: JSON.parse(body()) }));
    })();
    expect(get.body.effective.wikiVault.baseUrl).toBe('http://9.9.9.9:1');
  });

  it('POST /kanban/config/reset 清 override 回基线', async () => {
    const dir = newTempDir('cfg-http-');
    const svc = new KanbanService(new FileEventStore(dir));
    const { route, cp } = configRoute(svc);
    cp.applyOverride({ wikiVault: { baseUrl: 'http://9.9.9.9:1', pagePrefix: 'projects/' }, roles: { models: {} }, reviewEngine: { mode: 'delegate', managed: { provider: '', model: '' } } });
    const { res, body } = mockRes();
    await route.handler(mockReq('POST', '/kanban/config/reset'), res);
    expect(res.statusCode).toBe(200);
    const d = JSON.parse(body());
    expect(d.effective.wikiVault.baseUrl).toBe('http://10.0.0.1:3000');
    expect(d.sources['wikiVault.baseUrl']).toBe('inherited');
  });

  it('GET /kanban/llm-catalog 返回 providers/models/efforts', async () => {
    const dir = newTempDir('cfg-http-');
    const svc = new KanbanService(new FileEventStore(dir));
    const { route } = configRoute(svc);
    const { res, body } = mockRes();
    await route.handler(mockReq('GET', '/kanban/llm-catalog'), res);
    expect(res.statusCode).toBe(200);
    const d = JSON.parse(body());
    expect(d.providers).toEqual([{ id: 'openai', name: 'OpenAI' }]);
    expect(d.models['openai'][0].id).toBe('gpt-test');
    expect(d.models['openai'][0].efforts).toEqual([{ id: 'high', name: 'High' }]);
  });
});

describe('ocr HTTP', () => {
  type KanbanHttpMod = typeof import('../../src/routes/kanban-http.js');
  type OcrDeps = NonNullable<Parameters<KanbanHttpMod['registerKanbanHttp']>[5]>;

  // installJob 是模块级单飞任务态：每个用例重载模块隔离，互不串状态
  const freshModule = async (): Promise<KanbanHttpMod> => {
    vi.resetModules();
    return import('../../src/routes/kanban-http.js');
  };

  interface OcrRouteOpts {
    probe?: { installed: boolean; version: string; binPath?: string | null };
    managedReady?: boolean;
    installer?: OcrDeps['installer'];
    wirer?: OcrDeps['wirer'];
    settingsValue?: unknown;
  }

  function ocrRoute(mod: KanbanHttpMod, opts: OcrRouteOpts): { route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> }; cp: ConfigProvider } {
    const cp = stubConfigProvider(newTempDir('ocr-route-'));
    let route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> } | undefined;
    const webServerObj = { register(r: { handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) { route = r; return () => {}; } };
    const fakeCtx = {
      get: (n: string) =>
        n === 'webServer' ? webServerObj
        : (n === 'settings' && opts.settingsValue !== undefined) ? { describe: () => [{ ns: 'llm-pi-ai', value: opts.settingsValue }] }
        : undefined,
    } as never;
    mod.registerKanbanHttp(fakeCtx, { service: {} } as unknown as KanbanProvider, cp, stubLlm(), undefined, {
      probeFn: async () => (opts.probe ? { binPath: null, ...opts.probe } : { installed: true, version: 'ocr 1.0.0', binPath: null }),
      managedReadyFn: () => opts.managedReady ?? false,
      installer: opts.installer,
      wirer: opts.wirer,
    });
    return { route: route!, cp };
  }

  async function httpJson(
    route: { handler(req: IncomingMessage, res: ServerResponse): Promise<void> },
    method: string,
    url: string,
    payload?: unknown,
  ) {
    const { res, body } = mockRes();
    await route.handler(mockReq(method, url, payload === undefined ? undefined : JSON.stringify(payload ?? {})), res);
    return { status: res.statusCode, body: JSON.parse(body() || '{}') as Record<string, unknown> };
  }

  it('GET /kanban/ocr/status 返回 probe 结果 + 评审模式 + 托管就绪', async () => {
    const mod = await freshModule();
    const { route } = ocrRoute(mod, { probe: { installed: true, version: 'ocr 1.2.3' }, managedReady: true });
    const r = await httpJson(route, 'GET', '/kanban/ocr/status');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ installed: true, version: 'ocr 1.2.3', mode: 'delegate', managedReady: true });
  });

  it('POST /kanban/ocr/install 启动单飞安装；进行中重复请求 409', async () => {
    const mod = await freshModule();
    let release!: (v: { ok: boolean; log: string }) => void;
    const installer = vi.fn(() => new Promise<{ ok: boolean; log: string }>((resolve) => { release = resolve; }));
    const { route } = ocrRoute(mod, { installer: installer as never });
    const first = await httpJson(route, 'POST', '/kanban/ocr/install');
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(typeof first.body.id).toBe('string');
    expect(installer).toHaveBeenCalledTimes(1);
    const second = await httpJson(route, 'POST', '/kanban/ocr/install');
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: 'install-in-progress' });
    release({ ok: true, log: 'added 1 package' });
    await vi.waitFor(async () => {
      const done = await httpJson(route, 'GET', '/kanban/ocr/install/state');
      expect(done.body).toMatchObject({ running: false, result: 'ok', version: 'ocr 1.0.0' });
    });
  });

  it('GET /kanban/ocr/install/state 反映 running→ok 流转（fake installer 手动 resolve）', async () => {
    const mod = await freshModule();
    let release!: (v: { ok: boolean; log: string }) => void;
    const installer = () => new Promise<{ ok: boolean; log: string }>((resolve) => { release = resolve; });
    const { route } = ocrRoute(mod, { installer, probe: { installed: true, version: 'ocr 9.9.9' } });
    const empty = await httpJson(route, 'GET', '/kanban/ocr/install/state');
    expect(empty.body).toEqual({ running: false, log: '' });
    await httpJson(route, 'POST', '/kanban/ocr/install');
    const running = await httpJson(route, 'GET', '/kanban/ocr/install/state');
    expect(running.body.running).toBe(true);
    release({ ok: true, log: 'added 1 package' });
    await vi.waitFor(async () => {
      const done = await httpJson(route, 'GET', '/kanban/ocr/install/state');
      expect(done.body).toEqual({ running: false, result: 'ok', version: 'ocr 9.9.9', log: 'added 1 package' });
    });
  });

  it('POST /kanban/ocr/install/cancel 杀掉安装子进程并置 cancelled；迟到的安装结果不覆盖终态', async () => {
    const mod = await freshModule();
    let release!: (v: { ok: boolean; log: string }) => void;
    const kill = vi.fn();
    const installer = (onSpawn?: (child: { kill(sig?: string): boolean }) => void) =>
      new Promise<{ ok: boolean; log: string }>((resolve) => {
        release = resolve;
        onSpawn?.({ kill });
      });
    const { route } = ocrRoute(mod, { installer });
    await httpJson(route, 'POST', '/kanban/ocr/install');
    const cancelled = await httpJson(route, 'POST', '/kanban/ocr/install/cancel');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toEqual({ ok: true });
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    const state = await httpJson(route, 'GET', '/kanban/ocr/install/state');
    expect(state.body.running).toBe(false);
    expect(state.body.result).toBe('cancelled');
    // 安装进程在 SIGTERM 后自行退出（失败收场）：终态保持 cancelled 不被覆盖
    release({ ok: false, log: 'terminated' });
    await vi.waitFor(async () => {
      const after = await httpJson(route, 'GET', '/kanban/ocr/install/state');
      expect(after.body.result).toBe('cancelled');
      expect(after.body.running).toBe(false);
    });
  });

  it('POST /kanban/ocr/install/cancel 无进行中任务返回 no-install-running', async () => {
    const mod = await freshModule();
    const { route } = ocrRoute(mod, {});
    const r = await httpJson(route, 'POST', '/kanban/ocr/install/cancel');
    expect(r.body).toEqual({ ok: false, error: 'no-install-running' });
  });

  it('POST /kanban/ocr/wire 解析到接入信息 → 调 wirer 并透传结果', async () => {
    const mod = await freshModule();
    const wirer = vi.fn(async () => ({ ok: true, log: 'ocr managed provider wired: dsh-managed' }));
    const { route } = ocrRoute(mod, {
      wirer,
      settingsValue: { providers: { gpt: { apiKey: 'sk-test', api: 'openai-responses', baseURL: 'https://api.example.com' } } },
    });
    const r = await httpJson(route, 'POST', '/kanban/ocr/wire', { provider: 'gpt', model: 'm1' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, log: 'ocr managed provider wired: dsh-managed' });
    expect(wirer).toHaveBeenCalledWith({ provider: 'gpt', model: 'm1' });
  });

  it('POST /kanban/ocr/wire 解析不到接入信息 → 降级固定文案且不写半套配置', async () => {
    const mod = await freshModule();
    const wirer = vi.fn();
    const { route } = ocrRoute(mod, { wirer });
    const r = await httpJson(route, 'POST', '/kanban/ocr/wire', { provider: 'gpt', model: 'm1' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(String(r.body.log)).toContain('未能从 dsh 解析该提供方的接入信息');
    expect(wirer).not.toHaveBeenCalled();
  });

  it('POST /kanban/ocr/wire ocr 未安装 → 返回安装指引', async () => {
    const mod = await freshModule();
    const wirer = vi.fn();
    const { route } = ocrRoute(mod, {
      wirer,
      probe: { installed: false, version: '' },
      settingsValue: { providers: { gpt: { apiKey: 'sk-test', api: 'openai-responses', baseURL: 'https://api.example.com' } } },
    });
    const r = await httpJson(route, 'POST', '/kanban/ocr/wire', { provider: 'gpt', model: 'm1' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.log).toBe(INSTALL_GUIDANCE);
    expect(wirer).not.toHaveBeenCalled();
  });
});

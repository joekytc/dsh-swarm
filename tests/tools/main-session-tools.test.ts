import { describe, it, expect, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { buildSpawnPrefetch, planningBySession, registerMainSessionTools } from '../../src/tools/main-session-tools.js';
import { OPENSPEC_FIRST_CARD } from '../../src/routes/prefix-router.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { DEFAULT_PREFIX_ROUTES } from '../../src/config.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (n: string) => services[n] } as unknown as Context;
}

/** 构造缝 stub：start 记录请求，返回 run（result/dispose 可定制）。 */
function seamStub(result: { stopReason: string; output?: Array<{ type: string; text?: string }>; structured?: unknown; error?: string } = { stopReason: 'completed', structured: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] } }) {
  const calls: Array<{ name: string; request: Record<string, unknown> }> = [];
  const dispose = vi.fn(async () => undefined);
  const start = vi.fn(async (name: string, request: Record<string, unknown>) => {
    calls.push({ name, request });
    return { id: 'kbn-prefetch-child', result: Promise.resolve(result), dispose };
  });
  return { start, dispose, calls };
}

const PARENT = { id: 'agent-main', session: { id: 'session_main' } } as never;

describe('buildSpawnPrefetch (官方子代理缝)', () => {
  it('无 subagents 服务 → undefined（prefetch 不可用）', () => {
    expect(buildSpawnPrefetch(fakeCtx({}))).toBeUndefined();
    expect(buildSpawnPrefetch(fakeCtx({ subagents: {} }))).toBeUndefined();
  });
  it('缺 parent agent → 快速失败（不静默退化为无血缘会话）', async () => {
    const seam = seamStub();
    const spawn = buildSpawnPrefetch(fakeCtx({ subagents: { start: seam.start } }))!;
    await expect(spawn('x', '/ws/repo')).rejects.toThrow(/missing parent agent/);
    expect(seam.start).not.toHaveBeenCalled();
  });
  it('正常路径：start("spawn") 传全契约字段（label/parent/maxDepth/toolFilter/outputSchema）+ attach run.id + 返回 structured + finally dispose', async () => {
    const seam = seamStub();
    const attaches: string[] = [];
    const entity = { id: 'ws-1', attachSession: async (sid: unknown) => { attaches.push(String(sid)); } };
    const ctx = fakeCtx({
      subagents: { start: seam.start },
      workspaceRegistry: { resolveByPath: async (p: string) => (p === '/ws/repo' ? entity : undefined), create: async () => entity },
    });
    const spawn = buildSpawnPrefetch(ctx)!;
    const out = await spawn('采集事实', '/ws/repo', PARENT);
    // 契约断言：请求字段逐项钉死（对齐 memory 硬约束）
    expect(seam.calls).toHaveLength(1);
    const req = seam.calls[0]!.request;
    expect(seam.calls[0]!.name).toBe('spawn');
    expect(req['label']).toBe('prefetch');
    expect(req['parent']).toBe(PARENT);
    expect(req['maxDepth']).toBe(1);
    expect(req['toolFilter']).toEqual({ deny: ['bash', 'edit', 'write'] });
    expect((req['outputSchema'] as { type: string }).type).toBe('object');
    expect(req['prompt']).toEqual([{ type: 'text', text: '采集事实' }]);
    // 归组用缝生成的子会话 id（run.id）
    expect(attaches).toContain('kbn-prefetch-child');
    // structured 优先
    const parsed = JSON.parse(out) as { repo: { localPath: string } };
    expect(parsed.repo.localPath).toBe('/ws/repo');
    // dispose 必在 finally
    expect(seam.dispose).toHaveBeenCalledTimes(1);
  });
  it('非 completed 终止（stopReason=error）→ 抛错带诊断，且仍 dispose', async () => {
    const seam = seamStub({ stopReason: 'error', error: 'child failed schema validation' });
    const spawn = buildSpawnPrefetch(fakeCtx({ subagents: { start: seam.start } }))!;
    await expect(spawn('x', '/ws/repo', PARENT)).rejects.toThrow(/stopReason=error.*schema validation/);
    expect(seam.dispose).toHaveBeenCalledTimes(1);
  });
  it('start 被拒（能力不足/接线缺失）→ 抛错并带原因', async () => {
    const start = vi.fn(async () => { throw new Error('provider "spawn" lacks capability: outputSchema'); });
    const spawn = buildSpawnPrefetch(fakeCtx({ subagents: { start } }))!;
    await expect(spawn('x', '/ws/repo', PARENT)).rejects.toThrow(/subagent start failed.*outputSchema/);
  });
  it('无 structured 时文本兜底（能力缺失防御）', async () => {
    const seam = seamStub({ stopReason: 'completed', output: [{ type: 'text', text: '{"repo":{"localPath":"/a","dirtyFiles":[]},"files":[]}' }] });
    const spawn = buildSpawnPrefetch(fakeCtx({ subagents: { start: seam.start } }))!;
    const out = await spawn('x', '/ws/repo', PARENT);
    expect(out).toContain('"/a"');
  });
});

describe('registerMainSessionTools (ConfigProvider 接线)', () => {
  it('stub configProvider 注册工具面 + 前缀路由经 getEffective() 调用时热读取', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mst-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const baseConfig = {
        storageDir: dir,
        wikiVault: { baseUrl: 'http://mock', pagePrefix: 'projects/' },
        prefixRoutes: { ...DEFAULT_PREFIX_ROUTES },
        memory: { enabled: true, maxIndexEntries: 8 },
      };
      const configProvider = { getEffective: () => baseConfig } as never;
      const ctx = {
        get(key: string) {
          if (key === 'tools') return { register(def: { name?: string }): () => void { registry.push(def as never); return () => {}; } };
          if (key === 'kanban') return { service: svc };
          if (key === 'wiki') return { search: async () => [], write: async (p: string) => ({ path: p }) };
          return undefined;
        },
      } as unknown as Context;
      registerMainSessionTools(ctx, configProvider);
      expect(registry.map((t) => t.name)).toContain('kanban_route');
      expect(registry.map((t) => t.name)).toContain('planning_checklist_save');
      const route = registry.find((t) => t.name === 'kanban_route')!;
      const plan = await route.execute({ message: '/plan: 优化登录' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string };
      expect(plan.kind).toBe('plan');
      // 热生效：变更基线配置后，前缀路由按 getEffective() 最新值匹配（注册时未捕获旧值）
      baseConfig.prefixRoutes = { plan: '/p:', openspec: '/o:', learning: '/l' };
      const hot = await route.execute({ message: '/p: 需求二' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string };
      expect(hot.kind).toBe('plan');
      const old = await route.execute({ message: '/plan: 需求三' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string };
      expect(old.kind).toBe('none');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('kanban_route /openspec: workspace-mismatch 闸2', () => {
  const validChecklist = {
    requirementName: '优化登录',
    spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
    manifest: { repo: { localPath: '/ws/repo', dirtyFiles: [] }, files: [] },
    clarifications: [], doubts: [],
  };
  function wmCtx(svc: KanbanService, registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }>): Context {
    return {
      get(key: string) {
        if (key === 'tools') return { register(def: { name?: string }): () => void { registry.push(def as never); return () => {}; } };
        if (key === 'kanban') return { service: svc };
        if (key === 'wiki') return { search: async () => [], write: async (p: string) => ({ path: p }) };
        return undefined;
      },
    } as unknown as Context;
  }

  it('/openspec:: localPath 与 workspaceDir 不一致 → 不建链，返回 workspace-mismatch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mst-wm1-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      registerMainSessionTools(wmCtx(svc, registry), { getEffective: () => ({ prefixRoutes: { ...DEFAULT_PREFIX_ROUTES } }) } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      planningBySession.set('session_main', {
        workspaceDir: '/ws/other-repo', sessionId: 'session_main',
        checklist: validChecklist, checklistRef: 'projects/ws/checklists/session_main.md',
        checklistSource: 'kb', requirementName: '优化登录',
      });
      const before = (await svc.snapshot()).chains.size;
      const res = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; approved?: boolean; reason?: string; error?: string };
      expect(res.kind).toBe('openspec');
      expect(res.approved).toBe(false);
      expect(res.reason).toBe('workspace-mismatch');
      expect(res.error).toContain('[workspace-mismatch]');
      expect(res.error).toContain('/ws/repo');
      expect(res.error).toContain('/ws/other-repo');
      expect((await svc.snapshot()).chains.size).toBe(before); // 硬闸：未建链
    } finally { planningBySession.delete('session_main'); rmSync(dir, { recursive: true, force: true }); }
  });

  it('/openspec:: workspaceDir 为 null 且 exec 无 headerCwd → 补捕解析 null，仍 fail-fast workspace-unknown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mst-wm2-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      registerMainSessionTools(wmCtx(svc, registry), { getEffective: () => ({ prefixRoutes: { ...DEFAULT_PREFIX_ROUTES } }) } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      planningBySession.set('session_main', {
        workspaceDir: null, sessionId: 'session_main',
        checklist: validChecklist, checklistRef: 'projects/ws/checklists/session_main.md',
        checklistSource: 'kb', requirementName: '优化登录',
      });
      const res = await route.execute({ message: '/openspec: 确认' }, {}) as { kind: string; approved?: boolean; reason?: string; chainId?: string };
      expect(res.kind).toBe('openspec');
      expect(res.reason).not.toBe('workspace-mismatch');
      // workspaceDir=null 不触发闸2；exec 无 headerCwd → 恢复补捕解析 null → 走 workspace-unknown fail-fast
      //（不建链、不猜测工作区，fail-closed 语义原样）
      expect(res.reason).toBe('workspace-unknown');
      expect(res.approved).toBe(false);
      expect((await svc.snapshot()).chains.size).toBe(0);
    } finally { planningBySession.delete('session_main'); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('kanban_route /openspec: 恢复路径补捕 cwd', () => {
  function checklistWith(localPath: string) {
    return {
      requirementName: '优化登录',
      spec: { problem: 'p', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' },
      manifest: { repo: { localPath, dirtyFiles: [] }, files: [] },
      clarifications: [], doubts: [],
    };
  }
  function recoveryCtx(
    svc: KanbanService,
    registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }>,
    opts?: { wsResolve?: (p: string) => unknown; create?: (p: string) => Promise<unknown>; ask?: unknown },
  ): Context {
    return {
      get(key: string) {
        if (key === 'tools') return { register(def: { name?: string }): () => void { registry.push(def as never); return () => {}; } };
        if (key === 'kanban') return { service: svc };
        if (key === 'wiki') return { search: async () => [{ path: 'projects/ws/checklists/session_main.md' }], write: async (p: string) => ({ path: p }) };
        if (key === 'workspaceRegistry') return { resolveByPath: async (p: string) => opts?.wsResolve?.(p), create: opts?.create ?? (async () => ({ id: 'ws-new' })) };
        if (key === 'userQuestions') return { ask: opts?.ask };
        return undefined;
      },
    } as unknown as Context;
  }

  it('路由1 补捕：内存有清单 workspaceDir=null + exec 带 headerCwd → 捡回工作区，建链收到补捕后的 workspaceDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mst-rc1-'));
    const saved = { timeoutMs: OPENSPEC_FIRST_CARD.timeoutMs, pollIntervalMs: OPENSPEC_FIRST_CARD.pollIntervalMs };
    OPENSPEC_FIRST_CARD.timeoutMs = 60; // 防线D fail-open 短值：无 V 建卡时快速返回 pending，不挂测试
    OPENSPEC_FIRST_CARD.pollIntervalMs = 10;
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      registerMainSessionTools(recoveryCtx(svc, registry, { wsResolve: (p) => (p === '/ws/x' ? { id: 'ws-x', attachSession: async () => undefined } : undefined) }), { getEffective: () => ({ prefixRoutes: { ...DEFAULT_PREFIX_ROUTES } }) } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      planningBySession.set('session_main', {
        workspaceDir: null, sessionId: 'session_main',
        checklist: checklistWith('/ws/x'), checklistRef: 'projects/ws/checklists/session_main.md',
        checklistSource: 'kb', requirementName: '优化登录',
      });
      const res = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws/x' } } } }) as { kind: string; approved?: boolean; reason?: string; chainId?: string };
      expect(planningBySession.get('session_main')?.workspaceDir).toBe('/ws/x'); // 补捕①回写 planningBySession
      expect(res.kind).toBe('openspec');
      expect(res.approved).toBe(true); // 不再 workspace-unknown
      const chain = (await svc.snapshot()).chains.get(res.chainId!);
      expect(chain?.workspaceDir).toBe('/ws/x'); // handleOpenspecRoute 收到 workspaceDir='/ws/x'
    } finally {
      OPENSPEC_FIRST_CARD.timeoutMs = saved.timeoutMs;
      OPENSPEC_FIRST_CARD.pollIntervalMs = saved.pollIntervalMs;
      planningBySession.delete('session_main');
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('路由1 补捕解析 null（exec 无 headerCwd）→ 仍 fail-fast workspace-unknown，不被猜路径污染', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mst-rc2-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      registerMainSessionTools(recoveryCtx(svc, registry), { getEffective: () => ({ prefixRoutes: { ...DEFAULT_PREFIX_ROUTES } }) } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      planningBySession.set('session_main', {
        workspaceDir: null, sessionId: 'session_main',
        checklist: checklistWith('/ws/repo'), checklistRef: 'projects/ws/checklists/session_main.md',
        checklistSource: 'kb', requirementName: '优化登录',
      });
      const before = (await svc.snapshot()).chains.size;
      const res = await route.execute({ message: '/openspec: 确认' }, {}) as { kind: string; approved?: boolean; reason?: string };
      expect(res.kind).toBe('openspec');
      expect(res.reason).toBe('workspace-unknown');
      expect(res.approved).toBe(false);
      expect((await svc.snapshot()).chains.size).toBe(before); // 未建链
      expect(planningBySession.get('session_main')?.workspaceDir).toBeNull(); // 解析 null 不回写、不猜路径
    } finally { planningBySession.delete('session_main'); rmSync(dir, { recursive: true, force: true }); }
  });

  it('路由2 补捕：无内存条目 + exec 带 headerCwd → planningBySession 写入 workspaceDir，恢复 guidance 行为不回归', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mst-rc3-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      registerMainSessionTools(recoveryCtx(svc, registry, { wsResolve: (p) => (p === '/ws/x' ? { id: 'ws-x', attachSession: async () => undefined } : undefined) }), { getEffective: () => ({ prefixRoutes: { ...DEFAULT_PREFIX_ROUTES } }) } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      planningBySession.delete('session_main');
      const res = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws/x' } } } }) as { kind: string; approved?: boolean; reason?: string; recovery?: string; guidance?: string };
      const saved = planningBySession.get('session_main');
      expect(saved?.workspaceDir).toBe('/ws/x'); // 补捕②写入
      expect(saved?.sessionId).toBe('session_main'); // PlanningContext 完整形状
      expect(res.reason).toBe('no-checklist');
      expect(res.recovery).toBe('kb');
      expect(res.guidance).toContain('恢复步骤'); // 恢复 guidance 照常返回
    } finally { planningBySession.delete('session_main'); rmSync(dir, { recursive: true, force: true }); }
  });

  it('路由2 无 headerCwd → 行为与现状一致：不抛错，恢复 guidance 照常，不写 workspaceDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mst-rc4-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      registerMainSessionTools(recoveryCtx(svc, registry), { getEffective: () => ({ prefixRoutes: { ...DEFAULT_PREFIX_ROUTES } }) } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      planningBySession.delete('session_main');
      const res = await route.execute({ message: '/openspec: 确认' }, {}) as { kind: string; reason?: string; recovery?: string; guidance?: string };
      expect(res.reason).toBe('no-checklist');
      expect(res.recovery).toBe('kb');
      expect(res.guidance).toContain('恢复步骤');
      expect(planningBySession.get('session_main')?.workspaceDir ?? null).toBeNull(); // 无 cwd 不写入
    } finally { planningBySession.delete('session_main'); rmSync(dir, { recursive: true, force: true }); }
  });

  it('快乐路径：workspaceDir 已有值 → 不调 resolveOrCreateWorkspace（无多余弹 ask、不回写）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mst-rc5-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const registry: Array<{ name?: string; execute(args: unknown, exec?: unknown): Promise<unknown> }> = [];
      const ask = vi.fn(async () => ({ answers: [] }));
      const create = vi.fn(async () => ({ id: 'ws-new', attachSession: async () => undefined }));
      // resolveByPath 永 miss + create/ask 可观察：若补捕误触发（cwd='/ws' 未注册）必弹 ask
      registerMainSessionTools(recoveryCtx(svc, registry, { wsResolve: () => undefined, create, ask }), { getEffective: () => ({ prefixRoutes: { ...DEFAULT_PREFIX_ROUTES } }) } as never);
      const route = registry.find((t) => t.name === 'kanban_route')!;
      planningBySession.set('session_main', {
        workspaceDir: '/ws/repo', sessionId: 'session_main',
        checklist: checklistWith('/ws/elsewhere'), checklistRef: 'projects/ws/checklists/session_main.md',
        checklistSource: 'kb', requirementName: '优化登录',
      });
      const res = await route.execute({ message: '/openspec: 确认' }, { agent: { session: { header: { cwd: '/ws' } } } }) as { kind: string; reason?: string };
      expect(ask).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(planningBySession.get('session_main')?.workspaceDir).toBe('/ws/repo'); // 未被改写
      expect(res.reason).toBe('workspace-mismatch'); // 正常走到闸2（用已有 workspaceDir 判定）
    } finally { planningBySession.delete('session_main'); rmSync(dir, { recursive: true, force: true }); }
  });
});

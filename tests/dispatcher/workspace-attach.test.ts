import { describe, it, expect, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { attachSessionToWorkspace, resolveOrCreateWorkspace } from '../../src/dispatcher/workspace-attach.js';

type Ctx = { get(n: string): unknown };
function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (n: string) => services[n] } as unknown as Context;
}

const SID = 'kbn-t-abc';
const CWD = '/ws/main';
const LABEL = 'task t-abc w/file';

/** 最小假 Workspace 实体：携带 attachSession（真实 API 中 attachSession 在实体上，不在 registry 上）。 */
function fakeEntity(id: string) {
  return { id, attachSession: vi.fn(async () => {}) };
}

/** 最小假 workspaceRegistry：resolveByPath/create 返回携带 attachSession 的实体。 */
function fakeWs(opts: { existing?: boolean; throwsCreate?: boolean } = {}) {
  const existingEntity = fakeEntity('ws-1');
  const newEntity = fakeEntity('ws-new');
  return {
    existingEntity,
    newEntity,
    resolveByPath: vi.fn(async () => (opts.existing ? existingEntity : undefined)),
    create: vi.fn(async () => { if (opts.throwsCreate) throw new Error('create-fail'); return newEntity; }),
  };
}

describe('resolveOrCreateWorkspace', () => {
  it('cwd 已知且已注册 → 直接返回 cwd，不 create', async () => {
    const ws = fakeWs({ existing: true });
    const ctx = fakeCtx({ workspaceRegistry: ws });
    const got = await resolveOrCreateWorkspace(ctx, CWD, LABEL);
    expect(got).toBe(CWD);
    expect(ws.create).not.toHaveBeenCalled();
  });
  it('cwd 已知、未注册、ask 选「创建」→ create(cwd) 并返回 cwd', async () => {
    const ws = fakeWs();
    const uq = { ask: vi.fn(async () => ({ answers: [{ id: 'workspace-register', selected: ['创建'], custom: undefined }] })) };
    const ctx = fakeCtx({ workspaceRegistry: ws, userQuestions: uq });
    const got = await resolveOrCreateWorkspace(ctx, CWD, LABEL);
    expect(got).toBe(CWD);
    expect(ws.create).toHaveBeenCalledWith(CWD);
  });
  it('cwd 已知、未注册、ask 选「跳过」→ 仍返回 cwd，不 create（目录正确性优先，归组是 bonus）', async () => {
    const ws = fakeWs();
    const uq = { ask: vi.fn(async () => ({ answers: [{ id: 'workspace-register', selected: ['跳过'], custom: undefined }] })) };
    const ctx = fakeCtx({ workspaceRegistry: ws, userQuestions: uq });
    const got = await resolveOrCreateWorkspace(ctx, CWD, LABEL);
    expect(got).toBe(CWD);
    expect(ws.create).not.toHaveBeenCalled();
  });
  it('cwd 已知、ask 超时 → 返回 cwd 不抛（归组失败不阻断）', async () => {
    // 超时护栏 120s：用假时钟推进，避免单测真等 2 分钟（真绿≠假绿：必须推进超过 ASK_TIMEOUT_MS）
    vi.useFakeTimers();
    try {
      const ws = fakeWs();
      const uq = { ask: vi.fn(async () => new Promise(() => {})) }; // 永不 resolve
      const ctx = fakeCtx({ workspaceRegistry: ws, userQuestions: uq });
      const p = resolveOrCreateWorkspace(ctx, CWD, LABEL);
      await vi.advanceTimersByTimeAsync(120_000 + 1);
      await expect(p).resolves.toBe(CWD);
    } finally { vi.useRealTimers(); }
  });
  it('cwd 未知、ask 提供 custom 路径 → create 该路径并返回', async () => {
    const ws = fakeWs();
    const uq = { ask: vi.fn(async () => ({ answers: [{ id: 'workspace-register', selected: [], custom: '/tmp/alt' }] })) };
    const ctx = fakeCtx({ workspaceRegistry: ws, userQuestions: uq });
    const got = await resolveOrCreateWorkspace(ctx, null, LABEL);
    expect(got).toBe('/tmp/alt');
    expect(ws.create).toHaveBeenCalledWith('/tmp/alt');
  });
  it('cwd 未知、无 userQuestions 通道 → 返回 null', async () => {
    const ws = fakeWs();
    const ctx = fakeCtx({ workspaceRegistry: ws });
    const got = await resolveOrCreateWorkspace(ctx, null, LABEL);
    expect(got).toBeNull();
  });
  it('宿主无 workspaceRegistry → cwd 已知直接返回；未知返回 null', async () => {
    const ctx = fakeCtx({});
    expect(await resolveOrCreateWorkspace(ctx, CWD, LABEL)).toBe(CWD);
    expect(await resolveOrCreateWorkspace(ctx, null, LABEL)).toBeNull();
  });
});

describe('attachSessionToWorkspace', () => {
  it('已注册工作区 → 实体 attachSession(sessionId)', async () => {
    const ws = fakeWs({ existing: true });
    const ctx = fakeCtx({ workspaceRegistry: ws });
    await attachSessionToWorkspace(ctx, SID, CWD, LABEL);
    expect(ws.existingEntity.attachSession).toHaveBeenCalledWith(SID);
  });
  it('未注册 + ask 创建 → create 后实体 attachSession', async () => {
    const ws = fakeWs();
    const uq = { ask: vi.fn(async () => ({ answers: [{ id: 'workspace-register', selected: ['创建'], custom: undefined }] })) };
    const ctx = fakeCtx({ workspaceRegistry: ws, userQuestions: uq });
    await attachSessionToWorkspace(ctx, SID, CWD, LABEL);
    expect(ws.create).toHaveBeenCalledWith(CWD);
    expect(ws.newEntity.attachSession).toHaveBeenCalledWith(SID);
  });
  it('无 workspaceRegistry → 静默跳过', async () => {
    const ctx = fakeCtx({});
    await expect(attachSessionToWorkspace(ctx, SID, CWD, LABEL)).resolves.toBeUndefined();
  });
  it('实体 attach 抛错 → 静默（不阻断调用方）', async () => {
    const ws = fakeWs({ existing: true });
    ws.existingEntity.attachSession.mockRejectedValueOnce(new Error('cannot attach'));
    const ctx = fakeCtx({ workspaceRegistry: ws });
    await expect(attachSessionToWorkspace(ctx, SID, CWD, LABEL)).resolves.toBeUndefined();
  });
});

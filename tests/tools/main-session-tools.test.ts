import { describe, it, expect, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { buildSpawnPrefetch } from '../../src/tools/main-session-tools.js';

function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (n: string) => services[n] } as unknown as Context;
}

describe('buildSpawnPrefetch', () => {
  it('无 agents 服务 → undefined（prefetch 不可用）', () => {
    expect(buildSpawnPrefetch(fakeCtx({}))).toBeUndefined();
  });
  it('有 agents → 创建 prefetch 会话后 attach（sessionId=cwd 对应工作区）', async () => {
    const attaches: string[] = [];
    const agents = {
      create: async (opts: { sessionId?: string; meta?: { cwd?: string }; setup?: (c: unknown) => Promise<void> }) => {
        await opts.setup?.({ tools: {} } as never);
        return {
          agent: {
            followup: vi.fn(),
            whenIdle: vi.fn(async () => {}),
            session: { events: [] },
          },
        };
      },
    };
    const entity = {
      id: 'ws-1',
      attachSession: async (sid: unknown) => { attaches.push(String(sid)); },
    };
    const ctx = fakeCtx({
      agents,
      workspaceRegistry: {
        // attachSession 在 Workspace 实体上（registry 无 attachSession）：attachSessionToWorkspace 内部 resolveByPath ?? create 后取实体.attachSession
        resolveByPath: async (p: string) => (p === '/ws/repo' ? entity : undefined),
        create: async () => entity,
      },
    });
    const spawn = buildSpawnPrefetch(ctx)!;
    // 位置参数（与 PlanningToolDeps['spawnPrefetch'] 签名 (prompt, workspaceDir) 一致），
    // 传对象会令 workspaceDir 恒 undefined → cwd=process.cwd()，'/ws/repo' 分支不命中 → 假绿
    const out = await spawn('x', '/ws/repo');
    expect(typeof out).toBe('string');
    expect(attaches.some((a) => a.startsWith('kbn-prefetch-'))).toBe(true);
  });
});

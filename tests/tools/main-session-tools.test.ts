import { describe, it, expect, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { buildSpawnPrefetch } from '../../src/tools/main-session-tools.js';

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

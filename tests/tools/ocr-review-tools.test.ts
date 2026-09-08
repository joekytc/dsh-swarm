import { describe, it, expect, vi } from 'vitest';
import { buildOcrReviewTool } from '../../src/tools/ocr-review-tools.js';
import { INSTALL_GUIDANCE } from '../../src/services/ocr-cli.js';

function baseDeps(over: Partial<Parameters<typeof buildOcrReviewTool>[0]> = {}) {
  return {
    runOcrFn: vi.fn(async (_args: string[], _opts: { cwd: string; timeoutMs?: number }) => ({ stdout: '', stderr: '' })),
    probeFn: vi.fn(async () => ({ installed: true, version: 'ocr 1.0.0', binPath: '/usr/local/bin/ocr' })),
    managedReadyFn: vi.fn(() => true),
    cwd: () => '/ws/repo',
    ...over,
  };
}

function toolOf(deps: ReturnType<typeof baseDeps>) {
  return buildOcrReviewTool(deps) as unknown as {
    name: string;
    execute(args: Record<string, unknown>): Promise<string>;
  };
}

const previewJson = JSON.stringify({
  mode: 'range',
  files: [{ path: 'src/a.ts', status: 'modified' }],
  excluded: [{ path: 'lib/x.js', reason: 'ignored' }],
  merge_base: 'abc123',
});

describe('ocr_review tool', () => {
  it('工具名 ocr_review', () => {
    expect(toolOf(baseDeps()).name).toBe('ocr_review');
  });

  it('probe 未安装 → 返回 INSTALL_GUIDANCE 不抛错，preview/rule 一律拦截且不调 runOcr', async () => {
    for (const sub of ['preview', 'rule', 'managed']) {
      const deps = baseDeps({ probeFn: vi.fn(async () => ({ installed: false, version: '', binPath: null })) });
      const t = toolOf(deps);
      await expect(t.execute({ sub })).resolves.toBe(INSTALL_GUIDANCE);
      expect(deps.runOcrFn).not.toHaveBeenCalled();
    }
  });

  it('managed 且托管未就绪 → 返回委托模式引导文本，不执行 runOcr', async () => {
    const deps = baseDeps({ managedReadyFn: vi.fn(() => false) });
    const t = toolOf(deps);
    const out = await t.execute({ sub: 'managed', commit: 'abc' });
    expect(out).toContain('托管模式未配置 LLM');
    expect(out).toContain("sub='preview'");
    expect(deps.runOcrFn).not.toHaveBeenCalled();
  });

  it('sub 非三枚举 → 抛错且不调 runOcr', async () => {
    const deps = baseDeps();
    const t = toolOf(deps);
    await expect(t.execute({ sub: 'bogus' })).rejects.toThrow(/sub/);
    expect(deps.runOcrFn).not.toHaveBeenCalled();
  });

  it('rule 无 paths 或空数组 → 抛错', async () => {
    const t = toolOf(baseDeps());
    await expect(t.execute({ sub: 'rule' })).rejects.toThrow(/paths/);
    await expect(t.execute({ sub: 'rule', paths: [] })).rejects.toThrow(/paths/);
  });

  it('managed 无 commit 且无 from → 抛错；有 from → 放行', async () => {
    const deps = baseDeps();
    const t = toolOf(deps);
    await expect(t.execute({ sub: 'managed' })).rejects.toThrow(/commit|from/);
    await expect(t.execute({ sub: 'managed', from: 'main' })).resolves.toBeDefined();
    expect(deps.runOcrFn).toHaveBeenCalledTimes(1);
  });

  it('preview：按 buildOcrArgs 构参并以 cwd 注入 + timeoutMs 600000 调 runOcr', async () => {
    const deps = baseDeps({ runOcrFn: vi.fn(async () => ({ stdout: previewJson, stderr: '' })) });
    const t = toolOf(deps);
    await t.execute({ sub: 'preview', repo: '/ws/repo', from: 'main', to: 'feature' });
    expect(deps.runOcrFn).toHaveBeenCalledWith(
      ['delegate', 'preview', '--from', 'main', '--to', 'feature', '--repo', '/ws/repo'],
      { cwd: '/ws/repo', timeoutMs: 600000 },
    );
  });

  it('未注入 cwd → runOcr 用 process.cwd() 兜底', async () => {
    const deps = baseDeps({ runOcrFn: vi.fn(async () => ({ stdout: previewJson, stderr: '' })) });
    delete (deps as { cwd?: () => string }).cwd;
    const t = toolOf(deps);
    await t.execute({ sub: 'preview' });
    expect(deps.runOcrFn).toHaveBeenCalledWith(['delegate', 'preview'], { cwd: process.cwd(), timeoutMs: 600000 });
  });

  it('runOcr 返回 error 且无 stdout → 抛错（含 error 与 stderr 截 500）', async () => {
    const deps = baseDeps({ runOcrFn: vi.fn(async () => ({ stdout: '', stderr: 'x'.repeat(600) + 'TAIL', error: 'exit-2' })) });
    const t = toolOf(deps);
    const err = await t.execute({ sub: 'preview' }).then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('exit-2');
    expect(err!.message).toContain('x'.repeat(500));
    expect(err!.message.includes('x'.repeat(600))).toBe(false);
  });

  it('preview：解析归一化 JSON（merge_base→mergeBase），少量文件不带 suggestion', async () => {
    const deps = baseDeps({ runOcrFn: vi.fn(async () => ({ stdout: previewJson, stderr: '' })) });
    const t = toolOf(deps);
    const parsed = JSON.parse(await t.execute({ sub: 'preview' })) as Record<string, unknown>;
    expect(parsed).toEqual({ mode: 'range', files: [{ path: 'src/a.ts', status: 'modified' }], excluded: [{ path: 'lib/x.js', reason: 'ignored' }], mergeBase: 'abc123' });
    expect(parsed).not.toHaveProperty('suggestion');
  });

  it('preview：文件数超阈值（51>50）→ 附 suggestion 建议托管模式', async () => {
    const many = JSON.stringify({ mode: 'range', files: Array.from({ length: 51 }, (_, i) => ({ path: `f${i}.ts`, status: 'added' })), excluded: [], merge_base: 'm' });
    const deps = baseDeps({ runOcrFn: vi.fn(async () => ({ stdout: many, stderr: '' })) });
    const t = toolOf(deps);
    const parsed = JSON.parse(await t.execute({ sub: 'preview' })) as { files: unknown[]; suggestion?: string };
    expect(parsed.files).toHaveLength(51);
    expect(parsed.suggestion).toContain('N>50');
  });

  it('rule：原样返回 stdout 截 8000 字符', async () => {
    const long = 'r'.repeat(9000);
    const deps = baseDeps({ runOcrFn: vi.fn(async () => ({ stdout: long, stderr: '' })) });
    const t = toolOf(deps);
    const out = await t.execute({ sub: 'rule', paths: ['src/a.ts'] });
    expect(out).toHaveLength(8000);
    expect(deps.runOcrFn).toHaveBeenCalledWith(['delegate', 'rule', 'src/a.ts'], { cwd: '/ws/repo', timeoutMs: 600000 });
  });

  it('managed：归一化 findings JSON（content→message 等字段归一）', async () => {
    const deps = baseDeps({ runOcrFn: vi.fn(async () => ({ stdout: JSON.stringify({ status: 'completed', comments: [{ path: 'a.ts', line: 3, severity: 'warn', content: 'fix this' }] }), stderr: '' })) });
    const t = toolOf(deps);
    const parsed = JSON.parse(await t.execute({ sub: 'managed', commit: 'abc' })) as { status: string; comments: Array<{ path: string; line: number; severity: string; message: string }> };
    expect(parsed.status).toBe('completed');
    expect(parsed.comments).toEqual([{ path: 'a.ts', line: 3, severity: 'warn', message: 'fix this' }]);
  });

  it('managed：status 非 completed 且 runOcr 有 error → 报告附 message', async () => {
    const deps = baseDeps({ runOcrFn: vi.fn(async () => ({ stdout: '{"status":"failed","comments":[]}', stderr: '', error: 'ocr exited 1' })) });
    const t = toolOf(deps);
    const parsed = JSON.parse(await t.execute({ sub: 'managed', from: 'main' })) as { status: string; message?: string };
    expect(parsed.status).toBe('failed');
    expect(parsed.message).toBe('ocr exited 1');
  });

  it('managed：status completed 即使有 error 也不附 message（AND 语义）', async () => {
    const deps = baseDeps({ runOcrFn: vi.fn(async () => ({ stdout: '{"status":"completed","comments":[]}', stderr: '', error: 'warn-noise' })) });
    const t = toolOf(deps);
    const parsed = JSON.parse(await t.execute({ sub: 'managed', commit: 'abc' })) as Record<string, unknown>;
    expect(parsed.status).toBe('completed');
    expect(parsed).not.toHaveProperty('message');
  });
});

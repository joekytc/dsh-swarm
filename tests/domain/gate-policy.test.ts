// tests/domain/gate-policy.test.ts
import { describe, expect, it } from 'vitest';
import { classifySkippedDeclaration, classifyTestFilesDeclaration, deriveGatePlan, resolveDiffBase, branchMatches } from '../../src/domain/gate-policy.js';

const base = { assignee: 'd', mode: 'execute', config: { enabled: true } };
const wt = { worktree_dir: '/wt/x' };

describe('classifySkippedDeclaration（④ 互证）', () => {
  it('diff 不可得 → 保守放行+警报', () => {
    expect(classifySkippedDeclaration(null)).toEqual({ action: 'allow-alarm', reason: expect.stringContaining('diff unavailable') });
  });
  it('diff 含测试文件 → bounce 改声明', () => {
    expect(classifySkippedDeclaration(['src/a.ts', 'tests/a.test.ts']))
      .toEqual({ action: 'bounce', reason: expect.stringContaining('改声明 tdd.test_files') });
  });
  it('无测试 + 含代码 → bounce tdd 先行', () => {
    expect(classifySkippedDeclaration(['src/a.ts', 'README.md']))
      .toEqual({ action: 'bounce', reason: expect.stringContaining('tdd 先行') });
  });
  it('无测试 + 纯文档/配置 → 放行+警报', () => {
    expect(classifySkippedDeclaration(['README.md', 'config.json']))
      .toEqual({ action: 'allow-alarm', reason: expect.stringContaining('pure docs/config') });
  });
});

describe('classifyTestFilesDeclaration（对称核验）', () => {
  it('diff 不可得 → proceed（保守）', () => {
    expect(classifyTestFilesDeclaration(null)).toEqual({ action: 'proceed' });
  });
  it('diff 含测试变更 → proceed', () => {
    expect(classifyTestFilesDeclaration(['tests/a.test.ts'])).toEqual({ action: 'proceed' });
  });
  it('diff 零测试变更 → bounce（拿旧测试交差）', () => {
    expect(classifyTestFilesDeclaration(['src/a.ts']))
      .toEqual({ action: 'bounce', reason: expect.stringContaining('未包含测试文件') });
  });
});

describe('resolveDiffBase（body TARGET_BRANCH 解析）', () => {
  it('命中声明行', () => {
    expect(resolveDiffBase('第一行 TARGET_REPO=/repo\nTARGET_BRANCH=main 其他')).toBe('main');
  });
  it('缺失 → null', () => {
    expect(resolveDiffBase('no marker')).toBeNull();
  });
});

describe('deriveGatePlan', () => {
  it('gates disabled → silent-skip', () => {
    expect(deriveGatePlan({ ...base, config: { enabled: false }, handoff: { metadata: wt }, diffFiles: ['src/a.ts'] }))
      .toEqual({ kind: 'silent-skip', reason: 'gates disabled' });
  });
  it('非 D/execute → silent-skip', () => {
    expect(deriveGatePlan({ assignee: 'dt', mode: 'review-impl', config: { enabled: true }, handoff: { metadata: wt }, diffFiles: ['src/a.ts'] }))
      .toEqual({ kind: 'silent-skip', reason: 'not d/execute' });
  });
  it('旧卡无 worktree → silent-skip（兼容红线）', () => {
    expect(deriveGatePlan({ ...base, handoff: { metadata: {} }, diffFiles: ['src/a.ts'] }))
      .toEqual({ kind: 'silent-skip', reason: expect.stringContaining('legacy card') });
  });
  it('tdd.skipped + 纯文档 → alarm-skip 放行', () => {
    const r = deriveGatePlan({ ...base, handoff: { metadata: { ...wt, tdd: { skipped: { reason: 'docs' } } } }, diffFiles: ['README.md'] });
    expect(r.kind).toBe('alarm-skip');
  });
  it('tdd.skipped + 含代码 → bounce', () => {
    const r = deriveGatePlan({ ...base, handoff: { metadata: { ...wt, tdd: { skipped: { reason: 'docs' } } } }, diffFiles: ['src/a.ts'] });
    expect(r.kind).toBe('bounce');
  });
  it('test_files 空缺 → bounce（不再静默）', () => {
    expect(deriveGatePlan({ ...base, handoff: { metadata: wt }, diffFiles: ['src/a.ts'] }).kind).toBe('bounce');
  });
  it('test_files 路径违规 → bounce', () => {
    const r = deriveGatePlan({ ...base, handoff: { metadata: { ...wt, tdd: { test_files: ['../esc.ts'] } } }, diffFiles: ['tests/esc.test.ts'] });
    expect(r.kind).toBe('bounce');
  });
  it('声明 test_files 但 diff 零测试变更 → bounce（拿旧测试交差）', () => {
    const r = deriveGatePlan({ ...base, handoff: { metadata: { ...wt, tdd: { test_files: ['tests/old.test.ts'] } } }, diffFiles: ['src/a.ts'] });
    expect(r.kind).toBe('bounce');
  });
  it('声明与 diff 匹配 → run + vitest 命令', () => {
    const r = deriveGatePlan({ ...base, handoff: { metadata: { ...wt, tdd: { test_files: ['tests/a.test.ts'] } } }, diffFiles: ['src/a.ts', 'tests/a.test.ts'] });
    expect(r).toEqual({ kind: 'run', commands: [{ command: 'npx --no-install vitest run tests/a.test.ts', cwd: '/wt/x', source: 'tdd' }] });
  });
  it('diff 不可得 + 合法声明 → run（不拦）', () => {
    const r = deriveGatePlan({ ...base, handoff: { metadata: { ...wt, tdd: { test_files: ['tests/a.test.ts'] } } }, diffFiles: null });
    expect(r.kind).toBe('run');
  });
  it('shell 元字符注入 → bounce（既有防线回归）', () => {
    const r = deriveGatePlan({ ...base, handoff: { metadata: { ...wt, tdd: { test_files: ['a;git push'] } } }, diffFiles: ['tests/a.test.ts'] });
    expect(r.kind).toBe('bounce');
  });
});

describe('branchMatches（⑦ 保留函数）', () => {
  it('真值表', () => {
    expect(branchMatches('feature/x', 'feature/x')).toBe(true);
    expect(branchMatches('main', 'feature/x')).toBe(false);
    expect(branchMatches(null, 'feature/x')).toBe(false);
    expect(branchMatches('feature/x', '')).toBe(false);
  });
});

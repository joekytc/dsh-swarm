// tests/domain/gate-policy.test.ts
import { describe, it, expect } from 'vitest';
import { deriveGatePlan, branchMatches } from '../../src/domain/gate-policy.js';

const base = { assignee: 'd', mode: 'execute', config: { enabled: true } };

describe('deriveGatePlan', () => {
  it('tdd.test_files + worktree_dir → vitest 实测命令（--no-install）', () => {
    const plan = deriveGatePlan({ ...base, handoff: { metadata: {
      worktree_dir: '/wt/x',
      tdd: { test_files: ['tests/a.test.ts', 'tests/b.test.ts'] },
    } } });
    expect(plan.skipped).toBe(false);
    if (!plan.skipped) {
      expect(plan.commands).toEqual([{
        command: 'npx --no-install vitest run tests/a.test.ts tests/b.test.ts',
        cwd: '/wt/x', source: 'tdd',
      }]);
    }
  });

  it('tdd.skipped → skip（理由含 skipped）', () => {
    const plan = deriveGatePlan({ ...base, handoff: { metadata: {
      worktree_dir: '/wt/x', tdd: { skipped: { reason: '纯文档' } } } } });
    expect(plan.skipped).toBe(true);
    if (plan.skipped) expect(plan.reason).toContain('tdd skipped');
  });

  it('worktree_dir 缺失 → skip（向后兼容：旧卡零感知）', () => {
    const plan = deriveGatePlan({ ...base, handoff: { metadata: {
      tdd: { test_files: ['tests/a.test.ts'] } } } });
    expect(plan.skipped).toBe(true);
  });

  it('非 d/execute 卡 → skip', () => {
    const plan = deriveGatePlan({ ...base, assignee: 'w', mode: 'kb',
      handoff: { metadata: { worktree_dir: '/wt/x', tdd: { test_files: ['a.ts'] } } } });
    expect(plan.skipped).toBe(true);
  });

  it('enabled=false → skip reason=disabled', () => {
    const plan = deriveGatePlan({ ...base, config: { enabled: false },
      handoff: { metadata: { worktree_dir: '/wt/x', tdd: { test_files: ['a.ts'] } } } });
    expect(plan.skipped).toBe(true);
  });

  it('test_files 绝对路径 → 整单 skip（防跑主仓库代码）', () => {
    const plan = deriveGatePlan({ ...base, handoff: { metadata: {
      worktree_dir: '/wt/x',
      tdd: { test_files: ['/main-repo/tests/a.test.ts'] } } } });
    expect(plan.skipped).toBe(true);
    if (plan.skipped) expect(plan.reason).toContain('path');
  });

  it('test_files 含 .. 逃逸段 → 整单 skip', () => {
    const plan = deriveGatePlan({ ...base, handoff: { metadata: {
      worktree_dir: '/wt/x',
      tdd: { test_files: ['tests/../../etc/a.test.ts'] } } } });
    expect(plan.skipped).toBe(true);
  });

  // 拼入 bash -c 前必须拒绝 shell 元字符/空白：防注入（未跑闸却 exit 0）与绕黑名单子串（双空格变体）
  it('test_files 含 shell 元字符/空白 → 整单 skip（同路径违规语义）', () => {
    const malicious = [
      'x || true',            // 短路或：未跑闸也 exit 0
      'a;rm -rf /',           // 命令拼接
      'a;b',
      '$(cmd)',               // 命令替换
      '`cmd`',                // 反引号
      'tests/a b.test.ts',    // 空白：既可注入也可变体绕黑名单
      'tests/a&b.test.ts',    // 后台执行
    ];
    for (const f of malicious) {
      const plan = deriveGatePlan({ ...base, handoff: { metadata: {
        worktree_dir: '/wt/x', tdd: { test_files: [f] } } } });
      expect(plan.skipped, f).toBe(true);
      if (plan.skipped) expect(plan.reason, f).toContain('invalid test_files path');
    }
  });

  it('test_files 空数组/全空白 → skip（no gate commands）', () => {
    const plan = deriveGatePlan({ ...base, handoff: { metadata: {
      worktree_dir: '/wt/x', tdd: { test_files: [' ', ''] } } } });
    expect(plan.skipped).toBe(true);
  });
});

describe('branchMatches', () => {
  it('相等 → true', () => {
    expect(branchMatches('feature/ch-1', 'feature/ch-1')).toBe(true);
  });
  it('不等 / declared 非字符串 / declared 空 / current null → false', () => {
    expect(branchMatches('feature/x', 'feature/y')).toBe(false);
    expect(branchMatches('feature/x', undefined)).toBe(false);
    expect(branchMatches('feature/x', '')).toBe(false);
    expect(branchMatches(null, 'feature/x')).toBe(false);
  });
});

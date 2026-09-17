// tests/services/evidence-replay.test.ts
import { describe, expect, it } from 'vitest';
import { checkIssueEvidence, resolveTargetWorktree } from '../../src/services/evidence-replay.js';

const cfg = { replayEnabled: true, timeoutMs: 1000, allowPrefixes: ['npx --no-install vitest'] };
const issues = (ev: unknown) => [{ severity: 'high', title: 'i1', resolved: false, evidence: ev }];

describe('checkIssueEvidence 三级递进', () => {
  it('L1 无 evidence → not-provided（不执行任何东西；low 严重度）', async () => {
    const r = await checkIssueEvidence({ issues: [{ severity: 'low', title: 'i1', resolved: false, evidence: undefined }], ...cfg, worktreeDir: '/wt', readFile: async () => null });
    expect(r[0]!.state).toBe('not-provided');
  });
  it('L2 纸面 matches → matches（零执行）', async () => {
    const r = await checkIssueEvidence({ issues: issues({ file: '/f.log', command: 'npx --no-install vitest run x', exit: 0 }), ...cfg, worktreeDir: '/wt', readFile: async () => '[exit code: 0]\nPASS' });
    expect(r[0]!.state).toBe('matches');
  });
  it('L2 纸面对不上 + 开关关 → could-not-replay（重放未授权）', async () => {
    const r = await checkIssueEvidence({ issues: issues({ file: '/f.log', command: 'npx --no-install vitest run x', exit: 0 }), replayEnabled: false, timeoutMs: 1000, allowPrefixes: ['npx --no-install vitest'], worktreeDir: '/wt', readFile: async () => '[exit code: 1]\nFAIL' });
    expect(r[0]!.state).toBe('could-not-replay');
    expect(r[0]!.detail).toContain('replay disabled');
  });
  it('L3 重放 exit 与声明一致 → matches', async () => {
    const run = async () => ({ command: 'c', exitCode: 0, durationMs: 1, output: 'PASS', truncated: false });
    const r = await checkIssueEvidence({ issues: issues({ file: '/f.log', command: 'npx --no-install vitest run x', exit: 0 }), ...cfg, worktreeDir: '/wt', readFile: async () => '[exit code: 1]\nFAIL', run });
    expect(r[0]!.state).toBe('matches');
  });
  it('L3 重放 exit 不一致 → differs（假证据实锤，不阻塞仅留痕）', async () => {
    const run = async () => ({ command: 'c', exitCode: 2, durationMs: 1, output: 'x', truncated: false });
    const r = await checkIssueEvidence({ issues: issues({ file: '/f.log', command: 'npx --no-install vitest run x', exit: 0 }), ...cfg, worktreeDir: '/wt', readFile: async () => '[exit code: 1]\nFAIL', run });
    expect(r[0]!.state).toBe('differs');
  });
  it('命令不在白名单 → could-not-replay（不执行）', async () => {
    const r = await checkIssueEvidence({ issues: issues({ file: '/f.log', command: 'curl http://evil', exit: 0 }), ...cfg, worktreeDir: '/wt', readFile: async () => '[exit code: 1]' });
    expect(r[0]!.state).toBe('could-not-replay');
    expect(r[0]!.detail).toContain('not allowlisted');
  });
  it('severity critical/high 缺证 → could-not-replay + needs-human 提示', async () => {
    const r = await checkIssueEvidence({ issues: [{ severity: 'critical', title: 'i', resolved: false }], ...cfg, worktreeDir: '/wt', readFile: async () => null });
    expect(r[0]!.state).toBe('could-not-replay');
    expect(r[0]!.detail).toContain('needs-human');
  });
  it('severity low/medium 缺证 → not-provided（不转人工）', async () => {
    const r = await checkIssueEvidence({ issues: [{ severity: 'low', title: 'i', resolved: false }], ...cfg, worktreeDir: '/wt', readFile: async () => null });
    expect(r[0]!.state).toBe('not-provided');
  });
  it('issues 含 null 元素 → 该条 could-not-replay（不吞整批核验）', async () => {
    const r = await checkIssueEvidence({ issues: [null, { severity: 'low', title: 'ok', resolved: false }], ...cfg, worktreeDir: '/wt', readFile: async () => null });
    expect(r).toHaveLength(2);
    expect(r[0]!.state).toBe('could-not-replay');
    expect(r[0]!.detail).toContain('needs-human');
    expect(r[1]!.state).toBe('not-provided');
  });
  it('重放 TIMEOUT → could-not-replay（不误判 differs）', async () => {
    const run = async () => ({ command: 'c', exitCode: null, durationMs: 1, output: '', truncated: false, timedOut: true });
    const r = await checkIssueEvidence({ issues: issues({ file: '/f.log', command: 'npx --no-install vitest run x', exit: 0 }), ...cfg, worktreeDir: '/wt', readFile: async () => '[exit code: 1]\nFAIL', run });
    expect(r[0]!.state).toBe('could-not-replay');
    expect(r[0]!.detail).toContain('TIMEOUT');
  });
});

describe('resolveTargetWorktree（沿父链找最近 execute 卡）', () => {
  it('命中 D 卡 worktree_dir', () => {
    expect(resolveTargetWorktree([
      { assignee: 'w', mode: 'kb', metadata: { page_path: 'x' } },
      { assignee: 'd', mode: 'execute', metadata: { worktree_dir: '/wt/feature' } },
    ])).toBe('/wt/feature');
  });
  it('无 execute 卡 → null', () => {
    expect(resolveTargetWorktree([{ assignee: 'w', mode: 'kb', metadata: {} }])).toBeNull();
  });
});

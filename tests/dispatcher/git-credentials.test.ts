import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitAuthHeader, injectGitCredentials, resolveGitPat, resolveGitPatFromCtx } from '../../src/dispatcher/git-credentials.js';

describe('resolveGitPat (M4 env PAT 解析)', () => {
  it('resolves PAT from env by priority and returns null when unset', () => {
    expect(resolveGitPat({ KANBAN_GIT_PAT: 'k1' })).toBe('k1');
    expect(resolveGitPat({ GIT_PAT: 'g1' })).toBe('g1');
    expect(resolveGitPat({ GH_TOKEN: 'gh' })).toBe('gh');
    expect(resolveGitPat({ GITHUB_TOKEN: 'ght' })).toBe('ght');
    expect(resolveGitPat({ KANBAN_GIT_PAT: 'k', GITHUB_TOKEN: 'x' })).toBe('k'); // 优先级
    expect(resolveGitPat({ GIT_PAT: '  ' })).toBeNull(); // 空白视为未配置
    expect(resolveGitPat({})).toBeNull();
  });
});

describe('resolveGitPatFromCtx (M4 DSH 凭据服务优先，env 兜底)', () => {
  it('reads KANBAN_GIT_PAT from ctx.credentials before falling back to env', async () => {
    const ctx = { get: (n: string) => (n === 'credentials' ? { resolve: async (ref: string) => ref === 'KANBAN_GIT_PAT' ? { value: 'glpat-from-store' } : undefined } : undefined) };
    expect(await resolveGitPatFromCtx(ctx, { KANBAN_GIT_PAT: 'glpat-from-env' })).toBe('glpat-from-store');
    expect(await resolveGitPatFromCtx(ctx, {})).toBe('glpat-from-store');
  });
  it('falls back to process env when credentials service is absent', async () => {
    const ctx = { get: () => undefined };
    expect(await resolveGitPatFromCtx(ctx, { GIT_PAT: 'g-env' })).toBe('g-env');
    expect(await resolveGitPatFromCtx(ctx, {})).toBeNull();
  });
});

describe('gitAuthHeader (M4 GitLab/GitHub 鉴权区分)', () => {
  it('glpat-* PAT → oauth2 basic（GitLab 规范，实测 ls-remote 通过）', () => {
    const b64 = Buffer.from('oauth2:glpat-abc').toString('base64');
    expect(gitAuthHeader('glpat-abc')).toBe('AUTHORIZATION: basic ' + b64);
  });
  it('非 glpat PAT → x-access-token basic（GitHub 等）', () => {
    const b64 = Buffer.from('x-access-token:tok').toString('base64');
    expect(gitAuthHeader('tok')).toBe('AUTHORIZATION: basic ' + b64);
  });
});

describe('injectGitCredentials (M4 repo-local http extraheader)', () => {
  it('writes GitLab oauth2 extraheader scoped to the http remote url', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitcred-'));
    try {
      execFileSync('git', ['init', '-q', dir]);
      execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://gitlab.jianzhikeji.com/jz-fe/dsh-dashboard.git']);
      const res = injectGitCredentials(dir, 'glpat-sekret');
      expect(res.ok).toBe(true);
      const out = execFileSync('git', ['-C', dir, 'config', '--local', '--get', 'http.https://gitlab.jianzhikeji.com/jz-fe/dsh-dashboard.git.extraheader'], { encoding: 'utf8' }).trim();
      expect(out).toBe('AUTHORIZATION: basic ' + Buffer.from('oauth2:glpat-sekret').toString('base64'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('fails gracefully (ok=false) when the dir is not a git repo with http origin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitcred2-'));
    try {
      writeFileSync(join(dir, 'x.txt'), 'x');
      const res = injectGitCredentials(dir, 'sekret');
      expect(res.ok).toBe(false);
      expect(res.detail).toContain('no http remote origin');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

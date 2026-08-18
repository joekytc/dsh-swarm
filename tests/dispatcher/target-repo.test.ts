import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPathInside, resolveTargetRepoDir } from '../../src/dispatcher/target-repo.js';
import type { BoardState, SpecCard, Task } from '../../src/domain/types.js';

function task(body: string, chainId = 'ch_1'): Task {
  return { id: 't_1', chainId, title: 'd', body, assignee: 'd', status: 'ready', mode: 'execute', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [], sessionId: 'kbn-t_1', reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'not-required' };
}
function stateWithCard(card: SpecCard | null, chainId = 'ch_1'): BoardState {
  const chains = new Map([['ch_1', { id: chainId, title: 'c', status: 'executing' as const, rootTaskId: null, specCardId: card ? 'sc_1' : null, ownerSessionId: 's', workspaceDir: null, createdAt: 1 }]]);
  const specCards = card ? new Map([['sc_1', card]]) : new Map();
  return { chains, tasks: new Map(), specCards, handoffs: new Map(), auditWarnings: new Map(), events: [] };
}

describe('resolveTargetRepoDir (R20 D execute cwd)', () => {
  it('prefers the TARGET_REPO marker in the task body (existing dir)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo-'));
    try {
      const fallback = '/nonexistent/fallback';
      const got = resolveTargetRepoDir(task(`TARGET_REPO=${dir}\n执行规格卡 solution/testing`), stateWithCard(null), fallback);
      expect(got).toBe(dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('falls back to the spec card file-prefetch attachment ref', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo2-'));
    try {
      const card: SpecCard = {
        id: 'sc_1', chainId: 'ch_1', status: 'approved',
        sections: { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' },
        attachments: [{ name: 'w1-pre repo facts', kind: 'file-prefetch', ref: dir }],
        rawDialogueRef: null, approvedAt: 1, approvedBy: 'human',
      };
      // body 无 TARGET_REPO 标记 → 用规格卡附件 ref
      const got = resolveTargetRepoDir(task('执行规格卡'), stateWithCard(card), '/fallback');
      expect(got).toBe(dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('skips nonexistent candidates and falls back to the default dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo3-'));
    try {
      const card: SpecCard = {
        id: 'sc_1', chainId: 'ch_1', status: 'approved',
        sections: { problem: 'p', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' },
        attachments: [{ name: 'w1-pre', kind: 'file-prefetch', ref: '/nonexistent/repo' }],
        rawDialogueRef: null, approvedAt: 1, approvedBy: 'human',
      };
      const got = resolveTargetRepoDir(task('TARGET_REPO=/also/nonexistent'), stateWithCard(card), dir);
      expect(got).toBe(dir); // 回退默认（已存在）
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('isPathInside: parent containment（含等于）', () => {
    const ws = '/Users/jc/Documents/workspace';
    expect(isPathInside(ws, ws)).toBe(true);
    expect(isPathInside(ws + '/repo', ws)).toBe(true);
    expect(isPathInside(ws + '/repo/sub', ws)).toBe(true);
    expect(isPathInside('/Users/jc/Documents/other/repo', ws)).toBe(false);
    expect(isPathInside('/Users/jc/Documents/workspaceX', ws)).toBe(false); // 前缀陷阱
  });

  it('resolves relative marker against process cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repo4-'));
    try {
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        mkdirSync(join(dir, 'sub'));
        const got = resolveTargetRepoDir(task('TARGET_REPO=sub'), stateWithCard(null), '/fallback');
        // macOS getcwd 规范化 /var → /private/var，故用解析后的 cwd 断言
        expect(got).toBe(join(process.cwd(), 'sub'));
      } finally { process.chdir(cwd); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

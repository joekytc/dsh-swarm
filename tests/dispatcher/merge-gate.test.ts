import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveMergeInput, isAlreadyMerged, runMergeGate,
  MERGE_DONE_PREFIX, MERGE_FAILED_PREFIX, type GitRun,
} from '../../src/dispatcher/merge-gate.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import type { BoardState, KanbanEvent, Task } from '../../src/domain/types.js';

function dTask(body: string): Task {
  return { id: 't_d', chainId: 'ch_1', title: 'd', body, assignee: 'd', status: 'done', mode: 'execute', priority: 1, parents: [], children: [], createdBy: 'v', attempts: 0, heartbeats: [], sessionId: 'kbn-t_d', reworkOfTaskId: null, resumeSessionId: null, reviewAttempt: 0, reviewStatus: 'not-required' };
}
function stateWith(d: Task, metadata: Record<string, unknown>, events: Array<{ taskId: string | null; kind: string; payload: Record<string, unknown>; author?: string }>): BoardState {
  // 类型适配：brief fixture 的 events 元素为最小手写形（缺 seq/chainId/at，kind 为 string），
  // 与 KanbanEvent 字段不完全一致，故断言为 KanbanEvent[] 以满足 BoardState 严格类型（断言意图不变）。
  // author 为可选：未填视为 undefined（非 system），用于验证幂等门只认 system 标记。
  return { chains: new Map(), tasks: new Map([[d.id, d]]), specCards: new Map(), handoffs: new Map([[d.id, { summary: 's', metadata, completedAt: 1 }]]), auditWarnings: new Map(), events: events as KanbanEvent[] };
}
const noopKanban = { comment: async () => ({}) } as unknown as KanbanService;

describe('resolveMergeInput', () => {
  it('parses repoDir/TARGET_BRANCH/feature branch from D body + handoff', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mg-'));
    try {
      const d = dTask('TARGET_REPO=' + dir + '\nTARGET_BRANCH=main');
      const input = resolveMergeInput(d, stateWith(d, { branch: 'feat/abc' }, []), '/fallback');
      expect(input).toEqual({ repoDir: dir, targetBranch: 'main', featureBranch: 'feat/abc' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('returns null when branch metadata missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mg2-'));
    try {
      const d = dTask('TARGET_REPO=' + dir + '\nTARGET_BRANCH=main');
      expect(resolveMergeInput(d, stateWith(d, {}, []), '/fallback')).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('returns null when TARGET_BRANCH marker missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mg3-'));
    try {
      const d = dTask('TARGET_REPO=' + dir);
      expect(resolveMergeInput(d, stateWith(d, { branch: 'feat/a' }, []), '/fallback')).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('isAlreadyMerged', () => {
  const gitFail: GitRun = () => { throw new Error('exit 1'); };
  it('true when a [merge-done] comment exists (system author)', () => {
    const d = dTask('');
    const st = stateWith(d, { branch: 'f' }, [{ taskId: 't_d', kind: 'task/commented', author: 'system', payload: { body: '[merge-done] merged' } }]);
    expect(isAlreadyMerged(st, 't_d', '/r', 'main', 'f', gitFail)).toBe(true);
  });
  it('false when [merge-done] comment forged by a role (non-system author)', () => {
    const d = dTask('');
    const st = stateWith(d, { branch: 'f' }, [{ taskId: 't_d', kind: 'task/commented', author: 'd', payload: { body: '[merge-done] fake' } }]);
    expect(isAlreadyMerged(st, 't_d', '/r', 'main', 'f', gitFail)).toBe(false);
  });
  it('true when branch is ancestor of target (git exit 0)', () => {
    const d = dTask('');
    const okGit: GitRun = () => '';
    expect(isAlreadyMerged(stateWith(d, { branch: 'f' }, []), 't_d', '/r', 'main', 'f', okGit)).toBe(true);
  });
  it('false when neither (git exits non-zero, no comment)', () => {
    const d = dTask('');
    expect(isAlreadyMerged(stateWith(d, { branch: 'f' }, []), 't_d', '/r', 'main', 'f', gitFail)).toBe(false);
  });
});

describe('runMergeGate', () => {
  it('runs checkout/merge/push and records [merge-done]', async () => {
    const calls: string[][] = [];
    // 类型/逻辑适配：mock 对 merge-base 抛错模拟「feature 非 target 祖先」（未合并，幂等门通过），
    // 仅 rev-parse 返回 hash；否则 merge-base 返回 ''（exit 0）会被 isAlreadyMerged 判为已合并 → 短路 skipped。
    const git: GitRun = (a) => { calls.push(a); if (a[0] === 'merge-base') throw new Error('exit 1'); if (a[0] === 'rev-parse') return 'abc123'; return ''; };
    const d = dTask('');
    const comments: string[] = [];
    const kanban = { comment: async (_t: string, b: string) => { comments.push(b); } } as unknown as KanbanService;
    const r = await runMergeGate(kanban, stateWith(d, { branch: 'f' }, []), d, { repoDir: '/r', targetBranch: 'main', featureBranch: 'f' }, git);
    expect(r).toBe('merged');
    // 断言含前置幂等门 git merge-base 调用（顺序：merge-base → checkout → merge → push → rev-parse）
    expect(calls.map((a) => a[0])).toEqual(['merge-base', 'checkout', 'merge', 'push', 'rev-parse']);
    expect(comments[0]).toContain(MERGE_DONE_PREFIX);
  });
  it('records [merge-failed] without throwing on git error', async () => {
    const git: GitRun = () => { throw new Error('conflict'); };
    const d = dTask('');
    const comments: string[] = [];
    const kanban = { comment: async (_t: string, b: string) => { comments.push(b); } } as unknown as KanbanService;
    const r = await runMergeGate(kanban, stateWith(d, { branch: 'f' }, []), d, { repoDir: '/r', targetBranch: 'main', featureBranch: 'f' }, git);
    expect(r).toBe('failed');
    expect(comments[0]).toContain(MERGE_FAILED_PREFIX);
  });
  it('skips when already merged (no git calls)', async () => {
    const git: GitRun = () => { throw new Error('should not run'); };
    const d = dTask('');
    const st = stateWith(d, { branch: 'f' }, [{ taskId: 't_d', kind: 'task/commented', author: 'system', payload: { body: '[merge-done] x' } }]);
    const r = await runMergeGate(noopKanban, st, d, { repoDir: '/r', targetBranch: 'main', featureBranch: 'f' }, git);
    expect(r).toBe('skipped');
  });
});

// tests/domain/memory.test.ts（本任务段）
import { describe, it, expect } from 'vitest';
import { validateLearning, formatLearningBody, buildMemoryIndexBlock, weightedRank, buildRepoSlug } from '../../src/domain/memory.js';
import { buildLearningBrief, resolveLearningChainId } from '../../src/domain/memory.js';
import { KanbanService } from '../../src/domain/kanban-service.js';
import { FileEventStore } from '../../src/domain/event-store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('memory domain (data model)', () => {
  it('validateLearning rejects empty fields / bad tags / overlong title', () => {
    expect(validateLearning({ title: 't', lesson: 'l', evidence: 'e', tags: [] })).toEqual([]);
    expect(validateLearning(null)).toContain('learning must be an object');
    expect(validateLearning({ title: '', lesson: 'l', evidence: 'e', tags: [] })).toContain('learning.title must be a non-empty string');
    expect(validateLearning({ title: 't', lesson: '', evidence: 'e', tags: [] })).toContain('learning.lesson must be a non-empty string');
    expect(validateLearning({ title: 't', lesson: 'l', evidence: '', tags: [] })).toContain('learning.evidence must be a non-empty string');
    expect(validateLearning({ title: 't', lesson: 'l', evidence: 'e', tags: 'x' })).toContain('learning.tags must be an array of strings');
    expect(validateLearning({ title: 't'.repeat(81), lesson: 'l', evidence: 'e', tags: [] })).toContain('learning.title must be <= 80 chars');
  });
  it('formatLearningBody renders frontmatter + three sections', () => {
    const body = formatLearningBody({ title: '调度器需显式启动', lesson: '教训', evidence: 'chain ch_1', tags: ['dispatcher'] }, new Date('2026-08-27T00:00:00Z'));
    expect(body).toContain('type: learning');
    expect(body).toContain('created: 2026-08-27');
    expect(body).toContain('# 【Learning】调度器需显式启动');
    expect(body).toContain('## 教训');
    expect(body).toContain('## 证据');
    expect(body).toContain('## 适用场景');
    expect(body).toContain('- dispatcher');
  });
  it('buildMemoryIndexBlock: empty → null; renders truncated titles', () => {
    expect(buildMemoryIndexBlock([])).toBeNull();
    const block = buildMemoryIndexBlock([{ kind: 'learning', title: 't'.repeat(70), path: 'projects/learnings/x.md' }])!;
    expect(block).toContain('## KB 记忆索引');
    expect(block).toContain('#/page/projects/learnings/x.md');
    expect(block).toContain('planning_memory_recall');
    expect(block).toMatch(/t{60}…/);
  });
  it('weightedRank: higher score+recency ranks first', () => {
    const items = [
      { id: 'a', score: 10, mtime: 1000 },
      { id: 'b', score: 1, mtime: 3000 },
      { id: 'c', score: 5, mtime: 2000 },
    ];
    const ranked = weightedRank(items, (x) => x.score, (x) => x.mtime);
    expect(ranked[0].id).toBe('a');
  });
  it('buildRepoSlug derives slug from workspace basename', () => {
    expect(buildRepoSlug('/Users/jc/Documents/vueadmin')).toBe('vueadmin');
    expect(buildRepoSlug('/a/b/My Repo/')).toBe('my-repo');
    expect(buildRepoSlug('/a/b/中文仓库')).toBe('req');
  });
});

describe('memory domain (evidence pack)', () => {
  it('buildLearningBrief extracts review-failed/blocked/rework/audit signals', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: '【需求】优化登录', ownerSessionId: 'session_main' }, 'human');
      await svc.createSpecCard(chain.id, { problem: '登录慢且易卡死', solution: 's', user_stories: ['u'], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      const dTask = await svc.createTask({ chainId: chain.id, title: '实现登录', assignee: 'd', mode: 'execute' }, 'v');
      await svc.claimTask(dTask.id, 'system'); // todo → running
      await svc.completeTask(dTask.id, { summary: 'done', metadata: {}, completedAt: Date.now() }, 'human'); // → done（human 信任锚）
      const reviewTask = await svc.createTask({ chainId: chain.id, title: '评审', assignee: 'dt', mode: 'review-impl' }, 'v');
      await svc.recordReview(reviewTask.id, dTask.id, { verdict: 'fail', issues: [{ severity: 'high', title: '缺测试', detail: '无测试文件', resolved: false }] }, 'system');
      await svc.createReworkTask({ sourceTaskId: dTask.id, reviewTaskId: reviewTask.id, reason: '缺测试' }, 'system');
      const pTask = await svc.createTask({ chainId: chain.id, title: '计划', assignee: 'p', mode: 'execute' }, 'v');
      await svc.claimTask(pTask.id, 'system');
      await svc.blockTask(pTask.id, '等待依赖服务', 'system');
      await svc.auditWarning(chain.id, [{ source: 'main-session-scan', detail: '发现越权产物', paths: ['/x'] }], 'system');
      const state = await svc.snapshot();
      const brief = buildLearningBrief(state, chain.id);
      expect(brief).toContain('【需求】优化登录');
      expect(brief).toContain('登录慢且易卡死');
      expect(brief).toContain('缺测试');
      expect(brief).toContain('等待依赖服务');
      expect(brief).toContain('[返工×1]');
      expect(brief).toContain('main-session-scan');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('buildLearningBrief: no signals → context header + fallback hint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem2-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const chain = await svc.createChain({ title: '【需求】新功能', ownerSessionId: 'session_main' }, 'human');
      const state = await svc.snapshot();
      expect(buildLearningBrief(state, chain.id)).toContain('无机械信号');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('resolveLearningChainId: empty→latest; exact id→hit; substring→single or candidates; none→null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mem3-'));
    try {
      const svc = new KanbanService(new FileEventStore(dir));
      const c1 = await svc.createChain({ title: '【需求】A', ownerSessionId: 'session_main' }, 'human');
      const c2 = await svc.createChain({ title: '【需求】B', ownerSessionId: 'session_main' }, 'human');
      let state = await svc.snapshot();
      expect(resolveLearningChainId(state, '')).toEqual({ chainId: c2.id });
      expect(resolveLearningChainId(state, c1.id)).toEqual({ chainId: c1.id });
      expect(resolveLearningChainId(state, 'A')).toEqual({ chainId: c1.id });
      expect(resolveLearningChainId(state, '不存在的链')).toBeNull();
      await svc.createSpecCard(c1.id, { problem: 'xxx', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      await svc.createSpecCard(c2.id, { problem: 'xxx', solution: 's', user_stories: [], impl_decisions: [], testing: 't', out_of_scope: 'o' }, 'human');
      state = await svc.snapshot();
      const r = resolveLearningChainId(state, 'xxx') as { candidates?: Array<{ chainId: string }> };
      expect(r.candidates).toHaveLength(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

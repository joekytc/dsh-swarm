// tests/domain/memory.test.ts（本任务段）
import { describe, it, expect } from 'vitest';
import { validateLearning, formatLearningBody, buildMemoryIndexBlock, weightedRank, buildRepoSlug } from '../../src/domain/memory.js';

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

// tests/wiki/memory-recall.test.ts
import { describe, it, expect, vi } from 'vitest';
import { recallMemoryIndex, recallLearningIndex, recallDocIndex, searchChecklists } from '../../src/wiki/memory-recall.js';

type SearchResult = { path: string; title: string; score: number; mtime: number };
const wikiOf = (search: (q: string) => Promise<SearchResult[]>) => ({ search: vi.fn(search) }) as never;

describe('memory-recall (KB 只读检索)', () => {
  it('recallLearningIndex: requirementName 加权合并 + 限定全局/项目级 learnings', async () => {
    const wiki = wikiOf(async () => [
      { path: 'projects/checklists/s-1.md', title: '清单', score: 99, mtime: 1000 },
      { path: 'projects/learnings/old-1.md', title: '旧经验', score: 60, mtime: 1000 },
      { path: 'projects/vueadmin/learnings/new-1.md', title: '新经验', score: 90, mtime: 3000 },
      { path: 'projects/ch_1/learnings/x.md', title: '需求级', score: 80, mtime: 2000 },
    ]);
    const r = await recallLearningIndex(wiki, { requirementName: '登录', workspaceDir: '/ws/vueadmin' });
    // 只保留全局+项目级（ch_1 需求级排除）；加权后 projects/vueadmin/learnings/new-1（0.7*1+0.3*1）最前
    expect(r.map((x) => x.path)).toEqual(['projects/vueadmin/learnings/new-1.md', 'projects/learnings/old-1.md']);
  });
  it('recallLearningIndex: requirementName 空 → search(【Learning】) + mtime 降序', async () => {
    const wiki = wikiOf(async (q) => q === '【Learning】'
      ? [{ path: 'projects/learnings/a.md', title: 'A', score: 1, mtime: 1000 }, { path: 'projects/learnings/b.md', title: 'B', score: 1, mtime: 3000 }]
      : []);
    const r = await recallLearningIndex(wiki, { requirementName: null, workspaceDir: null });
    expect(r.map((x) => x.path)).toEqual(['projects/learnings/b.md', 'projects/learnings/a.md']);
  });
  it('recallLearningIndex: KB 不可达 → 空数组（不抛）', async () => {
    const wiki = wikiOf(async () => { throw new Error('kb-unreachable'); });
    expect(await recallLearningIndex(wiki, { requirementName: 'x', workspaceDir: null })).toEqual([]);
  });
  it('recallDocIndex: projects/ 前缀 + 排除路1 范围，按 score 降序', async () => {
    const wiki = wikiOf(async () => [
      { path: 'projects/learnings/g.md', title: '全局经验', score: 90, mtime: 1 },
      { path: 'projects/checklists/s-1.md', title: '清单', score: 80, mtime: 1 },
      { path: 'projects/ch_1/learnings/x.md', title: '需求级经验', score: 70, mtime: 1 },
      { path: 'projects/dsh-kanban/design-2026-08-14.md', title: '设计', score: 50, mtime: 1 },
    ]);
    const r = await recallDocIndex(wiki, { requirementName: '登录', workspaceDir: '/ws/vueadmin' });
    expect(r.map((x) => x.path)).toEqual([
      'projects/checklists/s-1.md',
      'projects/ch_1/learnings/x.md',
      'projects/dsh-kanban/design-2026-08-14.md',
    ]); // 全局 learnings 排除
  });
  it('recallMemoryIndex: 合并两路、maxEntries 截断、返回索引块', async () => {
    const wiki = wikiOf(async () => [
      { path: 'projects/learnings/a.md', title: 'A 经验', score: 5, mtime: 1000 },
      { path: 'projects/learnings/b.md', title: 'B 经验', score: 10, mtime: 2000 },
    ]);
    const block = await recallMemoryIndex(wiki, { requirementName: '登录', workspaceDir: null, maxEntries: 4 });
    expect(block).toContain('## KB 记忆索引');
    expect(block).toContain('A 经验');
    expect(block).toContain('B 经验');
  });
  it('recallMemoryIndex: 全空 → null', async () => {
    const wiki = wikiOf(async () => []);
    expect(await recallMemoryIndex(wiki, { requirementName: null, workspaceDir: null, maxEntries: 4 })).toBeNull();
  });
  it('searchChecklists: 【需求】候选页 top5', async () => {
    const wiki = wikiOf(async (q) => q === '【需求】' ? [
      { path: 'projects/checklists/a.md', title: 't', score: 1, mtime: 1 },
      { path: 'evil/x.md', title: 't', score: 1, mtime: 1 },
    ] : []);
    expect(await searchChecklists(wiki, 'projects/')).toEqual(['projects/checklists/a.md']);
  });
});

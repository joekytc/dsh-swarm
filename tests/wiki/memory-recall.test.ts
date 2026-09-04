// tests/wiki/memory-recall.test.ts
import { describe, it, expect, vi } from 'vitest';
import { recallMemoryIndex, recallLearningIndex, recallDocIndex, searchChecklists } from '../../src/wiki/memory-recall.js';

type SearchResult = { path: string; title: string; score: number; mtime: number };
const wikiOf = (search: (q: string) => Promise<SearchResult[]>) => ({ search: vi.fn(search) }) as never;

describe('memory-recall (KB 只读检索)', () => {
  it('recallLearningIndex: requirementName 加权合并 + 限定项目级 learnings', async () => {
    const wiki = wikiOf(async () => [
      { path: 'projects/repo/learnings/old-1.md', title: '旧经验', score: 60, mtime: 1000 },
      { path: 'projects/repo/learnings/new-1.md', title: '新经验', score: 90, mtime: 3000 },
      { path: 'projects/learnings/legacy.md', title: '全局遗留', score: 99, mtime: 9000 },
    ]);
    const r = await recallLearningIndex(wiki, { requirementName: '登录', workspaceDir: '/ws/repo' });
    // 只保留项目级（全局 learnings 断代，legacy 排除）；加权后 projects/repo/learnings/new-1 最前
    expect(r.map((x) => x.path)).toEqual(['projects/repo/learnings/new-1.md', 'projects/repo/learnings/old-1.md']);
  });
  it('recallLearningIndex: requirementName 空 → search(【Learning】) + mtime 降序', async () => {
    const wiki = wikiOf(async (q) => q === '【Learning】'
      ? [{ path: 'projects/repo/learnings/a.md', title: 'A', score: 1, mtime: 1000 }, { path: 'projects/repo/learnings/b.md', title: 'B', score: 1, mtime: 3000 }]
      : []);
    const r = await recallLearningIndex(wiki, { requirementName: null, workspaceDir: '/ws/repo' });
    expect(r.map((x) => x.path)).toEqual(['projects/repo/learnings/b.md', 'projects/repo/learnings/a.md']);
  });
  it('recallLearningIndex: KB 不可达 → 空数组（不抛）', async () => {
    const wiki = wikiOf(async () => { throw new Error('kb-unreachable'); });
    expect(await recallLearningIndex(wiki, { requirementName: 'x', workspaceDir: null })).toEqual([]);
  });
  it('recallDocIndex: projects/ 前缀 + 排除路1 范围，按 score 降序', async () => {
    const wiki = wikiOf(async () => [
      { path: 'projects/repo/learnings/g.md', title: '项目级经验', score: 90, mtime: 1 },
      { path: 'projects/checklists/s-1.md', title: '清单', score: 80, mtime: 1 },
      { path: 'projects/repo/ch_1/learnings/x.md', title: '需求级经验', score: 70, mtime: 1 },
      { path: 'projects/dsh-kanban/design-2026-08-14.md', title: '设计', score: 50, mtime: 1 },
    ]);
    const r = await recallDocIndex(wiki, { requirementName: '登录', workspaceDir: '/ws/repo' });
    expect(r.map((x) => x.path)).toEqual([
      'projects/checklists/s-1.md',
      'projects/repo/ch_1/learnings/x.md',
      'projects/dsh-kanban/design-2026-08-14.md',
    ]); // 项目级 learnings 排除；需求级 ch_1 learnings（非路1 范围）保留
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
  it('local 模式：learnings 取 wiki/synthesis/learnings/，docs 取其余 wiki/**', async () => {
    const wiki = wikiOf(async () => [
      { path: 'wiki/synthesis/learnings/ch_c1/l1.md', title: 'L1', score: 0.9, mtime: 100 },
      { path: 'wiki/sources/ch_c1/t_t1.md', title: 'T1', score: 0.8, mtime: 90 },
      { path: 'projects/learnings/x.md', title: 'X', score: 0.7, mtime: 80 },
    ]);
    const learnings = await recallLearningIndex(wiki, { requirementName: '需求', workspaceDir: null, kbMode: 'local' });
    expect(learnings.map((r) => r.path)).toEqual(['wiki/synthesis/learnings/ch_c1/l1.md']);
  });
  it('local 模式：searchChecklists 用 wiki/queries/checklists/ 前缀', async () => {
    const wiki = wikiOf(async () => [{ path: 'wiki/queries/checklists/req-1.md', title: '【需求】r', score: 1, mtime: 1 }]);
    const c = await searchChecklists(wiki, 'wiki/queries/checklists/');
    expect(c).toEqual(['wiki/queries/checklists/req-1.md']);
  });
  it('recallMemoryIndex 转发 kbMode（生产路径，审查 M6）', async () => {
    const wiki = wikiOf(async () => [
      { path: 'wiki/synthesis/learnings/ch_c1/l1.md', title: 'L1', score: 0.9, mtime: 100 },
      { path: 'projects/learnings/old.md', title: 'O', score: 0.5, mtime: 10 },
    ]);
    const idx = await recallMemoryIndex(wiki, { requirementName: '需求', workspaceDir: null, maxEntries: 8, kbMode: 'local' });
    expect(idx).toContain('wiki/synthesis/learnings/ch_c1/l1.md');
    expect(idx).not.toContain('projects/learnings/old.md');
  });
});

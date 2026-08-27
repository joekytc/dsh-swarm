// src/wiki/memory-recall.ts
// /plan: 记忆索引两段式检索（KB 只读、非阻塞）：路1 learnings 加权合并（score×0.7+mtime×0.3），
// 路2 文档相关检索。任何失败 → 空/null（主流程零阻塞）。
import type { WikiVaultClient, WikiSearchResult } from './wiki-vault-client.js';
import { buildMemoryIndexBlock, weightedRank, buildRepoSlug, type MemoryIndexEntry } from '../domain/memory.js';

const TIMEOUT_MS = 6_000;

async function withTimeout<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS))]);
  } catch {
    return null;
  }
}

/** 路1 范围：全局 + 当前仓库项目级 learnings（workspaceDir null → 仅全局）。 */
function isScopedLearning(path: string, repoSlug: string | null): boolean {
  if (path.startsWith('projects/learnings/')) return true;
  if (repoSlug && path.startsWith(`projects/${repoSlug}/learnings/`)) return true;
  return false;
}

export async function recallLearningIndex(wiki: WikiVaultClient, opts: { requirementName: string | null; workspaceDir: string | null }): Promise<WikiSearchResult[]> {
  const repoSlug = opts.workspaceDir ? buildRepoSlug(opts.workspaceDir) : null;
  if (opts.requirementName) {
    const r = await withTimeout(wiki.search(opts.requirementName));
    if (!r) return [];
    return weightedRank(r.filter((x) => isScopedLearning(x.path, repoSlug)), (x) => x.score, (x) => x.mtime);
  }
  const r = await withTimeout(wiki.search('【Learning】'));
  if (!r) return [];
  return r.filter((x) => isScopedLearning(x.path, repoSlug)).sort((a, b) => b.mtime - a.mtime);
}

export async function recallDocIndex(wiki: WikiVaultClient, opts: { requirementName: string | null; workspaceDir: string | null }): Promise<WikiSearchResult[]> {
  if (!opts.requirementName) return [];
  const r = await withTimeout(wiki.search(opts.requirementName));
  if (!r) return [];
  const repoSlug = opts.workspaceDir ? buildRepoSlug(opts.workspaceDir) : null;
  return r
    .filter((x) => x.path.startsWith('projects/') && !isScopedLearning(x.path, repoSlug))
    .sort((a, b) => b.score - a.score);
}

export async function recallMemoryIndex(wiki: WikiVaultClient, opts: { requirementName: string | null; workspaceDir: string | null; maxEntries: number }): Promise<string | null> {
  const [learnings, docs] = await Promise.all([
    recallLearningIndex(wiki, { requirementName: opts.requirementName, workspaceDir: opts.workspaceDir }),
    recallDocIndex(wiki, { requirementName: opts.requirementName, workspaceDir: opts.workspaceDir }),
  ]);
  const learningEntries: MemoryIndexEntry[] = learnings.slice(0, Math.ceil(opts.maxEntries / 2)).map((r) => ({ kind: 'learning', title: r.title, path: r.path }));
  const docEntries: MemoryIndexEntry[] = docs.slice(0, opts.maxEntries - learningEntries.length).map((r) => ({ kind: 'doc', title: r.title, path: r.path }));
  return buildMemoryIndexBlock([...learningEntries, ...docEntries]);
}

/** /openspec: 恢复路径复用：搜【需求】候选清单页（projects/ 前缀 top5）。 */
export async function searchChecklists(wiki: WikiVaultClient, pagePrefix = 'projects/'): Promise<string[]> {
  const r = await withTimeout(wiki.search('【需求】'));
  if (!r) return [];
  return r.map((x) => x.path).filter((p) => p.startsWith(pagePrefix)).slice(0, 5);
}

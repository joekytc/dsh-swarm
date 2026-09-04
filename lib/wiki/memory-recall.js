import { buildMemoryIndexBlock, weightedRank, buildRepoSlug } from '../domain/memory.js';
import { isAllowedWikiPagePath } from './page-path.js';
const TIMEOUT_MS = 6_000;
async function withTimeout(p) {
    try {
        return await Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS))]);
    }
    catch {
        return null;
    }
}
/** 路1 范围：remote = 当前仓库项目级 learnings（workspaceDir 空 → 无范围匹配；全局 learnings 命名空间已断代）；
 *  local = wiki/synthesis/learnings/。 */
function isScopedLearning(path, repoSlug, kbMode = 'remote') {
    if (kbMode === 'local')
        return path.startsWith('wiki/synthesis/learnings/');
    return !!repoSlug && path.startsWith(`projects/${repoSlug}/learnings/`);
}
export async function recallLearningIndex(wiki, opts) {
    const repoSlug = opts.workspaceDir ? buildRepoSlug(opts.workspaceDir) : null;
    const kbMode = opts.kbMode ?? 'remote';
    if (opts.requirementName) {
        const r = await withTimeout(wiki.search(opts.requirementName));
        if (!r)
            return [];
        return weightedRank(r.filter((x) => isScopedLearning(x.path, repoSlug, kbMode)), (x) => x.score, (x) => x.mtime);
    }
    const r = await withTimeout(wiki.search('【Learning】'));
    if (!r)
        return [];
    return r.filter((x) => isScopedLearning(x.path, repoSlug, kbMode)).sort((a, b) => b.mtime - a.mtime);
}
export async function recallDocIndex(wiki, opts) {
    if (!opts.requirementName)
        return [];
    const r = await withTimeout(wiki.search(opts.requirementName));
    if (!r)
        return [];
    const repoSlug = opts.workspaceDir ? buildRepoSlug(opts.workspaceDir) : null;
    const kbMode = opts.kbMode ?? 'remote';
    return r
        .filter((x) => kbMode === 'local'
        ? x.path.startsWith('wiki/') && !isScopedLearning(x.path, repoSlug, 'local')
        : isAllowedWikiPagePath(x.path) && !isScopedLearning(x.path, repoSlug, 'remote'))
        .sort((a, b) => b.score - a.score);
}
export async function recallMemoryIndex(wiki, opts) {
    const [learnings, docs] = await Promise.all([
        recallLearningIndex(wiki, { requirementName: opts.requirementName, workspaceDir: opts.workspaceDir, kbMode: opts.kbMode }),
        recallDocIndex(wiki, { requirementName: opts.requirementName, workspaceDir: opts.workspaceDir, kbMode: opts.kbMode }),
    ]);
    const learningEntries = learnings.slice(0, Math.ceil(opts.maxEntries / 2)).map((r) => ({ kind: 'learning', title: r.title, path: r.path }));
    const docEntries = docs.slice(0, opts.maxEntries - learningEntries.length).map((r) => ({ kind: 'doc', title: r.title, path: r.path }));
    return buildMemoryIndexBlock([...learningEntries, ...docEntries]);
}
/** /openspec: 恢复路径复用：搜【需求】候选清单页（pagePrefix 前缀 top5；local 调用方传 wiki/queries/checklists/）。 */
export async function searchChecklists(wiki, pagePrefix = 'projects/') {
    const r = await withTimeout(wiki.search('【需求】'));
    if (!r)
        return [];
    return r.map((x) => x.path).filter((p) => p.startsWith(pagePrefix)).slice(0, 5);
}

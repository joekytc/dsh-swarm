import { buildMemoryIndexBlock, weightedRank, buildRepoSlug } from '../domain/memory.js';
const TIMEOUT_MS = 6_000;
async function withTimeout(p) {
    try {
        return await Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS))]);
    }
    catch {
        return null;
    }
}
/** 路1 范围：全局 + 当前仓库项目级 learnings（workspaceDir null → 仅全局）。 */
function isScopedLearning(path, repoSlug) {
    if (path.startsWith('projects/learnings/'))
        return true;
    if (repoSlug && path.startsWith(`projects/${repoSlug}/learnings/`))
        return true;
    return false;
}
export async function recallLearningIndex(wiki, opts) {
    const repoSlug = opts.workspaceDir ? buildRepoSlug(opts.workspaceDir) : null;
    if (opts.requirementName) {
        const r = await withTimeout(wiki.search(opts.requirementName));
        if (!r)
            return [];
        return weightedRank(r.filter((x) => isScopedLearning(x.path, repoSlug)), (x) => x.score, (x) => x.mtime);
    }
    const r = await withTimeout(wiki.search('【Learning】'));
    if (!r)
        return [];
    return r.filter((x) => isScopedLearning(x.path, repoSlug)).sort((a, b) => b.mtime - a.mtime);
}
export async function recallDocIndex(wiki, opts) {
    if (!opts.requirementName)
        return [];
    const r = await withTimeout(wiki.search(opts.requirementName));
    if (!r)
        return [];
    const repoSlug = opts.workspaceDir ? buildRepoSlug(opts.workspaceDir) : null;
    return r
        .filter((x) => x.path.startsWith('projects/') && !isScopedLearning(x.path, repoSlug))
        .sort((a, b) => b.score - a.score);
}
export async function recallMemoryIndex(wiki, opts) {
    const [learnings, docs] = await Promise.all([
        recallLearningIndex(wiki, { requirementName: opts.requirementName, workspaceDir: opts.workspaceDir }),
        recallDocIndex(wiki, { requirementName: opts.requirementName, workspaceDir: opts.workspaceDir }),
    ]);
    const learningEntries = learnings.slice(0, Math.ceil(opts.maxEntries / 2)).map((r) => ({ kind: 'learning', title: r.title, path: r.path }));
    const docEntries = docs.slice(0, opts.maxEntries - learningEntries.length).map((r) => ({ kind: 'doc', title: r.title, path: r.path }));
    return buildMemoryIndexBlock([...learningEntries, ...docEntries]);
}
/** /openspec: 恢复路径复用：搜【需求】候选清单页（projects/ 前缀 top5）。 */
export async function searchChecklists(wiki, pagePrefix = 'projects/') {
    const r = await withTimeout(wiki.search('【需求】'));
    if (!r)
        return [];
    return r.map((x) => x.path).filter((p) => p.startsWith(pagePrefix)).slice(0, 5);
}

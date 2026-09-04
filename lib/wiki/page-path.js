// src/wiki/page-path.ts
// Q3&5：KB 页面路径统一规则（单一来源）。三份文档：
//   需求清单     projects/checklists/<slug>-<ts>.md     （planning_checklist_save，代码强制）
//   实施计划/结果 projects/ch_<id>/t_<id>.md             （W2/W3 wiki_write，工具边界强制）
//   DT 评审页    projects/ch_<id>/review/<name>.md      （DT wiki_write，工具边界强制）
import { WikiError } from './wiki-vault-client.js';
export const CHECKLIST_PAGE_PREFIX = 'projects/checklists/';
export const LEARNINGS_PAGE_PREFIX = 'projects/learnings/';
/** 白名单：checklists + 三级 learnings + 链命名空间（杜绝 LLM 自造路径）。 */
const KB_PAGE_PATH_RE = /^projects\/(?:checklists\/|learnings\/|[a-z0-9-]+\/learnings\/|ch_[0-9a-z_]+\/(?:t_[0-9a-z_]+\.md|review\/|learnings\/))/;
/** 从需求名（回退 problem）派生 URL 安全 slug：ASCII 化、空格/特殊字符→-、限长 40；全非 ASCII（如中文）兜底 'req'。 */
export function buildChecklistSlug(name) {
    const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return slug || 'req';
}
export function isAllowedWikiPagePath(pagePath) {
    return KB_PAGE_PATH_RE.test(pagePath);
}
/** 三级 learnings 路径谓词：全局 / 项目级 / 需求级。 */
export function isLearningsPath(pagePath) {
    return /^projects\/(?:learnings\/|[a-z0-9-]+\/learnings\/|ch_[0-9a-z_]+\/learnings\/)/.test(pagePath);
}
/** 工具边界硬校验：不符白名单直接抛 kb-rejected（wiki_write 用）。 */
export function assertAllowedWikiPagePath(pagePath) {
    if (!isAllowedWikiPagePath(pagePath)) {
        throw new WikiError('kb-rejected', undefined, `page path outside allowed namespaces (projects/checklists/, projects/learnings/, projects/<slug>/learnings/, projects/ch_*/learnings/, projects/ch_*/t_*.md, projects/ch_*/review/): ${pagePath}`);
    }
}
// ── 本地 KB（llm-wiki）路径规则（双模式 D5/D9）──────────────────────────────
export const LOCAL_CHECKLIST_PREFIX = 'wiki/queries/checklists/';
export const LOCAL_LEARNING_BASE = 'wiki/synthesis/learnings/';
/** 本地模式交付白名单：KB 库根下 wiki/** 相对路径（拒绝对象路径、.. 穿越、空串）。 */
export function isLocalKbPagePath(pagePath) {
    const p = String(pagePath ?? '');
    if (!p || p.startsWith('/') || p.includes('..'))
        return false;
    return p.startsWith('wiki/');
}
/** 本地模式工具边界硬校验：不符直接抛 kb-rejected。 */
export function assertLocalKbPagePath(pagePath) {
    if (!isLocalKbPagePath(pagePath)) {
        throw new WikiError('kb-rejected', undefined, `kb-rejected: local KB page path outside wiki/**: ${pagePath}`);
    }
}

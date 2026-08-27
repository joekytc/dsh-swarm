// src/wiki/page-path.ts
// Q3&5：KB 页面路径统一规则（单一来源）。三份文档：
//   需求清单     projects/checklists/<slug>-<ts>.md     （planning_checklist_save，代码强制）
//   实施计划/结果 projects/ch_<id>/t_<id>.md             （W2/W3 wiki_write，工具边界强制）
//   DT 评审页    projects/ch_<id>/review/<name>.md      （DT wiki_write，工具边界强制）
import { WikiError } from './wiki-vault-client.js';

export const CHECKLIST_PAGE_PREFIX = 'projects/checklists/';

/** 白名单：wiki_write 只允许写这三类命名空间（杜绝 LLM 自造路径/拼错层级）。id 段宽松匹配（兼容真实 nid 两段式 ch_1_xxx 与测试单段 ch_1）。 */
const KB_PAGE_PATH_RE = /^projects\/(?:checklists\/|ch_[0-9a-z_]+\/(?:t_[0-9a-z_]+\.md|review\/))/;

/** 从需求名（回退 problem）派生 URL 安全 slug：ASCII 化、空格/特殊字符→-、限长 40；全非 ASCII（如中文）兜底 'req'。 */
export function buildChecklistSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'req';
}

export function isAllowedWikiPagePath(pagePath: string): boolean {
  return KB_PAGE_PATH_RE.test(pagePath);
}

/** 工具边界硬校验：不符白名单直接抛 kb-rejected（wiki_write 用）。 */
export function assertAllowedWikiPagePath(pagePath: string): void {
  if (!isAllowedWikiPagePath(pagePath)) {
    throw new WikiError('kb-rejected', undefined, `page path outside allowed namespaces (projects/checklists/, projects/ch_*/t_*.md, projects/ch_*/review/): ${pagePath}`);
  }
}

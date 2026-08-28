export declare const CHECKLIST_PAGE_PREFIX = "projects/checklists/";
export declare const LEARNINGS_PAGE_PREFIX = "projects/learnings/";
/** 从需求名（回退 problem）派生 URL 安全 slug：ASCII 化、空格/特殊字符→-、限长 40；全非 ASCII（如中文）兜底 'req'。 */
export declare function buildChecklistSlug(name: string): string;
export declare function isAllowedWikiPagePath(pagePath: string): boolean;
/** 三级 learnings 路径谓词：全局 / 项目级 / 需求级。 */
export declare function isLearningsPath(pagePath: string): boolean;
/** 工具边界硬校验：不符白名单直接抛 kb-rejected（wiki_write 用）。 */
export declare function assertAllowedWikiPagePath(pagePath: string): void;

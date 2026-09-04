export declare const CHECKLIST_PAGE_PREFIX = "projects/checklists/";
export declare const LEARNINGS_PAGE_PREFIX = "projects/learnings/";
/** 从需求名（回退 problem）派生 URL 安全 slug：ASCII 化、空格/特殊字符→-、限长 40；全非 ASCII（如中文）兜底 'req'。 */
export declare function buildChecklistSlug(name: string): string;
export declare function isAllowedWikiPagePath(pagePath: string): boolean;
/** 三级 learnings 路径谓词：全局 / 项目级 / 需求级。 */
export declare function isLearningsPath(pagePath: string): boolean;
/** 工具边界硬校验：不符白名单直接抛 kb-rejected（wiki_write 用）。 */
export declare function assertAllowedWikiPagePath(pagePath: string): void;
export declare const LOCAL_CHECKLIST_PREFIX = "wiki/queries/checklists/";
export declare const LOCAL_LEARNING_BASE = "wiki/synthesis/learnings/";
/** 本地模式交付白名单：KB 库根下 wiki/** 相对路径（拒绝对象路径、.. 穿越、空串）。 */
export declare function isLocalKbPagePath(pagePath: string): boolean;
/** 本地模式工具边界硬校验：不符直接抛 kb-rejected。 */
export declare function assertLocalKbPagePath(pagePath: string): void;

/** 命名空间提示（报错/工具 description 文案单一来源，禁止散落硬编码）。 */
export declare const KB_PAGE_NAMESPACES_HINT = "projects/<repoSlug>/checklists/\u3001projects/<repoSlug>/learnings/\u3001projects/<repoSlug>/ch_*/learnings/\u3001projects/<repoSlug>/ch_*/t_*.md\u3001projects/<repoSlug>/ch_*/review/\u3001projects/<repoSlug>/reviews/<topic>-<ymd>/";
/** 从需求名（回退 problem）派生 URL 安全 slug：ASCII 化、空格/特殊字符→-、限长 40；全非 ASCII（如中文）兜底 'req'。 */
export declare function buildChecklistSlug(name: string): string;
export declare function isAllowedWikiPagePath(pagePath: string): boolean;
/** learnings 路径谓词：项目级 / 需求级（均在 repoSlug 下）。 */
export declare function isLearningsPath(pagePath: string): boolean;
/** 工具边界硬校验：不符白名单直接抛 kb-rejected（wiki_write 用）。 */
export declare function assertAllowedWikiPagePath(pagePath: string): void;
export declare const LOCAL_CHECKLIST_PREFIX = "wiki/queries/checklists/";
export declare const LOCAL_LEARNING_BASE = "wiki/synthesis/learnings/";
/** 本地模式交付白名单：KB 库根下 wiki/** 相对路径（拒绝对象路径、.. 穿越、空串）。 */
export declare function isLocalKbPagePath(pagePath: string): boolean;
/** 本地模式工具边界硬校验：不符直接抛 kb-rejected。 */
export declare function assertLocalKbPagePath(pagePath: string): void;

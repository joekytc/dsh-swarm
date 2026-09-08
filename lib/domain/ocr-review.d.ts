/** OCR 委派子命令类型：预览 / 规则 / 托管评审。 */
export type OcrSub = 'preview' | 'rule' | 'managed';
/** OCR 调用可选参数集合。 */
export interface OcrArgsInput {
    repo?: string;
    from?: string;
    to?: string;
    commit?: string;
    paths?: string[];
}
/** 构造 OCR CLI 参数：preview/rule 走 delegate，managed 走 review 并恒带 JSON 输出。 */
export declare function buildOcrArgs(sub: OcrSub, a: OcrArgsInput): string[];
/** 预览结果归一化结构。 */
export interface PreviewResult {
    mode: string;
    files: {
        path: string;
        status: string;
    }[];
    excluded: {
        path: string;
        reason: string;
    }[];
    mergeBase: string | null;
}
/** 解析 delegate preview 的 JSON 输出，失败或结构异常时回退 unknown。 */
export declare function parsePreviewJson(stdout: string): PreviewResult;
/** 托管评审结果归一化结构。 */
export interface ManagedResult {
    status: string;
    comments: {
        path: string | null;
        line: number | null;
        severity: string | null;
        message: string;
    }[];
}
/** 解析 managed review 的 JSON 输出，失败时回退 unknown。 */
export declare function parseManagedJson(stdout: string): ManagedResult;
/** 建议切换托管评审的文件数阈值。 */
export declare const SUGGEST_MANAGED_FILES = 50;
/** 文件数严格超过阈值时建议托管评审。 */
export declare function shouldSuggestManaged(fileCount: number): boolean;
/** 生成独立评审页命名空间路径：projects/<slug>/reviews/<topic>-<ymd>/。 */
export declare function reviewPagePath(repoSlug: string, topic: string, ymd: string): string;
/** 判定路径是否为合法的独立评审页命名空间路径。 */
export declare function isStandaloneReviewNamespacePath(pagePath: string): boolean;

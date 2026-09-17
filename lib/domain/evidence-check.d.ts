/** 评审证据核验纯函数（PR2 三级递进的判定层，零 IO）。
 * 四态：matches/differs/could-not-replay/not-provided（澄清表 #6，2026-09-17 精化：
 * "严重缺证才重放"不可执行——缺证即无命令可重放，落 could-not-replay + 转人工）。
 * schema 单点封装：owner 调整 evidence 形态只改 parseIssueEvidence。 */
export type EvidenceState = 'matches' | 'differs' | 'could-not-replay' | 'not-provided';
export interface IssueEvidence {
    file: string;
    command: string;
    exit: number;
}
/** issue.evidence 结构校验（issue #2 原样 schema：{file, command, exit}）。非法 → null（按 not-provided 处理）。 */
export declare function parseIssueEvidence(raw: unknown): IssueEvidence | null;
/** 纸面核对（零执行）：存档文件首行 `[exit code: N]` vs 声明 exit（行尾锚定，防 `[exit code: 0]任意文本` 绕过）。
 * unreadable（文件缺失/首行非规范格式）宁纵勿枉 → 转人工，不判 matches。 */
export declare function paperCheck(content: string | null, claimedExit: number): 'matches' | 'mismatch' | 'unreadable';
/** 命令准入：词边界前缀匹配（非子串）；`npm run` 仅放行白名单内固定脚本名；rest 禁 shell 元字符。 */
export declare function isAllowedCommand(command: string, prefixes: string[]): boolean;

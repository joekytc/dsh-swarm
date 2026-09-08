export declare function localKbRoot(): string;
/** 尽力创建库根（幂等）；失败由调用方告警 + block(kb-unreachable)。 */
export declare function ensureLocalKbRoot(root?: string): string;
/** target 须为绝对路径且解析后落在 root 内（resolve 折叠重复斜杠；相对路径 fail-closed，
 *  因为 bash/fs 里的相对目标语义属会话 cwd 而非库根，护栏不可猜测）。 */
export declare function isInsideKbRoot(root: string, target: string): boolean;

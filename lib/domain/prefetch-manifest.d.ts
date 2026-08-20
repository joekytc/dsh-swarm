import type { Handoff, Role, TaskMode } from './types.js';
export interface PrefetchFileEntry {
    path: string;
    expected: 'exists' | 'absent' | 'content-hash';
    note?: string;
}
export interface PrefetchManifest {
    repo: {
        localPath: string;
        remoteUrl?: string;
        branch?: string;
        dirtyFiles: string[];
    };
    files: PrefetchFileEntry[];
}
/** W1-pre 预取清单 schema 校验：返回错误列表（空数组 = 合法）。 */
export declare function validatePrefetchManifest(raw: unknown): string[];
/** 轻档：仅 w:file（W1-pre）交接且带 manifest 时做 schema 校验；缺 manifest 不算缺失（legacy 兼容）。 */
export declare function validateManifestIfPresent(assignee: Role, mode: TaskMode, handoff: Handoff | undefined): string[];

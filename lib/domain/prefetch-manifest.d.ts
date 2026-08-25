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
/** 需求澄清清单 manifest schema 校验（planning-checklist 复用本 schema）：返回错误列表（空数组 = 合法）。 */
export declare function validatePrefetchManifest(raw: unknown): string[];

import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
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
/** prefetch 子代理结构化输出的 JSON Schema（经 ctx.subagents.start 的 outputSchema 传入，
 *  由 spawn provider 在子代理侧强制校验；assertObjectJsonSchema 强制子集内：
 *  type/properties/required/items/enum/additionalProperties）。与 validatePrefetchManifest 同源同语义。 */
export declare const PREFETCH_MANIFEST_SCHEMA: ObjectJsonSchema;
/** 需求澄清清单 manifest schema 校验（planning-checklist 复用本 schema）：返回错误列表（空数组 = 合法）。 */
export declare function validatePrefetchManifest(raw: unknown): string[];

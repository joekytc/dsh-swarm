import type { SpecCardSections } from './types.js';
import { type PrefetchManifest } from './prefetch-manifest.js';
export interface PlanningChecklist {
    spec: SpecCardSections;
    manifest: PrefetchManifest;
    clarifications: Array<{
        q: string;
        a: string;
    }>;
    doubts: Array<{
        q: string;
        resolved: boolean;
        answer?: string;
    }>;
}
/** 需求澄清清单 schema 硬校验：返回错误列表（空数组=合法）。清单缺段即拒绝保存（硬闸，主 agent 会话内修正）。 */
export declare function validatePlanningChecklist(raw: unknown): string[];

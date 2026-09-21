import type { SpecCardSections } from './types.js';
import { type PrefetchManifest } from './prefetch-manifest.js';
export interface PlanningChecklist {
    requirementName?: string;
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
    risks?: Array<{
        description: string;
        source: string;
        mitigation: string;
    }>;
}
/** 需求澄清清单 schema 硬校验：返回错误列表（空数组=合法）。清单缺段即拒绝保存（硬闸，主 agent 会话内修正）。 */
export declare function validatePlanningChecklist(raw: unknown): string[];
/** 需求澄清清单页标题：与任务卡 title 同源同逻辑（buildChainTitle），保证 KB 可检索。 */
export declare function buildChecklistTitle(c: PlanningChecklist): string;
/** 需求澄清清单落库 body：标题【需求】+ 各段可读 markdown（非裸 JSON）。KB 与临时目录两分支共用。 */
export declare function formatChecklistBody(c: PlanningChecklist): string;
/** 从清单页原文提取机读 PlanningChecklist（无损恢复路径）：无段/损坏/校验不过一律返回 null，
 *  由调用方回退 legacy LLM 重建流程。domain 纯函数，无副作用。 */
export declare function extractChecklistJson(pageMd: string): PlanningChecklist | null;

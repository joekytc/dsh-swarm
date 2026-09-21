import type { SpecCardSections } from './types.js';
import { type PrefetchManifest } from './prefetch-manifest.js';
export interface SourceEntry {
    type: 'TAPD' | 'Jira' | '其他';
    url: string;
    note: string;
}
export interface PrdCollectionEntry {
    url: string;
    platform?: string;
    status: 'collected' | 'blocked';
    summary: string;
    pages?: string[];
    blockedReason?: string;
    degraded?: boolean;
}
export interface PlaceholderEntry {
    target: string;
    value: string;
    replace: string;
}
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
    sources: SourceEntry[];
    prdCollection: PrdCollectionEntry[];
    placeholders?: PlaceholderEntry[];
    greenfield?: boolean;
}
/** 闸2 禁词表：澄清答案中指代不明的缩写；宁窄后扩，避免误伤正常表述。 */
export declare const FORBIDDEN_SHORTHANDS: string[];
/** 需求澄清清单 schema 硬校验：返回错误列表（空数组=合法）。清单缺段即拒绝保存（硬闸，主 agent 会话内修正）。 */
export declare function validatePlanningChecklist(raw: unknown): string[];
/** 需求澄清清单页标题：与任务卡 title 同源同逻辑（buildChainTitle），保证 KB 可检索。 */
export declare function buildChecklistTitle(c: PlanningChecklist): string;
/** 需求澄清清单落库 body：标题【需求】+ 各段可读 markdown（非裸 JSON）。KB 与临时目录两分支共用。 */
export declare function formatChecklistBody(c: PlanningChecklist): string;
/** PRD 链接域名路由：已知平台直接判定，其余返回 null 交 LLM 自判。 */
export declare function routePrdPlatform(url: string): string | null;
/** PRD 原文切片：优先按一级标题（# 开头）切章，单片超 maxBytes 按行硬切。
 *  默认 45KB/片（wiki 大文档拆页惯例，低于服务端 body 上限留余量）。 */
export declare function slicePrdMarkdown(md: string, maxBytes?: number): string[];

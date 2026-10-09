import type { KanbanConfig } from '../config.js';
import type { Role } from './types.js';
export declare const ROLES: readonly Role[];
export interface ModelFallbackInput {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
}
export interface EditableModelInput {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    fallbacks?: ModelFallbackInput[];
}
export interface EditableOverride {
    wikiVault?: {
        baseUrl?: string;
        pagePrefix?: string;
    };
    roles?: {
        models?: Partial<Record<Role, EditableModelInput>>;
    };
    reviewEngine?: {
        mode?: 'delegate' | 'managed';
        managed?: {
            provider?: string;
            model?: string;
        };
    };
    imDelivery?: {
        fallbackBotId?: string;
    };
}
export interface ModelFallbackSnapshot {
    provider: string;
    model: string;
    reasoningEffort: string;
}
export interface EditableModelSnapshot {
    provider: string;
    model: string;
    reasoningEffort: string;
    fallbacks: ModelFallbackSnapshot[];
}
export interface EditableSnapshot {
    wikiVault: {
        baseUrl: string;
        pagePrefix: string;
    };
    roles: {
        models: Partial<Record<Role, EditableModelSnapshot>>;
    };
    /** 官方兜底（全局）——只读投影：编辑入口在部署配置（bundle patch），面板仅展示链尾。 */
    chainFallback: {
        provider: string;
        model: string;
        reasoningEffort: string;
    };
    reviewEngine: {
        mode: 'delegate' | 'managed';
        managed: {
            provider: string;
            model: string;
        };
    };
    imDelivery: {
        fallbackBotId: string;
    };
}
export type ConfigSource = 'override' | 'inherited';
export type SourceMap = Record<string, ConfigSource>;
/** 单角色降级候选上限（与 config schema .max(2)、GUI 上限同口径）。 */
export declare const MAX_FALLBACKS = 2;
export declare function mergeConfig(baseline: KanbanConfig, override: EditableOverride | undefined): KanbanConfig;
export declare function computeSources(override: EditableOverride | undefined): SourceMap;
export declare function projectEditable(effective: KanbanConfig): EditableSnapshot;
export declare function validateConfig(snapshot: EditableSnapshot): string[];
export declare function diffOverride(baseline: KanbanConfig, snapshot: EditableSnapshot): EditableOverride;

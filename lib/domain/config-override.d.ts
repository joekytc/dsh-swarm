import type { KanbanConfig } from '../config.js';
import type { Role } from './types.js';
export declare const ROLES: readonly Role[];
export interface EditableModelInput {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
}
export interface EditableOverride {
    wikiVault?: {
        baseUrl?: string;
        pagePrefix?: string;
    };
    roles?: {
        models?: Partial<Record<Role, EditableModelInput>>;
    };
}
export interface EditableModelSnapshot {
    provider: string;
    model: string;
    reasoningEffort: string;
}
export interface EditableSnapshot {
    wikiVault: {
        baseUrl: string;
        pagePrefix: string;
    };
    roles: {
        models: Partial<Record<Role, EditableModelSnapshot>>;
    };
}
export type ConfigSource = 'override' | 'inherited';
export type SourceMap = Record<string, ConfigSource>;
export declare function mergeConfig(baseline: KanbanConfig, override: EditableOverride | undefined): KanbanConfig;
export declare function computeSources(override: EditableOverride | undefined): SourceMap;
export declare function projectEditable(effective: KanbanConfig): EditableSnapshot;
export declare function validateConfig(snapshot: EditableSnapshot): string[];
export declare function diffOverride(baseline: KanbanConfig, snapshot: EditableSnapshot): EditableOverride;

import { Service, type Context } from '@deepseek-ai/cordis';
import type { EditableSnapshot, SourceMap } from '../domain/config-override.js';
import type { KanbanConfig } from '../config.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        swarmConfig: ConfigProvider;
    }
}
export type ApplyResult = {
    ok: true;
    effective: EditableSnapshot;
    sources: SourceMap;
    changed: string[];
} | {
    ok: false;
    errors: string[];
};
export declare class ConfigProvider extends Service {
    private readonly baseline;
    private readonly overrideFile;
    private readonly auditFile;
    private override;
    private effective;
    private sources;
    constructor(ctx: Context, baseline: KanbanConfig, storageDir: string);
    getEffective(): KanbanConfig;
    getSources(): SourceMap;
    get mode(): 'remote' | 'local';
    snapshot(): {
        effective: EditableSnapshot;
        sources: SourceMap;
    };
    applyOverride(snapshot: EditableSnapshot): ApplyResult;
    reset(): {
        effective: EditableSnapshot;
        sources: SourceMap;
    };
    private readOverride;
    private writeOverride;
    private appendAudit;
    private diffKeys;
}

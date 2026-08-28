import Schema from '@deepseek-ai/schemastery';
import type { Role } from './domain/types.js';
export interface KanbanConfig {
    storageDir: string;
    wikiVault: {
        baseUrl: string;
        pagePrefix: string;
    };
    roles: {
        models: Partial<Record<Role, {
            provider: string;
            model: string;
            reasoningEffort?: string;
            fallbacks?: Array<{
                provider: string;
                model: string;
                reasoningEffort?: string;
            }>;
        }>>;
    };
    dispatcher: {
        staleTimeoutSeconds: number;
        maxRetries: number;
        heartbeatIntervalSeconds: number;
        /** 协议违规护栏：连续 protocol_violation 阻塞 ≥ 此值后，下次违规直接 gave_up 不再恢复。默认 2。 */
        maxProtocolViolations: number;
        /** 评审返工护栏：pt/dt 各自最大返工次数（超限 review/gave-up + [review-final]）。默认 pt=2 dt=3。 */
        maxReworksPerRole: {
            pt: number;
            dt: number;
        };
    };
    prefixRoutes: {
        plan: string;
        openspec: string;
        learning: string;
    };
    memory: {
        enabled: boolean;
        maxIndexEntries: number;
    };
    ui: {
        enabled: boolean;
        /** 看板宽度下界（px）。 */
        contentMinWidth: number;
        /** 看板宽度上界（px）。 */
        contentMaxWidth: number;
        sseHeartbeatSeconds: number;
    };
}
export declare const Config: Schema<KanbanConfig>;

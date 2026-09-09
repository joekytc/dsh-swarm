import Schema from '@deepseek-ai/schemastery';
import type { Role } from './domain/types.js';
/** 斜杠命令前缀路由（单一事实源）：plan/openspec/learning/send 已实现，run/changeset/archive 待落地时追加。 */
export interface PrefixRoutes {
    plan: string;
    openspec: string;
    learning: string;
    send: string;
}
export declare const DEFAULT_PREFIX_ROUTES: PrefixRoutes;
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
        /** 评审返工护栏：pt/dt 各自最大返工次数（超限 review/gave-up + [review-final]）。默认 pt=3 dt=3。 */
        maxReworksPerRole: {
            pt: number;
            dt: number;
        };
    };
    prefixRoutes: PrefixRoutes;
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
    gates: {
        enabled: boolean;
        /** 单条命令超时（ms）。默认 600000（10min，vitest 冷启动余量）。到点 SIGKILL，非实际耗时。 */
        timeoutMs: number;
        /** 命令黑名单子串（命中即拒执行）。纵深防御：派生命令由系统从 tdd 生成，正常不触黑名单。 */
        forbidden: string[];
    };
    /** IM 主动投递（企微，2026-09-07 评审决议）：W3 收尾/链阻塞时经 dsh-im 投群。
     *  enabled=false（默认）功能关闭；botId/targetId 留空=运行时自动发现（唯一 wecom bot + 唯一已保存群目标）。 */
    imDelivery: {
        enabled: boolean;
        botId: string;
        targetId: string;
        /** 私聊目标（自由投递 /sms -s）：留空=自动发现唯一 kind:'user' 已保存目标，仅且只有一个。 */
        dmTargetId: string;
    };
    /** 评审引擎双模：delegate=沿用各角色自有模型评审；managed=统一经 dsh「模型链」评审。
     *  managed.provider/model = dsh「模型链」llm-catalog 的 provider/model id，wire 时写成 ocr 自定义 provider（dsh-managed）；key 不落本配置。 */
    reviewEngine: {
        mode: 'delegate' | 'managed';
        managed: {
            provider: string;
            model: string;
        };
    };
}
export declare const Config: Schema<KanbanConfig>;

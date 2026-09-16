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
     *  enabled=false（默认）功能关闭；botId/targetId 留空=运行时自动发现（唯一 wecom bot + 唯一已保存群目标）。
     *  多机器人接入时：botId 留空 → 按会话 preset 匹配机器人（探针读 dsh-im 侧 agentPreset）；
     *  未命中 → fallbackBotId；仍未设默认 → 手动投递路径交互选择（auto 路径直接 fail-closed 列候选）。 */
    imDelivery: {
        enabled: boolean;
        botId: string;
        targetId: string;
        /** 私聊目标（自由投递 /sms -s）：留空=自动发现唯一 kind:'user' 已保存目标，仅且只有一个。 */
        dmTargetId: string;
        /** 默认机器人（预设未命中的落点）：空=未设默认，多机器人下手动投递每次都要交互选择。 */
        fallbackBotId: string;
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
    /** wiki_write 会话级放行的 preset id 白名单（buildStandaloneDtGuard 非独立分支热读）。
     *  默认：插件自有 'swarm'（蜂群 preset）/'kanban-w'（W preset）+ 宿主内置 'ptc'
     *  （2026-09-16 实测：dsh web「蜂群模式」标签会话的 header.agentPreset 实际为宿主
     *  PTC 模式 id）。宿主 preset 体系演化/部署自定义模式 id 时改配置即可，无需改代码。
     *  写面仍由 wiki_write 工具内 assertAllowedWikiPagePath 五类命名空间白名单硬约束。 */
    wikiWritePresets: string[];
}
export declare const Config: Schema<KanbanConfig>;

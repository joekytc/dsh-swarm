import type { Context } from '@deepseek-ai/cordis';
import type { KanbanService } from '../domain/kanban-service.js';
import type { ConfigProvider } from './config-provider.js';
/** dsh-im 宿主服务结构接口（形状以 @xmanrui/dsh-im PROACTIVE_DELIVERY.md 为准，运行时守卫校验）。 */
export interface DshImLike {
    send(botId: string, targetId: string, text: string, opts?: {
        signal?: AbortSignal;
    }): Promise<{
        sent?: boolean;
    }>;
    listBots(): Promise<Array<{
        botId: string;
        channel: string;
    }>>;
    listTargets(botId: string): Promise<{
        botId: string;
        channel: string;
        targets: Array<{
            targetId: string;
            name?: string;
            kind: string;
            route: Record<string, string>;
        }>;
    }>;
}
export interface ImDeliveryOptions {
    /** 缺省写 storageDir/dispatcher.log（[im-delivery] 前缀；grill Q4 决议落盘位置）。 */
    log?: (msg: string) => void;
    /** 重试退避间隔（ms）；测试传 [0,0,0]。 */
    retryDelaysMs?: number[];
}
export declare function isDshImLike(svc: unknown): svc is DshImLike;
/** botId/targetId 解析（grill Q3/Q9 决议）：配置显式指定优先；留空自动发现唯一 wecom bot + 唯一已保存群目标；
 *  发现异常返回 error（调用方留痕不投，fail-closed——投错群比不投更糟）。 */
export declare function resolveTarget(im: DshImLike, cfg: {
    botId: string;
    targetId: string;
}): Promise<{
    botId: string;
    targetId: string;
} | {
    error: string;
}>;
/** 发送 + 退避重试（仅可重试错误码；{sent:true} 即停——dsh-im 无幂等，成功后绝不重发）。 */
export declare function sendWithRetry(im: DshImLike, botId: string, targetId: string, text: string, delays: number[], log: (m: string) => void): Promise<{
    ok: true;
} | {
    ok: false;
    error: string;
}>;
/** 接线：订阅看板事件多播通道（不动 setOnTaskCompleted 单消费者钩子）。
 *  listener 同步返回，投递全程 fire-and-forget 自兜异常（publish 在 emit 队列内同步调用，不得拖慢落盘）。 */
export declare function wireImDelivery(ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, opts?: ImDeliveryOptions): () => void;

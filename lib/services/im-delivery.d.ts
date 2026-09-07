import type { Context } from '@deepseek-ai/cordis';
import type { KanbanService } from '../domain/kanban-service.js';
import type { BoardState } from '../domain/types.js';
import type { ConfigProvider } from './config-provider.js';
/** dsh-im 宿主服务结构接口（形状以 @xmanrui/dsh-im PROACTIVE_DELIVERY.md 为准，运行时守卫校验）。
 *  listTargets 证据（2026-09-07）：PROACTIVE_DELIVERY.md:176 `const targets = await ctx.dshIm.listTargets(botId);
 *  // [{ targetId, name?, kind, route }, ...]`；宿主 lib/index.js 实现为
 *  `listTargets: async Y => (await H.listTargets(Y)).targets`（同 Host 服务返回裸数组）。
 *  `{ botId, channel, targets }` 是 Connection RPC `target.list` 的信封形状，与同 Host 服务不同。 */
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
    listTargets(botId: string): Promise<Array<{
        targetId: string;
        name?: string;
        kind: string;
        route: Record<string, string>;
    }>>;
}
export interface ImDeliveryOptions {
    /** 缺省写 storageDir/dispatcher.log（[im-delivery] 前缀；grill Q4 决议落盘位置）。 */
    log?: (msg: string) => void;
    /** 重试退避间隔（ms）；测试传 [0,0,0]。 */
    retryDelaysMs?: number[];
    /** 手动投递路径（/sms）：失败仅 dispatcher.log 留痕，不写 chain/im-delivery-failed 链事件（用户同步可见错误）。 */
    manual?: boolean;
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
/** 发送器工厂：resolveDshIm → resolveTarget（fail-closed）→ sendWithRetry → 留痕。
 *  auto 路径（wireImDelivery）失败额外写 chain/im-delivery-failed 链事件；
 *  manual 路径（/sms，opts.manual）仅 dispatcher.log 留痕，错误同步返回给调用方。 */
export declare function createSender(ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, opts?: ImDeliveryOptions): (chainId: string, text: string) => Promise<{
    ok: true;
    botId: string;
    targetId: string;
} | {
    ok: false;
    error: string;
}>;
export type ReportVariant = 'completion' | 'blocked';
/** /sms 链解析（纯函数）。空 query：completion=最近满足 W3 完成判据的链（最后完成事件 at 最大）；
 *  blocked=最近阻塞的链（chain/blocked 事件 at 最大）。显式 query：全量链精确/后缀解析后再验判据。 */
export declare function resolveReportChainId(state: BoardState, variant: ReportVariant, query: string): {
    ok: true;
    chainId: string;
} | {
    ok: false;
    error: string;
    candidates?: Array<{
        chainId: string;
        title: string;
    }>;
};
/** /sms 手动投递：解析链 → 领域函数渲染正文（红线：正文只出自 buildCompletionMessage/buildBlockMessage，
 *  绝不返回给模型）→ createSender 发送。不受 imDelivery.enabled 门控（显式人工调用即意图），
 *  但仍要求 dshIm 服务在位且形状合法、目标可解析（同 auto 路径 fail-closed 规则）。 */
export declare function sendChainReport(ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, opts: ImDeliveryOptions, variant: ReportVariant, query: string): Promise<{
    ok: true;
    chainId: string;
    botId: string;
    targetId: string;
} | {
    ok: false;
    error: string;
    guidance?: string;
}>;
/** 接线：订阅看板事件多播通道（不动 setOnTaskCompleted 单消费者钩子）。
 *  listener 同步返回，投递全程 fire-and-forget 自兜异常（publish 在 emit 队列内同步调用，不得拖慢落盘）。 */
export declare function wireImDelivery(ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, opts?: ImDeliveryOptions): () => void;

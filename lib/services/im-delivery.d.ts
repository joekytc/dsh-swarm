import type { Context } from '@deepseek-ai/cordis';
import type { KanbanService } from '../domain/kanban-service.js';
import type { BoardState } from '../domain/types.js';
import type { ConfigProvider } from './config-provider.js';
import { type ProbeResult } from './im-bot-probe.js';
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
    /** 缺省写 storageDir/dispatcher.log（[im-delivery] 前缀；评审决议落盘位置）。 */
    log?: (msg: string) => void;
    /** 重试退避间隔（ms）；测试传 [0,0,0]。 */
    retryDelaysMs?: number[];
    /** 手动投递路径（/sms）：失败仅 dispatcher.log 留痕，不写 chain/im-delivery-failed 链事件（用户同步可见错误）。 */
    manual?: boolean;
    /** 投递目标类型（0.3.x 自由投递）：group=群聊；user=私聊（仅且只有一个已保存目标）。缺省 group。 */
    targetKind?: 'group' | 'user';
    /** 手动投递会话的 preset（工具从 session header 注入）：多机器人时用于匹配机器人默认模式。
     *  缺省=无 preset（auto 路径无会话上下文），跳过模式匹配直接走默认/交互。 */
    sessionPreset?: string;
    /** 手动投递会话的 live agent（工具从 exec.agent 注入）：userQuestions 的 GUI answerer 挂在
     *  Agent-scoped waterfall 上，不传 agent 的询问落在根 ctx 无人应答（NO_PROVIDER）。 */
    agent?: unknown;
    /** 测试注入：覆盖机器人决策链的探针/交互/写默认实现（生产由 ctx 与 configProvider 装配）。 */
    botChoice?: Partial<BotChoiceDeps>;
}
/** dsh-im 未安装的可识别错误前缀（0.3.1：缺插件属环境问题不重试，直接友好提醒安装）。 */
export declare const DSH_IM_MISSING_PREFIX = "dsh-im-not-installed";
export declare const DSH_IM_MISSING_GUIDANCE = "\u672A\u68C0\u6D4B\u5230 dsh-im \u63D2\u4EF6\uFF0C\u65E0\u6CD5\u6295\u9012\u4F01\u5FAE\u6D88\u606F\u3002\u8BF7\u5148\u5B89\u88C5\u5E76\u542F\u7528 @xmanrui/dsh-im \u63D2\u4EF6\uFF08\u5B89\u88C5\u540E\u91CD\u542F dsh \u751F\u6548\uFF09\uFF0C\u518D\u91CD\u8BD5\u6295\u9012\u3002";
export declare function isDshImLike(svc: unknown): svc is DshImLike;
/** 机器人来源（供调用方在 guidance 里如实转述，勿让模型猜）。 */
export type BotVia = 'explicit' | 'single' | 'preset' | 'fallback' | 'interactive';
export interface BotAskOption {
    botId: string;
    label: string;
}
export interface BotChoiceDeps {
    /** 当前会话 preset（手动投递由工具从 session header 注入）；null/空 = 无法模式匹配（auto 路径）。 */
    sessionPreset: string | null;
    /** 多机器人时读 bot↔preset/连接态；失败=降级（不阻断投递，退化到默认/交互）。 */
    probe: () => Promise<ProbeResult>;
    /** 交互选择；无询问通道返回 null，用户取消/超时也返回 null（fail-closed 不投）。 */
    ask: ((options: BotAskOption[]) => Promise<{
        botId: string;
        setDefault: boolean;
    } | null>) | null;
    /** 写默认机器人；写失败返回 false（本次投递照常，仅默认未落库）。 */
    setFallback: ((botId: string) => Promise<boolean>) | null;
    log: (m: string) => void;
}
export interface BotChoice {
    botId: string;
    via: BotVia;
    fallbackSaved?: boolean;
}
/** 应答 → 候选 botId（宽松匹配，宁缺勿错）：
 *  ① 令牌精确相等；② 与令牌互相包含（仅当令牌足够长，防 3~5 字符误命中）。
 *  多义（>=2 个候选命中）或无法识别 → 空串（调用方 fail-closed 不投，绝不猜）。 */
export declare function matchBotAnswer(options: BotAskOption[], raw: string): string;
/** 机器人决策链：显式配置 → 唯一机器人 → 会话 preset 命中 → 默认机器人 → 交互选择。
 *  每环都 fail-closed（宁可不投也不投错对象）；探针不可用只失去自动匹配能力，不阻断投递。 */
export declare function chooseBot(im: DshImLike, cfg: {
    botId: string;
    fallbackBotId?: string;
}, deps: BotChoiceDeps): Promise<({
    ok: true;
} & BotChoice) | {
    ok: false;
    error: string;
}>;
/** targetId 解析：配置显式指定优先；留空自动发现该机器人下唯一已保存目标（按 kind）。
 *  群/私聊各自仅且只有一个——发现异常返回 error（调用方留痕不投，fail-closed）。
 *  机器人非显式指定（preset/默认/交互选出）而配置又填死了 targetId 时先校验归属：
 *  targetId 是 per-bot 作用域，填错机器人只会落成 dsh-im 的 unknown-target，这里提前给可行动报错。 */
export declare function resolveTargetId(im: DshImLike, botId: string, botIdExplicit: boolean, cfg: {
    targetId: string;
    dmTargetId?: string;
}, kind: 'group' | 'user'): Promise<{
    targetId: string;
} | {
    error: string;
}>;
/** botId+targetId 一步解析（无交互/无探针的简化入口，保留给单机器人场景与单测）。 */
export declare function resolveTarget(im: DshImLike, cfg: {
    botId: string;
    targetId: string;
    dmTargetId?: string;
    fallbackBotId?: string;
}, kind: 'group' | 'user'): Promise<{
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
export type SendResult = {
    ok: true;
    botId: string;
    targetId: string;
    via: BotVia;
    fallbackSaved?: boolean;
} | {
    ok: false;
    error: string;
};
/** 发送器工厂：resolveDshIm → chooseBot（fail-closed）→ resolveTargetId → sendWithRetry → 留痕。
 *  auto 路径（wireImDelivery）失败额外写 chain/im-delivery-failed 链事件；
 *  manual 路径（/sms，opts.manual）仅 dispatcher.log 留痕，错误同步返回给调用方。 */
export declare function createSender(ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, opts?: ImDeliveryOptions): (chainId: string, text: string) => Promise<SendResult>;
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
export type ParsedSendRequest = {
    variant: 'blocked' | 'completion' | 'free';
    query: string;
    dm: boolean;
};
/** /sms rest 三岔判定（纯函数，不查看板状态）：先剥独立 '-s' token（'-sx' 粘连不算，防误伤正文）；
 *  blocked 前缀 → 链阻塞汇报（词边界：'blockedx' 等粘连 token 是正文不算）；空 → 最近完成链；
 *  其余非空 → free（是否真指链由调用方 resolveReportChainId 复判——显式 id 是强信号，先链后自由）。 */
export declare function parseSendRequest(rest: string): ParsedSendRequest;
/** /sms 手动投递：解析链 → 领域函数渲染正文（红线：正文只出自 buildCompletionMessage/buildBlockMessage，
 *  绝不返回给模型）→ createSender 发送。不受 imDelivery.enabled 门控（显式人工调用即意图），
 *  但仍要求 dshIm 服务在位且形状合法、目标可解析（同 auto 路径 fail-closed 规则）。 */
export declare function sendChainReport(ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, opts: ImDeliveryOptions, variant: ReportVariant, query: string): Promise<{
    ok: true;
    chainId: string;
    botId: string;
    targetId: string;
    via: BotVia;
    fallbackSaved?: boolean;
} | {
    ok: false;
    error: string;
    guidance?: string;
}>;
/** 接线：订阅看板事件多播通道（不动 setOnTaskCompleted 单消费者钩子）。
 *  listener 同步返回，投递全程 fire-and-forget 自兜异常（publish 在 emit 队列内同步调用，不得拖慢落盘）。 */
export declare function wireImDelivery(ctx: Context, kanban: KanbanService, configProvider: ConfigProvider, opts?: ImDeliveryOptions): () => void;

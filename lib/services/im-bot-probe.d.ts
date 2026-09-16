/** 一个企微机器人的探针视图（字段取自 connection.status 的 bots[]，缺失值归一为空/离线）。 */
export interface BotCandidate {
    botId: string;
    /** 该机器人的默认 dsh 模式（dsh-im 设置页的 agentPreset）；未设置时为空串。 */
    agentPreset: string;
    connected: boolean;
    /** 展示名（appIdMasked，脱敏 id），仅用于交互提示。 */
    label: string;
}
export type ProbeResult = {
    ok: true;
    bots: BotCandidate[];
} | {
    ok: false;
    error: string;
};
/** 探针依赖（全部注入，便于测试与惰性读取）。 */
export interface ProbeDeps {
    /** 监听端口；未就绪（webServer 未挂载/未 listen）返回 null。 */
    port: () => number | null;
    /** 进程 token 换 cookie 的入口（ctx.connection.authenticatedUrl）；服务缺失返回 null。 */
    authenticatedUrl: (base: string) => string | null;
    fetchImpl: typeof fetch;
    /** 时钟（缓存 TTL 测试用）。 */
    now?: () => number;
}
/** connection.status 响应信封 → 候选数组。形状不符返回 null（上游改形状即降级，不猜字段）。 */
export declare function parseBotCandidates(raw: unknown): BotCandidate[] | null;
/** Set-Cookie 头 → `name=value` 片段（剥属性）。无 dsh-auth 前缀项返回 null。 */
export declare function pickAuthCookie(lines: readonly string[]): string | null;
/** 探针工厂：同一实例内结果短期缓存（连发 /sms 不重复握手），失败同样缓存以免每次重试打满超时。 */
export declare function createBotProbe(deps: ProbeDeps): () => Promise<ProbeResult>;
/** 从 cordis ctx 装配探针依赖（惰性：每次调用才读端口与 connection，避免 apply 期缓存未就绪的值）。 */
export declare function probeDepsFromCtx(ctx: {
    get(name: string): unknown;
}): ProbeDeps;

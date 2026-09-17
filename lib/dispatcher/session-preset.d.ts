/**
 * 会话 preset 读取 —— 全插件单一实现（守卫、交付投递、审计共用，禁止各写一份）。
 *
 * 四级官方链，逐级回退（鸭子类型，不引入 dsh-session / dsh-agent 依赖）：
 *   ① `ctx.agentPresets.composedPreset(agent.ctx)` —— **引擎真相**：该 live agent 实际挂载的组合。
 *      官方语义："Read from the live scope chain rather than from the session, so it answers for an
 *      agent whose session has not recorded a preset yet"；子代理继承父组合，同样有答案。
 *   ② `ctx.sessionProjections.stateOf(session,'agentPreset')` —— 会话日志口径（持久、可冷读，
 *      镜像客户端所见）；`agent-presets` 在插件 apply 期一次注册该 key（源码 register 调用），
 *      故 key 恒在，仅当会话对象缺失或投影服务未装时为空。
 *   ③ `session.header.agentPreset` —— **创建事实**（官方 deep-frozen）。
 *   ④ `agentPresets.defaultId` → 空串（调用方按「未知模式」处理，绝不能当默认模式猜）。
 *
 * 为什么不能只读 header（2026-09-17 实测 + 官方语义）：preset 只在会话**空白期（首轮之前）**可改，
 * 改后 header 保持创建时的值不再回头，而 ①② 前进。dsh web 的「蜂群模式」标签会话即此形态——
 * header 落宿主默认 'ptc'、实际运行 'swarm'。只读 header 会让所有按 preset 分流的判定整体错位
 * （实测造成：多机器人投递误判未命中、蜂群只读硬闸被绕过）。
 */
/** preset 读取用的 agent 最小面（结构鸭子类型）。 */
export interface PresetAgentLike {
    ctx?: unknown;
    session?: {
        header?: {
            agentPreset?: unknown;
        };
    };
}
/** preset 读取用的 ctx 最小面（只需 get）。 */
export interface PresetCtxLike {
    get?(name: string): unknown;
}
/** 创建事实（header.agentPreset）：仅用于「会话创建时是什么」这类语义，或作为末级回退。
 *  需要「现在跑什么模式」一律用 {@link sessionPresetOf}。 */
export declare function headerPresetOf(agent: unknown): string;
/** 当前会话/agent 的 preset id（引擎真相 → 会话投影 → 创建 header → 默认 id → 空串）。 */
export declare function sessionPresetOf(ctx: PresetCtxLike | null | undefined, agent: unknown): string;

/** 包内组合目录（随包分发）。src/roles/ 与 lib/roles/ 深度一致，均经 ../../ 回到包根。 */
export declare function packagePresetsDir(): string;
/** $DSH_HOME/.agent-presets（0.1.7-rc.x 宿主用户预设根；DSH_HOME 缺省 ~/.dsh）。 */
export declare function userPresetsRoot(): string;
/** 单条 preset 组合行（官方 PresetDefinition.plugins 行的结构面：cordis entry list）。 */
export interface PresetPluginRow {
    readonly id?: string;
    readonly name: string;
    readonly config?: unknown;
    readonly disabled?: unknown;
}
/** 注册给宿主 registry 的 preset 定义（官方 PresetDefinition 的结构面）。 */
export interface PresetDefinitionLike {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    readonly order?: number;
    readonly plugins: readonly PresetPluginRow[];
}
/** 宿主 agentPresets registry 的结构面（本插件只消费 register）。 */
export interface PresetRegistryLike {
    register(definition: PresetDefinitionLike): Promise<() => Promise<void>>;
}
/** 安装期 ctx 的最小面（只需可选 get）。 */
export interface PresetCtxLike {
    get?(name: string): unknown;
}
/** 解析包内单个 preset 的组合与元数据为宿主 registry 定义；组合缺失返回 undefined。 */
export declare function readPresetDefinition(pkgDir: string, id: string): PresetDefinitionLike | undefined;
/** 路径二：运行时注册全部包内 preset；返回注册成功/失败 id 列表与成功项的撤销句柄（组合缺失的 id 不计）。 */
export declare function registerRolePresets(registry: PresetRegistryLike, ids: readonly string[], pkgDir?: string): Promise<{
    registered: string[];
    failed: string[];
    disposers: Array<() => Promise<void>>;
}>;
/** 安装结果（如实区分两条路径，不假阳性）。 */
export interface RolePresetInstallReport {
    /** 目录写成功的 preset id（路径一）。 */
    dirWritten: string[];
    /** 运行时注册成功的 preset id（路径二；服务不可用时为空）。 */
    runtimeRegistered: string[];
    /** 运行时注册失败的 preset id。 */
    runtimeFailed: string[];
    /** 路径二实际形态：runtime=已注册；unavailable=宿主无 agentPresets 服务（仅目录写生效）。 */
    runtimeMode: 'runtime' | 'unavailable';
}
/**
 * 双路安装入口。目录写同步完成并即时留痕；运行时注册等服务就绪后完成并留痕。
 * 返回前目录写已落盘；注册部分异步收敛（fire-and-forget 调用方须 catch）。
 */
export declare function installRolePresets(ctx: PresetCtxLike, opts?: {
    registerWaitMs?: number;
}): Promise<RolePresetInstallReport>;
/** 角色 preset 挂载的容器面（dsh-agent-presets roster 的最小结构类型）。 */
export interface PresetMountLike {
    mount(ctx: unknown, id: string): Promise<unknown>;
    /** 官方重链入口（0.1.2-rc.1 起提供）：已绑定 → binding.rebind；未绑定 → bind。 */
    recompose?(ctx: unknown, id: string): Promise<unknown>;
}
/**
 * preset 挂载收敛入口（2026-09-21 事故修复）：宿主 dsh-scope 的 scope key 绑定在进程
 * 生命周期内一次性（bindScopeParent 重复调用抛 "already bound to a parent"），官方重链
 * 入口是 recompose（已绑 → binding.rebind）。同 agentKey 的二次 setup（P/W/D 卡 blocked/
 * unblock 多轮唤醒 resume 同一 session、live 复用 re-setup 补挂）此前直接二次 mount 必炸。
 * 收敛语义：mount 失败且系 already-bound → recompose 重链；其余错误（组合不可用等）原样上抛。
 */
export declare function mountOrRecompose(presets: PresetMountLike, agentCtx: unknown, presetId: string): Promise<void>;

/** 包内组合目录（随包分发）。src/roles/ 与 lib/roles/ 深度一致，均经 ../../ 回到包根。 */
export declare function packagePresetsDir(): string;
/** $DSH_HOME/.agent-presets（agent-presets 服务 includeUserRoot 派生根；DSH_HOME 缺省 ~/.dsh）。 */
export declare function userPresetsRoot(): string;
/** 安装角色裁剪 preset 到用户预设根；返回成功安装的 preset id 列表（空=无随包组合）。
 *  尽力而为：单 preset 写失败（用户预设根不可写等）仅告警不抛出，
 *  后续 agentPresets.mount('kanban-<role>') 失败由 runner 降级日志兜底。 */
export declare function installRolePresets(): string[];
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

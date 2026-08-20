/** 包内组合目录（随包分发）。src/roles/ 与 lib/roles/ 深度一致，均经 ../../ 回到包根。 */
export declare function packagePresetsDir(): string;
/** $DSH_HOME/.agent-presets（agent-presets 服务 includeUserRoot 派生根；DSH_HOME 缺省 ~/.dsh）。 */
export declare function userPresetsRoot(): string;
/** 安装角色裁剪 preset 到用户预设根；返回成功安装的 preset id 列表（空=无随包组合）。
 *  尽力而为：单 preset 写失败（用户预设根不可写等）仅告警不抛出，
 *  后续 agentPresets.mount('kanban-<role>') 失败由 runner 降级日志兜底。 */
export declare function installRolePresets(): string[];

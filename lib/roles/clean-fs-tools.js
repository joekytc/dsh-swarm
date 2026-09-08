// src/roles/clean-fs-tools.ts
// danger-full-access 会话（P、D(execute)）的 write/edit/bash 工具菜单去毒。
//
// 为什么：宿主 dsh-tool-fs / dsh-tool-bash 在组合层把可选参数 sandbox_permissions / justification
// 合入 write/edit/bash schema（dsh-tool-fs lib/index.js:617/771 schemaFields()、dsh-tool-bash
// lib/index.js:285-289；广播与否只看组合默认沙箱模式 :1111，会话层 sandbox/mode 改不掉）。
// 在 danger-full-access（权限天花板）会话里，escalation「必须严格更宽」无更宽可升——任何值
// 都被 approveEscalation 拒绝，模型却仍从菜单看到这两个按钮，触发拒绝-重试循环
// （2026-09-02 P 会话 30 连败事故根因）。plan-guard 的带参拦截保留为兜底网（toolsets.ts 不动），
// 本文件是根治面：agent scope shadow 注册「无带毒参数的干净版」盖住宿主版本 + execute 剥参转发。
//
// 宿主探明结论：
// - 遮蔽语义（dsh-tools lib/index.js view/get + dsh-scope ScopedLayers）：scope 自身层注册在
//   inherited（global + preset standing 祖先层）之后覆盖 visible map → agent scope 同名注册
//   真实盖住宿主版本；「重复注册 fail」仅指同一层内（NamedEntries.insert），跨层 shadow 合法。
//   agentPresets.mount 是 bindScopeParent（agent scope 挂为 preset standing scope 的 child），
//   preset 里 tool-fs/tool-bash 的注册落在 standing 祖先层而非 agent own 层 → 本模块经
//   agentCtx.tools.register 落 own 层，无同层冲突（kanban_comment 遮蔽已实证该通道）。
// - 转发通道：agentCtx.tools.get(name, agent) 返回该 scope 可见定义（shadow 注册前即宿主原定义，
//   kanban-p/d 的 fs/bash 在 preset standing 祖先层，全局视角 get(name) 反而可能取不到）；
//   直接调用 hostDef.execute(cleanArgs, exec) 与注册表 dispatchToolBody 的调用形态逐字一致
//   （lib/index.js:3174 tool.execute(exec.arguments, exec)）。绕开 approval/escalation 前置管线
//   安全：resolvePolicy 在两参皆缺时走 standingPolicy 路径（dsh-sandbox validateEscalationArgs
//   对 (undefined, undefined) 放行）——即官方默认行为，escalation 管线本就不触发。
// - guard 管线在 dispatch 前运行且 deny-only（registry pre-execute → guardReason → dispatch），
//   转发是对宿主 execute 的普通函数调用，不存在 guard 二次绕过问题。
// - justification 仅为 escalation 配套参数（dsh-sandbox：「justification is only valid together
//   with sandbox_permissions」），与两参一并剥离 = 官方 standing 行为，无害。
/** 需剥离的带毒参数（dsh-sandbox escalation 配对参数；写死避免依赖宿主内部导出）。 */
export const ESCALATION_PARAM_KEYS = ['sandbox_permissions', 'justification'];
/** 需去毒的宿主工具名单：write/edit（dsh-tool-fs）+ bash（dsh-tool-bash，schema 同样带毒）。 */
const CLEAN_FS_TOOL_NAMES = ['write', 'edit', 'bash'];
/** 本模块 shadow 的品牌标记（幂等判定：setup 重入/live 修复重跑 setup 时识别已挂 shadow）。
 *  Symbol.for 跨模块实例一致；对象展开会复制自有可枚举 symbol 属性，标记随干净版定义存活。 */
const CLEAN_FS_BRAND = Symbol.for('dsh-swarm.clean-fs-shadow');
/** 从 agentCtx 解出工具注册表（缺 service = 测试桩/异常宿主 → undefined）。 */
function toolsRuntimeOf(agentCtx) {
    const tools = agentCtx.tools;
    if (!tools || typeof tools.get !== 'function' || typeof tools.register !== 'function')
        return undefined;
    return tools;
}
/** 剥离 escalation 参数：净化后新对象返回；本就干净则原对象透传（零拷贝零改写）。 */
export function stripEscalationArgs(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args))
        return args;
    const a = args;
    const poisoned = ESCALATION_PARAM_KEYS.some((k) => a[k] !== undefined);
    if (!poisoned)
        return args;
    const { sandbox_permissions: _sp, justification: _j, ...rest } = a;
    return rest;
}
/**
 * 给 danger-full-access 会话 shadow 注册去毒版 write/edit/bash。
 *
 * 行为契约：
 * - 干净版 = 宿主定义浅拷贝 + parameters 去掉两带毒字段（JSON 深拷贝后删除，注册表保证 lossless JSON）
 *   + execute 换成「剥参 → 转发宿主原工具 execute」。写逻辑零自实现，行为 100% 官方。
 * - 宿主 schema 本就无带毒参数（无沙箱后端的组合，escalationModes 为空）→ 无需 shadow，跳过
 *   （最小触碰面：不去盖一个本来就干净的版本）。
 * - 转发失败面（宿主定义不可达 / 缺 execute / 同层注册冲突）→ 该工具不挂 + console.error 显形，
 *   宿主带毒版本保持可见（fail-safe：绝不注册一个自实现写文件的半成品）。
 * - 幂等：setup 重入（live 会话修复路径 resumeOrReuse 会重跑 setup）先以品牌标记识别已挂
 *   shadow → 跳过；同层冲突抛错也被捕获显形，不炸 setup（宿主版本继续可见，plan-guard 兜底网仍在）。
 *
 * @param agentCtx agent setup 收到的 scoped ctx（agentCtx.tools 即该 scope 的注册表）
 * @param agent Agent 实例（= dsh-tools scope key，exec.agent 同源；get 的 scope 视角参数）
 */
export function installCleanFsTools(agentCtx, agent) {
    const tools = toolsRuntimeOf(agentCtx);
    if (!tools)
        return; // 无工具服务（测试桩）跳过；宿主版本自然保持可见
    for (const name of CLEAN_FS_TOOL_NAMES) {
        try {
            // shadow 注册前取样：get(name, agent) 走该 agent scope 视角——own 层尚无同名时返回
            // inherited（global + preset standing 祖先层）里的宿主原定义
            const visible = tools.get(name, agent);
            if (!visible || typeof visible !== 'object' || !visible.parameters || typeof visible.execute !== 'function') {
                console.error('[dsh-swarm][clean-fs] host "' + name + '" not reachable via agent-scope registry — shadow skipped, host version stays visible');
                continue;
            }
            if (visible[CLEAN_FS_BRAND])
                continue; // 幂等：上次 setup 已挂 shadow
            const props = visible.parameters.properties;
            const poisoned = !!props && ESCALATION_PARAM_KEYS.some((k) => props[k] !== undefined);
            if (!poisoned)
                continue; // 宿主 schema 本就干净（无沙箱组合）→ 无需 shadow
            // parameters 深拷贝去毒（注册表已保证 lossless JSON，JSON 往返安全）；
            // 宿主编译态无 additionalProperties:false（parameterSchemaSpecToJsonSchema 开根），
            // 模型惯性硬塞的带毒参数由 execute 剥参兜住，不会在宿主 execute 的 args 校验处炸出。
            const parameters = JSON.parse(JSON.stringify(visible.parameters));
            if (parameters['properties'] && typeof parameters['properties'] === 'object') {
                for (const key of ESCALATION_PARAM_KEYS)
                    delete parameters['properties'][key];
            }
            // 防御：宿主未来若把两参数标成必填，required 一并过滤（当前为可选，此过滤为空操作）
            if (Array.isArray(parameters['required'])) {
                parameters['required'] = parameters['required'].filter((k) => !ESCALATION_PARAM_KEYS.includes(k));
            }
            tools.register({
                ...visible,
                parameters,
                [CLEAN_FS_BRAND]: true,
                // 剥参后转发宿主原 execute：调用形态与注册表 dispatchToolBody 逐字一致（args, exec）。
                // 禁止在此自实现任何写逻辑——行为漂移风险，宿主升级即失效。
                execute(args, exec) {
                    return visible.execute(stripEscalationArgs(args), exec);
                },
            });
        }
        catch (err) {
            // fail-safe：单工具失败只降级该工具（宿主版本保持可见），不阻断其余工具与 setup
            console.error('[dsh-swarm][clean-fs] shadow register failed for "' + name + '" — host version stays visible: ' + String(err));
        }
    }
}

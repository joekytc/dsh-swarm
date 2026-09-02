import type { Context } from '@deepseek-ai/cordis';
/** 需剥离的带毒参数（dsh-sandbox escalation 配对参数；写死避免依赖宿主内部导出）。 */
export declare const ESCALATION_PARAM_KEYS: readonly ["sandbox_permissions", "justification"];
/** 剥离 escalation 参数：净化后新对象返回；本就干净则原对象透传（零拷贝零改写）。 */
export declare function stripEscalationArgs(args: unknown): unknown;
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
export declare function installCleanFsTools(agentCtx: Context, agent: unknown): void;

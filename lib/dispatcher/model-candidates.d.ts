import type { KanbanConfig } from '../config.js';
import type { Role } from '../domain/types.js';
import type { AgentModelOptions } from './dispatcher.js';
/**
 * 模型候选链（四层）：
 * ① 角色 primary（config.roles.models[role]）→ ② 降级候选（fallbacks，顺序=优先序，≤2）
 * → ③ 全局官方兜底（config.roles.chainFallback，恒垫链尾）→ ④ 宿主默认模型（defaultModel）。
 * 角色链全空 → 官方兜底单候选直用；官方兜底也未配 → 宿主默认模型；都无 → 空链（调用方不传 agentOptions）。
 * reasoningEffort 未指定一律 'high'。
 *
 * @returns 有序候选链（不含不可用者；可能为空 = 无任何配置）
 */
export declare function buildModelCandidates(config: KanbanConfig, role: Role, defaultModel?: AgentModelOptions): AgentModelOptions[];
/**
 * 判定 create/resume 错误是否属于候选不可用（可静默切换下一候选）。
 * 覆盖三类：provider/model 不可用（无适配器/不存在）、凭据缺失（官方账号未登录
 * MISSING_CREDENTIAL / 登录提示——不切换会把登录态问题误判成任务失败）。
 */
export declare function isModelUnavailableError(err: unknown): boolean;

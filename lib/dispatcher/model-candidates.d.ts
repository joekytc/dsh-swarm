import type { KanbanConfig } from '../config.js';
import type { Role } from '../domain/types.js';
import type { AgentModelOptions } from './dispatcher.js';
/**
 * 模型候选链（交付质量链 Task 12）：角色创建时主模型 → fallbacks 依次静默切换。
 * primary = config.roles.models[role]；未配置回退 defaultModel。
 * reasoningEffort 未指定一律 'high'。
 *
 * @returns 有序候选链（不含不可用者；可能为空 = 无任何配置）
 */
export declare function buildModelCandidates(config: KanbanConfig, role: Role, defaultModel?: AgentModelOptions): AgentModelOptions[];
/** 判定 create/resume 错误是否属于 model/provider 不可用（可静默切换下一候选）。 */
export declare function isModelUnavailableError(err: unknown): boolean;

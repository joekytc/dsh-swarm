// src/dispatcher/model-candidates.ts
import type { KanbanConfig } from '../config.js';
import type { Role } from '../domain/types.js';
import type { AgentModelOptions } from './dispatcher.js';

/** 单角色降级候选上限（与 config schema .max(2)、config-override 校验同口径）。 */
const MAX_FALLBACKS = 2;

/**
 * 模型候选链（四层）：
 * ① 角色 primary（config.roles.models[role]）→ ② 降级候选（fallbacks，顺序=优先序，≤2）
 * → ③ 全局官方兜底（config.roles.chainFallback，恒垫链尾）→ ④ 宿主默认模型（defaultModel）。
 * 角色链全空 → 官方兜底单候选直用；官方兜底也未配 → 宿主默认模型；都无 → 空链（调用方不传 agentOptions）。
 * reasoningEffort 未指定一律 'high'。
 *
 * @returns 有序候选链（不含不可用者；可能为空 = 无任何配置）
 */
export function buildModelCandidates(
  config: KanbanConfig,
  role: Role,
  defaultModel?: AgentModelOptions,
): AgentModelOptions[] {
  const m = config.roles?.models?.[role];
  const cf = config.roles?.chainFallback;
  const officialTail: AgentModelOptions[] = [];
  if (cf?.provider && cf?.model) {
    officialTail.push({ provider: cf.provider, model: cf.model, reasoningEffort: cf.reasoningEffort ?? 'high' });
  }
  const chain: AgentModelOptions[] = [];
  if (m?.provider && m?.model) {
    chain.push({ provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort ?? 'high' });
    for (const f of (m.fallbacks ?? []).slice(0, MAX_FALLBACKS)) {
      if (f?.provider && f?.model) chain.push({ provider: f.provider, model: f.model, reasoningEffort: f.reasoningEffort ?? 'high' });
    }
    chain.push(...officialTail);
  } else {
    // 角色链全空：官方兜底直用；未配官方兜底 → 宿主默认模型（第四层安全网）。
    if (officialTail.length) chain.push(...officialTail);
    else if (defaultModel?.provider && defaultModel?.model) {
      chain.push({ provider: defaultModel.provider, model: defaultModel.model, reasoningEffort: defaultModel.reasoningEffort ?? 'high' });
    }
  }
  return chain;
}

/**
 * 判定 create/resume 错误是否属于候选不可用（可静默切换下一候选）。
 * 覆盖三类：provider/model 不可用（无适配器/不存在）、凭据缺失（官方账号未登录
 * MISSING_CREDENTIAL / 登录提示——不切换会把登录态问题误判成任务失败）。
 */
export function isModelUnavailableError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  if (msg.includes('adapter')) return true; // no adapter registered for provider …
  if (msg.includes('missing_credential') || msg.includes('credentials') || msg.includes('login') || msg.includes('登录')) return true;
  if (msg.includes('provider') && (msg.includes('unavailable') || msg.includes('not') || msg.includes('fail'))) return true;
  return msg.includes('model') && (msg.includes('unavailable') || msg.includes('not found') || msg.includes('no adapter'));
}

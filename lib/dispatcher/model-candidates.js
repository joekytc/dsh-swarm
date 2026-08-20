/**
 * 模型候选链（交付质量链 Task 12）：角色创建时主模型 → fallbacks 依次静默切换。
 * primary = config.roles.models[role]；未配置回退 defaultModel。
 * reasoningEffort 未指定一律 'high'。
 *
 * @returns 有序候选链（不含不可用者；可能为空 = 无任何配置）
 */
export function buildModelCandidates(config, role, defaultModel) {
    const m = config.roles?.models?.[role];
    const chain = [];
    if (m?.provider && m?.model) {
        chain.push({ provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort ?? 'high' });
        for (const f of m.fallbacks ?? []) {
            if (f?.provider && f?.model)
                chain.push({ provider: f.provider, model: f.model, reasoningEffort: f.reasoningEffort ?? 'high' });
        }
    }
    else if (defaultModel?.provider && defaultModel?.model) {
        chain.push({ provider: defaultModel.provider, model: defaultModel.model, reasoningEffort: defaultModel.reasoningEffort ?? 'high' });
    }
    return chain;
}
/** 判定 create/resume 错误是否属于 model/provider 不可用（可静默切换下一候选）。 */
export function isModelUnavailableError(err) {
    const msg = String(err instanceof Error ? err.message : err).toLowerCase();
    if (msg.includes('adapter'))
        return true; // no adapter registered for provider …
    if (msg.includes('provider') && (msg.includes('unavailable') || msg.includes('not') || msg.includes('fail')))
        return true;
    return msg.includes('model') && (msg.includes('unavailable') || msg.includes('not found') || msg.includes('no adapter'));
}

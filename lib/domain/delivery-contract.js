/**
 * 上游交付契约（R20「上游对下游负责」宗旨）：每阶段任务完成交接 metadata 必须产出的键。
 * key = `${assignee}:${mode}`；仅列出「下游实际读取」的硬交付物——
 *   - w:kb（W2/W3）：kb_url + page_path = KB 同步页（下游 wiki_read 读原文 / 收尾）
 *   - p:openspec（P）：artifacts_path = openspec 实施计划产物路径（W2 读取同步 KB）；
 *     pt_decision = P 判定是否需要计划评审的硬键（v2：needed 布尔必填，needed=true 时 reason 必填）
 * d:execute 的 git 产物证据由 hasDeliveryEvidence 单独判定；pt/dt 由 validateReviewEvidence 判定，
 * 二者不重复登记。
 * 未列出的 mode（w:external 可选、align 旧兼容等）无硬交付约束。
 * v2 断代：w:file 交付键随旧 w1 预取阶段已删除。
 */
const REQUIRED_DELIVERY = {
    'w:kb': ['kb_url', 'page_path'],
    'p:openspec': ['artifacts_path', 'pt_decision'],
};
export function requiredDeliveryKeys(assignee, mode) {
    return REQUIRED_DELIVERY[`${assignee}:${mode}`] ?? [];
}
/** v2：pt_decision 结构校验（needed 布尔必填；needed=true 时 reason 必填）。返回缺失键列表。 */
export function missingPtDecisionKeys(handoff) {
    const d = (handoff?.metadata ?? {})['pt_decision'];
    if (typeof d !== 'object' || d === null)
        return ['pt_decision'];
    const o = d;
    if (typeof o['needed'] !== 'boolean')
        return ['pt_decision.needed'];
    if (o['needed'] === true && (typeof o['reason'] !== 'string' || o['reason'].trim().length === 0)) {
        return ['pt_decision.reason'];
    }
    return [];
}
/** 缺失的交付键（存在但为空的字符串/非字符串均视为缺失；pt_decision 走结构校验透传细粒度键）。 */
export function missingDeliveryKeys(assignee, mode, handoff) {
    const keys = requiredDeliveryKeys(assignee, mode);
    if (keys.length === 0)
        return [];
    if (!handoff)
        return keys.slice();
    const m = handoff.metadata ?? {};
    const missing = [];
    for (const k of keys) {
        if (k === 'pt_decision') {
            missing.push(...missingPtDecisionKeys(handoff));
        }
        else {
            const v = m[k];
            if (typeof v !== 'string' || v.trim().length === 0)
                missing.push(k);
        }
    }
    return missing;
}
export function hasRequiredDelivery(assignee, mode, handoff) {
    return missingDeliveryKeys(assignee, mode, handoff).length === 0;
}
/** 对一组父任务 id 做交付契约校验，返回缺关键交付物的父卡清单（无缺失返回空数组）。 */
export function missingParentDelivery(state, parentIds) {
    const out = [];
    for (const pid of parentIds) {
        const pt = state.tasks.get(pid);
        if (!pt)
            continue;
        const missing = missingDeliveryKeys(pt.assignee, pt.mode, state.handoffs.get(pid));
        if (missing.length > 0)
            out.push({ taskId: pid, assignee: pt.assignee, mode: pt.mode, missing });
    }
    return out;
}

/**
 * R20 D(execute) 交付物证据判定（C1/C2 共用）：
 * 完成交接 metadata 必须带 changed_files（非空）+ (commit_hash | push) 至少其一，
 * 才算具备"实际执行并产出 git 产物"的证据。无证据 → 不判链完成 / kanban_complete 拒绝。
 *
 * changed_files：string[] 或非空字符串（分支/README/代码变更清单）。
 * commit_hash：提交哈希字符串；push：布尔或描述串（已推送）。
 */
export function hasDeliveryEvidence(handoff) {
    if (!handoff)
        return false;
    const m = handoff.metadata ?? {};
    const changed = m['changed_files'];
    const changedOk = Array.isArray(changed)
        ? changed.length > 0
        : typeof changed === 'string' && changed.trim().length > 0;
    if (!changedOk)
        return false;
    const commit = m['commit_hash'];
    const commitOk = typeof commit === 'string' && commit.trim().length > 0;
    const push = m['push'];
    const pushOk = push === true || (typeof push === 'string' && push.trim().length > 0);
    return commitOk || pushOk;
}

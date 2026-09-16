/** 评审目标推导（PT/DT 共用，2026-09-15 由 v-orchestrator 内联逻辑下沉）：
 *  - currentTarget = 该评审卡实际评审的任务（复审卡经 reworkOfTaskId 指向返工卡；首评回退 parents[0] → 阶段源任务）；
 *  - root = 沿 reworkOfTaskId 链到顶（原任务），reviewStatus 落点。
 *  返回 null = 无法推导（调用方按原语义处理，如 gave-up）。
 *  编排层与恢复 service 共用同一份推导，消除双份逻辑漂移。 */
export function resolveReviewTarget(state, reviewTask, chainId) {
    const role = reviewTask.assignee === 'dt' ? 'dt' : 'pt';
    const srcAssignee = role === 'pt' ? 'p' : 'd';
    const srcMode = role === 'pt' ? 'openspec' : 'execute';
    let currentTarget = reviewTask.reworkOfTaskId
        ? state.tasks.get(reviewTask.reworkOfTaskId)
        : reviewTask.parents[0]
            ? state.tasks.get(reviewTask.parents[0])
            : undefined;
    if (!currentTarget) {
        currentTarget = [...state.tasks.values()].find((t) => t.chainId === chainId && t.assignee === srcAssignee && t.mode === srcMode && t.status === 'done');
    }
    if (!currentTarget)
        return null;
    let root = currentTarget;
    while (root.reworkOfTaskId && state.tasks.get(root.reworkOfTaskId))
        root = state.tasks.get(root.reworkOfTaskId);
    return { currentTarget, root };
}

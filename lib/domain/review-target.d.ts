import type { BoardState, Task } from './types.js';
/** 评审目标推导（PT/DT 共用，2026-09-15 由 v-orchestrator 内联逻辑下沉）：
 *  - currentTarget = 该评审卡实际评审的任务（复审卡经 reworkOfTaskId 指向返工卡；首评回退 parents[0] → 阶段源任务）；
 *  - root = 沿 reworkOfTaskId 链到顶（原任务），reviewStatus 落点。
 *  返回 null = 无法推导（调用方按原语义处理，如 gave-up）。
 *  编排层与恢复 service 共用同一份推导，消除双份逻辑漂移。 */
export declare function resolveReviewTarget(state: BoardState, reviewTask: Task, chainId: string): {
    currentTarget: Task;
    root: Task;
} | null;

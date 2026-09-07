import type { BoardState, KanbanEvent, Task } from './types.js';
/** W3 收尾判据（镜像 kanban-service.completeTask 机械规则，但不含 dEvidenceOk 与链状态要求）：
 *  完成卡为 w+kb、链上无未终态卡、它是最后完成的卡、且链上存在 done 的 D 卡（防 W2 中间态误投）。 */
export declare function isFinalW3Completion(state: BoardState, chainId: string, completedTaskId: string): boolean;
/** 成功汇报（markdown）。判据不满足（W2 中间态/非 w:kb/非收尾）返回 null。 */
export declare function buildCompletionMessage(state: BoardState, chainId: string, completedTaskId: string, now: number): string | null;
export declare function suggestionsFor(reason: string): string[];
/** 链下全部 blocked 卡（title + 最近一次 task/blocked 原因）。 */
export declare function latestBlockedTasks(events: KanbanEvent[], tasks: Iterable<Task>, chainId: string): Array<{
    id: string;
    title: string;
    reason: string;
}>;
/** 阻塞通知（markdown）。 */
export declare function buildBlockMessage(state: BoardState, chainId: string, chainReason: string, storageDir: string): string;

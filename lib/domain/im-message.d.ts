import type { BoardState, KanbanEvent, Task } from './types.js';
/** W3 收尾判据（镜像 kanban-service.completeTask 机械规则，但不含 dEvidenceOk 与链状态要求）：
 *  完成卡为 w+kb、链上无未终态卡、它是最后完成的卡、且链上存在 done 的 D 卡（防 W2 中间态误投）。 */
export declare function isFinalW3Completion(state: BoardState, chainId: string, completedTaskId: string): boolean;
/** 交付汇报结构化字段（W agent 收尾时写入 W3 交接 metadata.report；内容有出处=任务卡，渲染器只定骨架）。 */
export interface ChainReportFields {
    requirement: string;
    status: string;
    branch: string;
    /** 功能清单：openspec/changes/<id>/tasks.md 勾选态逐条映射（done=已勾）。 */
    tasks: Array<{
        text: string;
        done: boolean;
    }>;
    acceptance: string;
    verification: string;
    leftovers: string[];
    todos: string[];
}
/** 校验并归一 metadata.report：任一必需字段缺失/形状不符 → null（渲染回退机械格式，绝不渲染半残骨架）。 */
export declare function parseChainReport(raw: unknown): ChainReportFields | null;
/** 成功汇报（markdown）。判据不满足（W2 中间态/非 w:kb/非收尾）返回 null。
 *  W3 交接带合法 metadata.report → 交付汇报骨架；否则回退机械格式（旧链兼容）。 */
export declare function buildCompletionMessage(state: BoardState, chainId: string, completedTaskId: string, now: number): string | null;
export declare function suggestionsFor(reason: string): string[];
/** 链下全部 blocked 卡（title + 最近一次 task/blocked 原因）。 */
export declare function latestBlockedTasks(events: KanbanEvent[], tasks: Iterable<Task>, chainId: string): Array<{
    id: string;
    title: string;
    reason: string;
}>;
/** 阻塞通知（markdown）。阻塞是系统性事件（看门狗/stall/人工），时刻 LLM 大多不在环：
 *  保持机械渲染（事实 + 静态建议，防编造），仅做视觉对齐（标题/链 id/已完成进度）。 */
export declare function buildBlockMessage(state: BoardState, chainId: string, chainReason: string, storageDir: string): string;

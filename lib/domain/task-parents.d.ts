import type { Role, Task, TaskMode } from './types.js';
/**
 * 解析某角色任务的语义父任务 id（终态 done/archived）。供 createTask 兜底与 V 建卡指令共用，
 * 消除「V 建卡漏设 parents → 父交接注入断裂」的软约定风险（P 依赖父交接注入 W1-pre 事实）。
 * w:kb 特判：链上 d/execute 已交付 → w3（父=D）；否则 w2（父=P）。
 */
export declare function resolveTaskParents(tasks: Iterable<Task>, chainId: string, assignee: Role, mode: TaskMode): string[];

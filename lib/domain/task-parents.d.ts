import type { Role, Task, TaskMode } from './types.js';
/**
 * 语义父依赖角色（不含状态判定）：返回当前阶段任务"本该依赖"的上游 (assignee, mode)。
 * 供 resolveTaskParents（取终态 id）与 createTask 硬拦（查非终态）共用，保证依赖推导单一来源。
 * w:kb 特判：链上 d/execute 已交付 → 父=D（w3）；否则父=P（w2）。
 */
export declare function semanticParentDeps(tasks: Iterable<Task>, chainId: string, assignee: Role, mode: TaskMode): Array<{
    assignee: Role;
    mode: TaskMode;
}>;
/** 语义上游中存在但非终态（非 done/archived）的父任务清单——createTask 硬拦依据。 */
export declare function nonTerminalSemanticParents(tasks: Iterable<Task>, chainId: string, assignee: Role, mode: TaskMode): Task[];
/**
 * 解析某角色任务的语义父任务 id（终态 done/archived）。供 createTask 兜底与 V 建卡指令共用，
 * 消除「V 建卡漏设 parents → 父交接注入断裂」的软约定风险（P 直接读规格卡，无 w1 预取父卡）。
 */
export declare function resolveTaskParents(tasks: Iterable<Task>, chainId: string, assignee: Role, mode: TaskMode): string[];

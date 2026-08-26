// src/domain/task-parents.ts
import type { Role, Task, TaskMode } from './types.js';

/**
 * 每阶段任务卡的语义输入来源（R20 依赖)：第 1 项为主来源。
 * key = `${assignee}:${mode}`；w:kb 特判（w2→P、w3→D）见 semanticParentDeps。
 * 未列出的 mode（如旧兼容 align）不设语义 parents（返回空）。
 */
const PARENT_DEPS: Record<string, Array<{ assignee: Role; mode: TaskMode }>> = {
  'p:openspec': [], // v2：P 读规格卡（需求澄清清单附件）+ 父任务交接，无 w1 预取父卡
  'pt:review-plan': [{ assignee: 'p', mode: 'openspec' }], // PT 评审 P 计划
  'd:execute': [{ assignee: 'w', mode: 'kb' }], // D 接 W2（P 计划同步 KB 后的 page_path/kb_url，wiki_read 读实施计划执行）
  'dt:review-impl': [{ assignee: 'd', mode: 'execute' }], // DT 评审 D 交付
};

/**
 * 语义父依赖角色（不含状态判定）：返回当前阶段任务"本该依赖"的上游 (assignee, mode)。
 * 供 resolveTaskParents（取终态 id）与 createTask 硬拦（查非终态）共用，保证依赖推导单一来源。
 * w:kb 特判：链上 d/execute 已交付 → 父=D（w3）；否则父=P（w2）。
 */
export function semanticParentDeps(
  tasks: Iterable<Task>,
  chainId: string,
  assignee: Role,
  mode: TaskMode,
): Array<{ assignee: Role; mode: TaskMode }> {
  if (assignee === 'w' && mode === 'kb') {
    const dDone = [...tasks].some(
      (t) => t.chainId === chainId && t.assignee === 'd' && t.mode === 'execute' &&
        (t.status === 'done' || t.status === 'archived'),
    );
    return dDone ? [{ assignee: 'd', mode: 'execute' }] : [{ assignee: 'p', mode: 'openspec' }];
  }
  return PARENT_DEPS[`${assignee}:${mode}`] ?? [];
}

/** 语义上游中存在但非终态（非 done/archived）的父任务清单——createTask 硬拦依据。 */
export function nonTerminalSemanticParents(
  tasks: Iterable<Task>,
  chainId: string,
  assignee: Role,
  mode: TaskMode,
): Task[] {
  const chainTasks = [...tasks].filter((t) => t.chainId === chainId);
  const terminal: ReadonlyArray<string> = ['done', 'archived'];
  return semanticParentDeps(chainTasks, chainId, assignee, mode).flatMap((d) =>
    chainTasks.filter(
      (t) => t.assignee === d.assignee && t.mode === d.mode && !terminal.includes(t.status),
    ),
  );
}

/**
 * 解析某角色任务的语义父任务 id（终态 done/archived）。供 createTask 兜底与 V 建卡指令共用，
 * 消除「V 建卡漏设 parents → 父交接注入断裂」的软约定风险（P 直接读规格卡，无 w1 预取父卡）。
 */
export function resolveTaskParents(
  tasks: Iterable<Task>,
  chainId: string,
  assignee: Role,
  mode: TaskMode,
): string[] {
  const chainTasks = [...tasks].filter((t) => t.chainId === chainId);
  const ids = (a: Role, m: TaskMode) =>
    chainTasks.filter(
      (t) => t.assignee === a && t.mode === m && (t.status === 'done' || t.status === 'archived'),
    ).map((t) => t.id);
  return semanticParentDeps(chainTasks, chainId, assignee, mode).flatMap((d) => ids(d.assignee, d.mode));
}

import type { BoardState, Task } from '../domain/types.js';
/**
 * R20 D(execute) 目标仓库路径解析（B2/B3 共用）：
 * 1. 任务 body 的 TARGET_REPO=<path> 标记（V 生成 D 任务体时写入，见 v-orchestrator D 阶段指令）；
 * 2. 规格卡 file-prefetch 附件 ref（W1-pre 预取的仓库路径）；
 * 3. 回退默认目录（kanban 存储 / 会话工作区）。
 *
 * 解析为绝对路径并校验存在性；候选不存在时继续降级，全部失败回退默认目录——
 * 保证给 agents.create 的 meta.cwd 恒为绝对路径（会话校验要求 isAbsolute）。
 * 存在性校验同时兜底沙箱根：workspace-write 以会话 cwd 为写边界，指向不存在的
 * 目录会导致所有写被拒，故不存在时回退而非保留。
 */
/** 判断 child 是否位于 parent 目录内（含等于）。用于 D 目标仓库是否在会话工作空间内的判定（B 前置授权）。 */
export declare function isPathInside(child: string, parent: string): boolean;
export declare function resolveTargetRepoDir(task: Task, state: BoardState, fallback: string, allowFallback?: boolean): string;

import type { KanbanService } from '../domain/kanban-service.js';
import type { BoardState, Task } from '../domain/types.js';
/** 合入输入：repoDir=目标仓库绝对路径；targetBranch=规格卡声明分支；featureBranch=D 交接 metadata.branch。 */
export interface MergeInput {
    repoDir: string;
    targetBranch: string;
    featureBranch: string;
}
export declare const MERGE_DONE_PREFIX = "[merge-done]";
export declare const MERGE_SKIP_PREFIX = "[merge-skip]";
export declare const MERGE_FAILED_PREFIX = "[merge-failed]";
export interface GitRun {
    (args: string[], cwd: string): string;
}
/** 真实 git 执行器：execFileSync 同步执行，非零退出抛错（与 git-credentials.ts 同模式）。 */
export declare function realGitRun(args: string[], cwd: string): string;
/** 从 D(execute) 终态卡解析合入输入。任一要素缺失（repo 不存在 / TARGET_BRANCH 标记 / branch metadata）→ null（软跳过）。 */
export declare function resolveMergeInput(dTask: Task, state: BoardState, fallbackRepo: string): MergeInput | null;
/** 幂等判定：已存在 [merge-done] 评论，或 feature 分支已是 target 祖先（git merge-base --is-ancestor exit 0）。 */
export declare function isAlreadyMerged(state: BoardState, dTaskId: string, repoDir: string, targetBranch: string, featureBranch: string, git: GitRun): boolean;
/**
 * 执行合入（DT 通过后由 system 调用）：checkout target → merge --no-ff feature → push。
 * 返回 'merged' | 'failed' | 'skipped'。失败不抛：记录 [merge-failed] 评论，链仍可收尾
 * （坏代码未被合入 = 方向安全；人工可事后修复）。
 */
export declare function runMergeGate(kanban: KanbanService, state: BoardState, dTask: Task, input: MergeInput, git?: GitRun): Promise<'merged' | 'failed' | 'skipped'>;
/** 链完成钩子入口（dispatcher setOnChainCompleted 调用）：DT 通过后合入。解析失败软跳过。 */
export declare function mergeDAfterReview(kanban: KanbanService, chainId: string, fallbackRepo: string): Promise<'merged' | 'failed' | 'skipped'>;

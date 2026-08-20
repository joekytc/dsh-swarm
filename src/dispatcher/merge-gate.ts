// src/dispatcher/merge-gate.ts
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KanbanService } from '../domain/kanban-service.js';
import type { BoardState, Task } from '../domain/types.js';
import { resolveTargetRepoDir } from './target-repo.js';

/** 合入输入：repoDir=目标仓库绝对路径；targetBranch=规格卡声明分支；featureBranch=D 交接 metadata.branch。 */
export interface MergeInput {
  repoDir: string;
  targetBranch: string;
  featureBranch: string;
}

export const MERGE_DONE_PREFIX = '[merge-done]';
export const MERGE_SKIP_PREFIX = '[merge-skip]';
export const MERGE_FAILED_PREFIX = '[merge-failed]';

export interface GitRun { (args: string[], cwd: string): string }

/** 真实 git 执行器：execFileSync 同步执行，非零退出抛错（与 git-credentials.ts 同模式）。 */
export function realGitRun(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** 从 D(execute) 终态卡解析合入输入。任一要素缺失（repo 不存在 / TARGET_BRANCH 标记 / branch metadata）→ null（软跳过）。 */
export function resolveMergeInput(dTask: Task, state: BoardState, fallbackRepo: string): MergeInput | null {
  const repoDir = resolveTargetRepoDir(dTask, state, fallbackRepo);
  if (!repoDir || !existsSync(resolve(repoDir))) return null;
  const targetBranch = dTask.body?.match(/TARGET_BRANCH\s*=\s*(\S+)/)?.[1];
  const featureBranch = String(state.handoffs.get(dTask.id)?.metadata?.['branch'] ?? '').trim();
  if (!targetBranch || !featureBranch) return null;
  return { repoDir, targetBranch, featureBranch };
}

/** 幂等判定：已存在 [merge-done] 评论，或 feature 分支已是 target 祖先（git merge-base --is-ancestor exit 0）。 */
export function isAlreadyMerged(
  state: BoardState,
  dTaskId: string,
  repoDir: string,
  targetBranch: string,
  featureBranch: string,
  git: GitRun,
): boolean {
  const doneComment = state.events.some((e) =>
    e.taskId === dTaskId && e.kind === 'task/commented' &&
    String(e.payload['body'] ?? '').startsWith(MERGE_DONE_PREFIX));
  if (doneComment) return true;
  try { git(['merge-base', '--is-ancestor', featureBranch, targetBranch], repoDir); return true; } catch { return false; }
}

/**
 * 执行合入（DT 通过后由 system 调用）：checkout target → merge --no-ff feature → push。
 * 返回 'merged' | 'failed' | 'skipped'。失败不抛：记录 [merge-failed] 评论，链仍可收尾
 * （坏代码未被合入 = 方向安全；人工可事后修复）。
 */
export async function runMergeGate(
  kanban: KanbanService,
  state: BoardState,
  dTask: Task,
  input: MergeInput,
  git: GitRun = realGitRun,
): Promise<'merged' | 'failed' | 'skipped'> {
  const { repoDir, targetBranch, featureBranch } = input;
  if (isAlreadyMerged(state, dTask.id, repoDir, targetBranch, featureBranch, git)) return 'skipped';
  try {
    git(['checkout', targetBranch], repoDir);
    git(['merge', '--no-ff', featureBranch, '-m', `[AI-GEN] merge ${featureBranch} into ${targetBranch} after DT pass`], repoDir);
    git(['push'], repoDir);
    const hash = git(['rev-parse', 'HEAD'], repoDir);
    await kanban.comment(dTask.id, `${MERGE_DONE_PREFIX} merged ${featureBranch} → ${targetBranch} hash=${hash}`, 'system');
    return 'merged';
  } catch (err) {
    await kanban.comment(dTask.id, `${MERGE_FAILED_PREFIX} merge ${featureBranch} → ${targetBranch} failed: ${String(err)}`, 'system');
    return 'failed';
  }
}

/** 链完成钩子入口（dispatcher setOnChainCompleted 调用）：DT 通过后合入。解析失败软跳过。 */
export async function mergeDAfterReview(
  kanban: KanbanService,
  chainId: string,
  fallbackRepo: string,
): Promise<'merged' | 'failed' | 'skipped'> {
  const state = await kanban.snapshot();
  const dTask = [...state.tasks.values()].find((t) =>
    t.chainId === chainId && t.assignee === 'd' && t.mode === 'execute' && t.status === 'done');
  if (!dTask) return 'skipped';
  const input = resolveMergeInput(dTask, state, fallbackRepo);
  if (!input) {
    await kanban.comment(dTask.id, `${MERGE_SKIP_PREFIX} 无法解析合入输入（缺 branch metadata / TARGET_BRANCH 标记 / repo 不存在），跳过自动合入`, 'system');
    return 'skipped';
  }
  return runMergeGate(kanban, state, dTask, input);
}

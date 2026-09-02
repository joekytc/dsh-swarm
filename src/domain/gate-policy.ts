// src/domain/gate-policy.ts
/** kanban_complete 实测闸派生（纯函数，零 IO）：
 * 声明来源单层——tdd.test_files 自动派生 npx --no-install vitest run（runner=vitest 为 review-evidence 既有口径）。
 * cwd 一律 metadata.worktree_dir，缺失即 skip（旧卡向后兼容零感知）。
 * test_files 必须相对路径且规范化后无 .. 段（防绝对路径跑主仓库/越界逃逸——跑错代码即闸被绕过），违规整单 skip。
 * branchMatches 供装配层在 git 查询后做分支一致性比对（current=null 视为不匹配，调用方 skip）。 */
import { isAbsolute } from 'node:path';

export interface GateCommand { command: string; cwd: string; source: 'tdd' }
export interface GatePlan { commands: GateCommand[]; skipped: false }
export interface GateSkip { commands: []; skipped: true; reason: string }

export function isGatePlan(x: GatePlan | GateSkip): x is GatePlan {
  return x.skipped === false;
}

export function branchMatches(current: string | null, declared: unknown): boolean {
  return typeof declared === 'string' && declared.trim().length > 0 && current === declared;
}

interface TddDecl { test_files?: unknown; skipped?: unknown }

/** 相对路径 + 不得含 .. 段（含 a/../b 形式，一并拒绝，从简从严）。
 * 另限字符 allowlist [A-Za-z0-9._/-]：test_files 会被拼入 `bash -c` 执行（见 gate-runner），
 * 白名单一并拒绝空白与 ; | & $ ` () 等元字符——既防 shell 注入（如 'x || true' 拼成
 * `vitest run x || true`，未跑闸却 exit 0 通过），也防借空白等变体绕 runner 黑名单子串匹配
 * （如 'a;git  push' 双空格躲过 includes('git push')）。 */
const isSafeRelativeTestFile = (f: string): boolean =>
  /^[A-Za-z0-9._/-]+$/.test(f) && !isAbsolute(f) && !f.split(/[/\\]/).includes('..')
  && !f.startsWith('-'); // 拒绝以 - 开头的条目：防 vitest CLI 旗标注入（如 --passWithNoTests 使 0 tests matched 也 exit 0，空跑绕闸）

export function deriveGatePlan(input: {
  assignee: string; mode: string;
  handoff: { metadata?: Record<string, unknown> };
  config: { enabled: boolean };
}): GatePlan | GateSkip {
  const m = input.handoff.metadata ?? {};
  if (!input.config.enabled) return { commands: [], skipped: true, reason: 'gates disabled' };
  if (!(input.assignee === 'd' && input.mode === 'execute'))
    return { commands: [], skipped: true, reason: 'not d/execute' };
  const wt = m['worktree_dir'];
  if (typeof wt !== 'string' || !wt.trim())
    return { commands: [], skipped: true, reason: 'worktree_dir missing (legacy card)' };
  const tdd = m['tdd'] as TddDecl | undefined;
  if (tdd?.skipped) return { commands: [], skipped: true, reason: 'tdd skipped by declaration' };
  if (!Array.isArray(tdd?.test_files) || tdd.test_files.length === 0)
    return { commands: [], skipped: true, reason: 'no gate commands' };
  const files = tdd.test_files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
  if (files.length === 0) return { commands: [], skipped: true, reason: 'no gate commands' };
  if (!files.every(isSafeRelativeTestFile))
    return { commands: [], skipped: true, reason: 'invalid test_files path (relative in-worktree required)' };
  return {
    commands: [{ command: `npx --no-install vitest run ${files.join(' ')}`, cwd: wt, source: 'tdd' }],
    skipped: false,
  };
}

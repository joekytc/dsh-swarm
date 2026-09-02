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

/** 相对路径 + 不得含 .. 段（含 a/../b 形式，一并拒绝，从简从严）。 */
const isSafeRelativeTestFile = (f: string): boolean =>
  !isAbsolute(f) && !f.split(/[/\\]/).includes('..');

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

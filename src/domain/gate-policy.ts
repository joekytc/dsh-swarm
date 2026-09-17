// src/domain/gate-policy.ts
/** kanban_complete 实测闸派生（纯函数，零 IO）。
 * 2026-09-16 PR1 互证升级：声明与实际必须互证（GateOutcome 四态）——
 *  - run：真跑（派生 npx --no-install vitest run，runner=vitest 为 review-evidence 既有口径）
 *  - bounce：闸失败打回（同会话 throw 修复重交；3 次上限见 kanban-service MAX_GATE_BOUNCES）
 *  - alarm-skip：警报放行（task/gate-skipped 留痕后照常 completed）
 *  - silent-skip：不适用（旧 null 语义逐字节兼容：gates disabled / 非 d-execute / 旧卡无 worktree）
 * diffFiles 由装配层以 `git diff --name-only <TARGET_BRANCH>...HEAD` 取得；null=不可得 → 保守放行（fail-visible 不 fail-closed）。 */
import { isAbsolute } from 'node:path';
import { isTestFile } from './tdd-classify.js';

export interface GateCommand { command: string; cwd: string; source: 'tdd' }

export type GateOutcome =
  | { kind: 'run'; commands: GateCommand[] }
  | { kind: 'bounce'; reason: string }
  | { kind: 'alarm-skip'; reason: string }
  | { kind: 'silent-skip'; reason: string };

export type SkippedVerdict =
  | { action: 'allow-alarm'; reason: string }
  | { action: 'bounce'; reason: string }
  | { action: 'proceed' };

/** 文档/配置扩展白名单——对齐 D 卡 body 既有口径「纯文档/配置变更则带 tdd={skipped:{reason}}」（v-orchestrator d 模板）。 */
const DOC_CONFIG_EXT: ReadonlySet<string> = new Set(['md', 'txt', 'json', 'yml', 'yaml', 'toml']);

function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

function isDocOrConfig(path: string): boolean {
  return DOC_CONFIG_EXT.has(extOf(path));
}

/** ④ tdd.skipped 声明互证：diff 实况三分支（改声明 / tdd 先行 / 放行留痕）。
 * 返回类型排除 proceed（proceed 仅为 test_files 对称核验的"放行"语义）。 */
export function classifySkippedDeclaration(diffFiles: string[] | null): Exclude<SkippedVerdict, { action: 'proceed' }> {
  if (diffFiles === null) return { action: 'allow-alarm', reason: 'tdd skipped by declaration (diff unavailable, 保守放行)' };
  if (diffFiles.some(isTestFile)) {
    return { action: 'bounce', reason: '声明 tdd.skipped 但本次变更包含测试文件：请改声明 tdd.test_files（闸门将实测）' };
  }
  const hasCodeChange = diffFiles.some((f) => !isTestFile(f) && !isDocOrConfig(f));
  if (hasCodeChange) {
    return { action: 'bounce', reason: 'tdd 先行：本次变更含代码文件，必须声明 tdd.test_files（纯文档/配置变更才允许 skipped）' };
  }
  return { action: 'allow-alarm', reason: 'tdd skipped by declaration: pure docs/config change' };
}

/** 对称核验：声明 tdd.test_files 但 diff 零测试变更（拿旧测试交差）→ bounce。 */
export function classifyTestFilesDeclaration(diffFiles: string[] | null): SkippedVerdict {
  if (diffFiles === null) return { action: 'proceed' };
  if (diffFiles.some(isTestFile)) return { action: 'proceed' };
  return { action: 'bounce', reason: 'tdd 先行：本次变更未包含测试文件（新增或修改测试文件后重交）' };
}

/** 从 D 卡 body 解析 diff base（body 模板声明 `TARGET_BRANCH=<目标分支名>`，v-orchestrator d:76）。
 * 与 test_files 同款防线：拒 git 旗标注入（`--output=/x` 可写任意路径文件）与路径逃逸。 */
export function resolveDiffBase(body: string): string | null {
  const m = /TARGET_BRANCH[=:]\s*([^\s，,。；]+)/.exec(body ?? '');
  const base = m ? m[1] : null;
  return base && /^[A-Za-z0-9._/-]+$/.test(base) && !base.startsWith('-') ? base : null;
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
  /** 装配层 git diff --name-only base...HEAD 结果；undefined/null=不可得（保守）。 */
  diffFiles?: string[] | null;
}): GateOutcome {
  const m = input.handoff.metadata ?? {};
  const diff = input.diffFiles ?? null;
  if (!input.config.enabled) return { kind: 'silent-skip', reason: 'gates disabled' };
  if (!(input.assignee === 'd' && input.mode === 'execute'))
    return { kind: 'silent-skip', reason: 'not d/execute' };
  const wt = m['worktree_dir'];
  if (typeof wt !== 'string' || !wt.trim())
    return { kind: 'silent-skip', reason: 'worktree_dir missing (legacy card)' };
  const tdd = m['tdd'] as TddDecl | undefined;
  if (tdd?.skipped) {
    const v = classifySkippedDeclaration(diff);
    return v.action === 'allow-alarm' ? { kind: 'alarm-skip', reason: v.reason } : { kind: 'bounce', reason: v.reason };
  }
  if (!Array.isArray(tdd?.test_files) || tdd.test_files.length === 0)
    return { kind: 'bounce', reason: 'tdd 先行：交付代码变更必须声明 tdd.test_files（纯文档/配置变更才允许声明 skipped）' };
  const files = tdd.test_files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0);
  if (files.length === 0)
    return { kind: 'bounce', reason: 'tdd 先行：tdd.test_files 为空（纯文档/配置变更才允许声明 skipped）' };
  if (!files.every(isSafeRelativeTestFile))
    return { kind: 'bounce', reason: 'invalid test_files path (relative in-worktree required)' };
  const declared = classifyTestFilesDeclaration(diff);
  if (declared.action === 'bounce') return { kind: 'bounce', reason: declared.reason };
  return { kind: 'run', commands: [{ command: `npx --no-install vitest run ${files.join(' ')}`, cwd: wt, source: 'tdd' }] };
}

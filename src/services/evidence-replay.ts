// src/services/evidence-replay.ts
/** DT 评审证据三级核验编排（PR2）：L1 缺证标记 → L2 纸面核对（零执行）→ L3 重放（默认关，非沙箱）。
 * 非阻塞：任何结果只返回留痕数据，不改 verdict、不 throw。 */
import { readFile } from 'node:fs/promises';
import { runGateCommands, type GateRunReport, type runOne } from './gate-runner.js';
import type { GateCommand } from '../domain/gate-policy.js';
import { isAllowedCommand, paperCheck, parseIssueEvidence, type EvidenceState } from '../domain/evidence-check.js';

export interface EvidenceCheckResult { title: string; severity: string; state: EvidenceState; detail: string }

/** 沿父链找最近 execute 卡的 worktree_dir（重放 cwd=被评审代码所在处）。 */
export function resolveTargetWorktree(parents: Array<{ assignee: string; mode: string; metadata?: Record<string, unknown> }>): string | null {
  for (const p of parents) {
    if (p.assignee === 'd' && p.mode === 'execute') {
      const wt = p.metadata?.['worktree_dir'];
      if (typeof wt === 'string' && wt.trim()) return wt;
    }
  }
  return null;
}

interface ReplayCfg {
  replayEnabled: boolean;
  timeoutMs: number;
  allowPrefixes: string[];
  /** 黑名单子串预检（沿用 gates.forbidden 纵深，评审 Important：不得清空）。 */
  forbidden?: string[];
  worktreeDir: string | null;
  readFile: (p: string) => Promise<string | null>;
  run?: typeof runOne;
}

export async function checkIssueEvidence(input: { issues: unknown } & ReplayCfg): Promise<EvidenceCheckResult[]> {
  const list = Array.isArray(input.issues) ? (input.issues as unknown[]) : [];
  const forbidden = input.forbidden ?? ['rm -rf /', 'git push'];
  const out: EvidenceCheckResult[] = [];
  for (const rawIssue of list) {
    // 评审 Important：per-issue 容错——被核验者塞 null/标量元素不得让整批核验无痕消失
    if (typeof rawIssue !== 'object' || rawIssue === null) {
      out.push({ title: '(invalid issue entry)', severity: 'unknown', state: 'could-not-replay', detail: 'issues 数组含非对象元素 — needs-human 核对' });
      continue;
    }
    const issue = rawIssue as Record<string, unknown>;
    const title = String(issue['title'] ?? '(untitled)');
    const severity = String(issue['severity'] ?? 'low');
    const ev = parseIssueEvidence(issue['evidence']);
    if (!ev) {
      const serious = severity === 'critical' || severity === 'high';
      out.push(serious
        ? { title, severity, state: 'could-not-replay', detail: 'no evidence provided (critical/high) — needs-human 核对' }
        : { title, severity, state: 'not-provided', detail: 'no evidence attached' });
      continue;
    }
    // L2 纸面核对（零执行）
    let content: string | null = null;
    try { content = await input.readFile(ev.file); } catch { content = null; }
    const paper = paperCheck(content, ev.exit);
    if (paper === 'matches') { out.push({ title, severity, state: 'matches', detail: `paper check ok: ${ev.file}` }); continue; }
    // L3 重放（对不上才动用；默认关）
    if (!input.replayEnabled) {
      out.push({ title, severity, state: 'could-not-replay', detail: `paper ${paper}; replay disabled by config — needs-human` });
      continue;
    }
    if (!isAllowedCommand(ev.command, input.allowPrefixes)) {
      out.push({ title, severity, state: 'could-not-replay', detail: `command not allowlisted: ${ev.command}` });
      continue;
    }
    if (!input.worktreeDir) {
      out.push({ title, severity, state: 'could-not-replay', detail: 'no target worktree resolved' });
      continue;
    }
    const cmd: GateCommand = { command: ev.command, cwd: input.worktreeDir, source: 'tdd' };
    const report: GateRunReport = await runGateCommands([cmd], { timeoutMs: input.timeoutMs, forbidden }, input.run);
    // 评审 Important：TIMEOUT/SPAWN_FAIL/FORBIDDEN ≠ 假证据——超时/派生失败/黑名单命中落 could-not-replay，
    // 仅真实执行（含非零退出）与声明不符才判 differs（四态语义准确性）
    if (report.failure && report.failure.code !== 'NONZERO') {
      out.push({ title, severity, state: 'could-not-replay', detail: `replay ${report.failure.code}: ${report.failure.detail} — needs-human` });
      continue;
    }
    const rerun = report.results.at(-1)?.exitCode;
    out.push(rerun !== null && rerun === ev.exit
      ? { title, severity, state: 'matches', detail: `replay confirmed exit ${rerun}` }
      : { title, severity, state: 'differs', detail: `replay exit=${rerun} ≠ claimed ${ev.exit} — 假证据疑点，needs-human` });
  }
  return out;
}

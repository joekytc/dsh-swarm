// src/services/evidence-replay.ts
/** DT 评审证据三级核验编排（PR2）：L1 缺证标记 → L2 纸面核对（零执行）→ L3 重放（默认关，非沙箱）。
 * 非阻塞：任何结果只返回留痕数据，不改 verdict、不 throw。 */
import { readFile } from 'node:fs/promises';
import { runGateCommands } from './gate-runner.js';
import { isAllowedCommand, paperCheck, parseIssueEvidence } from '../domain/evidence-check.js';
/** 沿父链找最近 execute 卡的 worktree_dir（重放 cwd=被评审代码所在处）。 */
export function resolveTargetWorktree(parents) {
    for (const p of parents) {
        if (p.assignee === 'd' && p.mode === 'execute') {
            const wt = p.metadata?.['worktree_dir'];
            if (typeof wt === 'string' && wt.trim())
                return wt;
        }
    }
    return null;
}
export async function checkIssueEvidence(input) {
    const list = Array.isArray(input.issues) ? input.issues : [];
    const out = [];
    for (const issue of list) {
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
        let content = null;
        try {
            content = await input.readFile(ev.file);
        }
        catch {
            content = null;
        }
        const paper = paperCheck(content, ev.exit);
        if (paper === 'matches') {
            out.push({ title, severity, state: 'matches', detail: `paper check ok: ${ev.file}` });
            continue;
        }
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
        const cmd = { command: ev.command, cwd: input.worktreeDir, source: 'tdd' };
        const report = await runGateCommands([cmd], { timeoutMs: input.timeoutMs, forbidden: [] }, input.run);
        const rerun = report.results.at(-1)?.exitCode;
        out.push(rerun !== null && rerun === ev.exit
            ? { title, severity, state: 'matches', detail: `replay confirmed exit ${rerun}` }
            : { title, severity, state: 'differs', detail: `replay exit=${rerun} ≠ claimed ${ev.exit} — 假证据疑点，needs-human` });
    }
    return out;
}

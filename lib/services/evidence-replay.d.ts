import { type runOne } from './gate-runner.js';
import { type EvidenceState } from '../domain/evidence-check.js';
export interface EvidenceCheckResult {
    title: string;
    severity: string;
    state: EvidenceState;
    detail: string;
}
/** 沿父链找最近 execute 卡的 worktree_dir（重放 cwd=被评审代码所在处）。 */
export declare function resolveTargetWorktree(parents: Array<{
    assignee: string;
    mode: string;
    metadata?: Record<string, unknown>;
}>): string | null;
interface ReplayCfg {
    replayEnabled: boolean;
    timeoutMs: number;
    allowPrefixes: string[];
    worktreeDir: string | null;
    readFile: (p: string) => Promise<string | null>;
    run?: typeof runOne;
}
export declare function checkIssueEvidence(input: {
    issues: unknown;
} & ReplayCfg): Promise<EvidenceCheckResult[]>;
export {};

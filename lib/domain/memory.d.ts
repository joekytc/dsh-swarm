import type { BoardState } from './types.js';
export interface LearningEntry {
    title: string;
    lesson: string;
    evidence: string;
    tags: string[];
}
export declare function validateLearning(raw: unknown): string[];
export declare function formatLearningBody(entry: LearningEntry, created?: Date): string;
export interface MemoryIndexEntry {
    kind: 'learning' | 'doc';
    title: string;
    path: string;
}
export declare function buildMemoryIndexBlock(entries: MemoryIndexEntry[]): string | null;
export declare function weightedRank<T>(items: T[], scoreOf: (t: T) => number, timeOf: (t: T) => number): T[];
export declare function buildRepoSlug(workspaceDir: string): string;
export type { BoardState };
/** 机械提取四类信号（事件流/投影，禁 LLM 猜测），渲染紧凑 markdown。 */
export declare function buildLearningBrief(state: BoardState, chainId: string): string;
/** /learning: rest → 链解析：空→最近链；精确 id→命中；子串匹配→单命中或候选列表（≤3）；无→null。 */
export declare function resolveLearningChainId(state: BoardState, rest: string): {
    chainId: string;
} | {
    candidates: Array<{
        chainId: string;
        title: string;
    }>;
} | null;

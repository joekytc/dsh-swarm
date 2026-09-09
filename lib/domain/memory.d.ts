import type { BoardState } from './types.js';
export interface LearningEntry {
    title: string;
    lesson: string;
    evidence: string;
    tags: string[];
}
/** 五类有效经验类别标签（0.3.1 判据）：tags 必含其一，防「为出经验而出」的假沉淀。 */
export declare const LEARNING_CATEGORY_TAGS: readonly ["mistake", "reusable", "env-trap", "collab-contract", "efficiency"];
export declare function validateLearning(raw: unknown): string[];
/** A 类犯错教训机械信号累计（评审失败/任务阻塞/审计警告事件 + 返工卡）。brief 统计行与 save 硬闸共用同一口径。 */
export declare function countLearningSignals(state: BoardState, chainId: string): number;
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
/** 机械提取四类信号（事件流/投影，禁 LLM 猜测），渲染紧凑 markdown。
 *  头部带信号统计（判据 A 准入：累计 ≥2 次才可沉淀犯错教训，模型不用自己数）。 */
export declare function buildLearningBrief(state: BoardState, chainId: string): string;
/** /learning rest → 链解析：空→最近链；精确 id→命中；子串匹配→单命中或候选列表（≤3）；无→null。 */
export declare function resolveLearningChainId(state: BoardState, rest: string): {
    chainId: string;
} | {
    candidates: Array<{
        chainId: string;
        title: string;
    }>;
} | null;

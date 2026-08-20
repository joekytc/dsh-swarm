import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { Role, TaskMode } from '../domain/types.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { AgentModelOptions } from './dispatcher.js';
export type VPhase = 'w1-pre' | 'w1-supp' | 'p' | 'pt' | 'w2' | 'd' | 'dt' | 'w3' | 'summary';
export interface ChainOrchestration {
    chainId: string;
    phase: VPhase;
    sessionId: string | null;
    waitingOn: string | null;
}
export declare const R20_PHASE_ORDER: VPhase[];
/** 每 phase 的期望建卡（w1-supp 可跳过；pt 由 P 交付物复杂度判定触发；dt 固定）。 */
export declare const R20_PHASE_EXPECT: Record<VPhase, {
    assignee: Role;
    mode: TaskMode;
} | null>;
/** P 交付物复杂度判定输入（P 交接 metadata.review_complexity，经 schema 校验）。 */
export interface ReviewComplexity {
    hard_flags: string[];
    soft_flags: string[];
    soft_count: number;
    review_override?: 'required' | 'skip' | null;
}
/** 判定 P 交付物是否需要 PT（计划评审）卡。V 只执行建卡、不自行判断（系统确定性判定）。
 *  - review_override（用户事件）优先；
 *  - hard_flags 非空 → 需要；
 *  - soft_count（由 system 按 soft_flags 计算）≥ 2 → 需要；
 *  - review_complexity 声明了但缺必需字段（非法）→ 默认需要；
 *  - 完全未声明（legacy 链路）→ 不需要（跳过 PT，保持既有链路兼容）。 */
export declare function judgePTNeeded(meta: Record<string, unknown> | undefined): boolean;
/** M5：每阶段建卡的 body 生成指令（角色定位确定性模板，消除 V 自由发挥导致的角色漂移）。
 *  P=计划者（绝不执行）、D=唯一执行者（TARGET_REPO 必须取自规格卡 file-prefetch 附件 ref，禁止回退/猜测）、
 *  W=KB/预取（绝不执行代码）。V 把对应模板写入 kanban_create 的 body。 */
export declare const PHASE_INSTRUCTIONS: Partial<Record<VPhase, string>>;
interface AgentLike {
    followup(msg: {
        content: {
            type: string;
            text: string;
        }[];
        source: {
            kind: string;
        };
    }): void;
    whenIdle(): Promise<void>;
    session: {
        events: Array<{
            name?: string;
            arguments?: unknown;
        }>;
    };
}
export declare class VOrchestrator {
    private readonly kanban;
    private readonly agents;
    private readonly config;
    private readonly orchestrations;
    private readonly wiki;
    private readonly defaultModel;
    constructor(kanban: KanbanService, agents: {
        create(o: unknown): Promise<{
            agent: AgentLike;
        }>;
        resume(o: unknown): Promise<{
            agent: AgentLike;
        }>;
    }, config: KanbanConfig, orchestrations: Map<string, ChainOrchestration>, wiki: WikiVaultClient, defaultModel?: AgentModelOptions);
    private currentPhase;
    wakeV(chainId: string): Promise<void>;
    /** 阻塞复核幂等判定：任务最近一次 task/blocked 之后已存在 [blocked-review] 开头的评论。
     *  注：at 为 Date.now() 毫秒精度，block 与评论可能同毫秒（测试/快路径实测碰撞）→ 用 seq 比较（确定性）。 */
    private hasBlockReview;
    /** 评审卡 completed 处理（交付质量链）：读 handoff 的 review_evidence verdict 分流。
     *  pass → recordReview(passed) + 推进；fail → recordReview(failed) + createReworkTask + 新建复审卡；
     *  reviewAttempt ≥ maxReworksPerRole → review/gave-up + [review-final] 证据链（链保持）。
     *  严禁对已完成的上游 P/D 调 blockTask（done 不可变；返工走新 rework 卡）。 */
    private handleReviewCompletion;
    private advance;
    private getVAgent;
    /** M2(Q5)：链的 workspaceDir（发起 /plan: 的主 agent 工作空间），缺失回退 kanban 存储。 */
    private chainWorkspace;
    private workspaceDir;
}
export {};

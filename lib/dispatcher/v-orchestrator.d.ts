import type { Context } from '@deepseek-ai/cordis';
import type { KanbanService } from '../domain/kanban-service.js';
import type { ConfigProvider } from '../services/config-provider.js';
import type { Role, TaskMode } from '../domain/types.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { AgentModelOptions } from './dispatcher.js';
export type VPhase = 'p' | 'pt' | 'w2' | 'd' | 'dt' | 'w3' | 'summary';
export interface ChainOrchestration {
    chainId: string;
    phase: VPhase;
    sessionId: string | null;
    waitingOn: string | null;
    stallCount?: number;
}
export declare const R20_PHASE_ORDER: VPhase[];
/** 每 phase 的期望建卡（pt 由 P 交付 pt_decision.needed=true 触发；dt 固定）。 */
export declare const R20_PHASE_EXPECT: Record<VPhase, {
    assignee: Role;
    mode: TaskMode;
} | null>;
/** M5：每阶段建卡的 body 生成指令（角色定位确定性模板，消除 V 自由发挥导致的角色漂移）。
 *  P=计划者（绝不执行）、D=唯一执行者（TARGET_REPO 必须取自规格卡 file-prefetch 附件 ref，禁止回退/猜测）、
 *  W=KB 同步（绝不执行代码）。V 把对应模板写入 kanban_create 的 body。 */
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
    private readonly ctx;
    private readonly kanban;
    private readonly agents;
    private readonly configProvider;
    private readonly orchestrations;
    private readonly wiki;
    private readonly defaultModel;
    constructor(ctx: Context, kanban: KanbanService, agents: {
        create(o: unknown): Promise<{
            agent: AgentLike;
        }>;
        resume(o: unknown): Promise<{
            agent: AgentLike;
        }>;
    }, configProvider: ConfigProvider, orchestrations: Map<string, ChainOrchestration>, wiki: WikiVaultClient, defaultModel?: AgentModelOptions);
    private currentPhase;
    /** Fix D：stall 自动再唤醒上限（同一阶段连续零产出 → 自动重试 ≤3 次，间隔递增）后放弃并显形。 */
    private static readonly STALL_REWAKE_LIMIT;
    /** Fix D：stall 再唤醒基础延迟（按 stallCount 倍增：5s/10s/15s），给瞬时故障/采样波动恢复窗口。 */
    private static readonly STALL_REWAKE_DELAY_MS;
    private rewakeTimers;
    /** 同链 wakeV 并发防护：在途时后续唤醒合并为 pending，完成后补跑一次（事件不丢）。 */
    private waking;
    private pendingWake;
    /** Fix D：orchestration 变更回调（dispatcher 注入 saveOrchs）——stall re-wake 路径绕过
     *  EventWaker，其 stallCount/phase 变化需自行落盘，防重启丢重试进度。 */
    onOrchChange?: () => void;
    wakeV(chainId: string): Promise<void>;
    /** Fix D：stall 自动再唤醒（≤3 次）。同链 pending 幂等；建卡成功（stallCount=0）后到期的
     *  re-wake 自动作废（回调内按 stallCount 判空跳过）。 */
    private scheduleRewake;
    /** Fix D：清理待触发的 re-wake 定时器（插件 dispose 时调用）。 */
    dispose(): void;
    private wakeVInner;
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
    /** M2(Q5)+归组：链的 workspaceDir（发起 /plan: 的主 agent 工作空间）；缺失返回 null（调用方询问/报错，不落 kanban 存储）。 */
    private chainWorkspace;
}
export {};

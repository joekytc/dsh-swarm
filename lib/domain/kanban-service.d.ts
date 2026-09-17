import type { EventStore } from './event-store.js';
import { type Actor } from './permissions.js';
import type { AuditEvidence, BoardState, Chain, Handoff, KanbanEvent, SpecCard, SpecCardAttachment, SpecCardSections, Task, TaskMode, Role, ReviewEvidence, ReviewIssue } from './types.js';
export type KanbanListener = (event: KanbanEvent) => void;
/** 首句：trim 后按首个换行或「。？！ 」截断；超长兜底 40 字（需求标题规范化）。 */
export declare function firstSentence(text: string): string;
/** 默认链标题：【需求】<一句话需求描述>。来源优先级 /plan: rest 首句 → checklist.problem 首句 → 未命名需求。 */
export declare function buildChainTitle(requirementName: string | null, _openspecRest: string, problem: string): string;
/** gate hook 三态裁决（PR1 互证）：null=不适用（总开关关/非 D/旧卡，静默零事件）；
 * {skipped,reason}=警报放行（task/gate-skipped 留痕后照常 completed）；
 * {ok,detail}=真跑或打回（ok=false → gate-failed + throw 同会话修复重交）。 */
export type GateHookVerdict = {
    ok: boolean;
    detail: string;
} | {
    skipped: true;
    reason: string;
} | null;
/** 同一任务实测闸打回上限（累计计数）：超过后 blockTask 转人工。
 * gate fail 不走 failTask、attempts 不递增（仅会话死亡路径 +1），故按 gate-failed 事件数自建计数。 */
export declare const MAX_GATE_BOUNCES = 3;
/** 评审证据核验汇总（PR2，非阻塞）：仅 DT 卡 complete 时调用，结果只发事件留痕
 * （differs/could-not-replay 不阻塞 complete、不改 verdict——转人工信号走事件流）。 */
export type EvidenceCheckSummary = {
    results: Array<{
        title: string;
        severity: string;
        state: string;
        detail: string;
    }>;
} | null;
/** 看板领域门面：三界面（工具/CLI/UI）统一路由的唯一入口。 */
export declare class KanbanService {
    private state;
    private readonly store;
    private readonly getKbUrlBase;
    private emitQueue;
    private readonly listeners;
    private onChainCompletedHook;
    private onTaskCompletedHook;
    private gateHook;
    private evidenceCheckHook;
    constructor(store: EventStore, getKbUrlBase?: () => string | undefined);
    private emit;
    /** 注入链完成核对钩子（由调度层设置；仅一个消费者）。 */
    setOnChainCompleted(hook: (chainId: string) => void | Promise<void>): void;
    /** 注入任务完成互链登记钩子（由调度层设置；仅一个消费者）。 */
    setOnTaskCompleted(hook: (taskId: string) => void | Promise<void>): void;
    /** 注入实测闸钩子（由装配层设置；null=关闭实测闸，行为与旧版逐字节一致）。 */
    setGateHook(hook: ((task: Task, handoff: Handoff) => Promise<GateHookVerdict>) | null): void;
    /** 注入评审证据核验钩子（PR2；null=关闭，行为与旧版一致）。 */
    setEvidenceCheckHook(hook: ((task: Task, handoff: Handoff) => Promise<EvidenceCheckSummary>) | null): void;
    /** 订阅持久化后的看板事件；返回解除订阅函数。listener 异常不影响已落盘状态。 */
    subscribe(listener: KanbanListener): () => void;
    /** 返回 seq >= 入参 的事件（与 EventStore.readSince 同为 inclusive 语义）。 */
    eventsSince(seq: number): Promise<KanbanEvent[]>;
    private publish;
    private chainOf;
    private taskOf;
    createChain(input: {
        title: string;
        ownerSessionId: string;
        workspaceDir?: string | null;
    }, actor: Actor): Promise<Chain>;
    createSpecCard(chainId: string, sections: SpecCardSections, actor: Actor): Promise<SpecCard>;
    editSpecCard(cardId: string, sections: SpecCardSections, actor: Actor): Promise<SpecCard>;
    approveSpecCard(cardId: string, actor: Actor): Promise<SpecCard>;
    /** 链级停滞终态（防线A，看门狗/V stall 超限专用机械记账）：executing → blocked。
     *  非 executing 调用即抛（fail-closed）；人工恢复=GUI 删链重跑（blocked 无出边）。 */
    blockChain(chainId: string, reason: string): Promise<void>;
    /** IM 投递失败留痕（仅 system 机械记账）：非状态转换注记事件，仅落盘供取证/GUI 观察。
     *  投递是旁路通知，失败绝不 block 链（评审决议）；留痕满足「禁止静默 skip」红线。 */
    noteImDeliveryFailed(chainId: string, detail: string, actor: Actor): Promise<KanbanEvent>;
    createTask(input: {
        chainId: string;
        title: string;
        body?: string;
        assignee: Role;
        mode: TaskMode;
        parents?: string[];
        reviewAttempt?: number;
    }, actor: Actor): Promise<Task>;
    claimTask(taskId: string, actor: Actor): Promise<Task>;
    completeTask(taskId: string, handoff: Handoff, actor: Actor, opts?: {
        boundTaskId?: string;
    }): Promise<Task>;
    /** 链完成验收核对发警告（仅 system/dispatcher 可发）。Chain 状态保持 completed。 */
    auditWarning(chainId: string, evidence: AuditEvidence[], actor: Actor): Promise<KanbanEvent>;
    /** 用户确认产物归属（仅 human，GUI confirm-audit action）。放行最终汇报。 */
    confirmAudit(chainId: string, actor: Actor): Promise<KanbanEvent>;
    /** 链标题改名（仅 human，GUI）。发 chain/title-updated 事件（非状态转换）。 */
    updateChainTitle(chainId: string, title: string, actor: Actor): Promise<Chain>;
    /** 整链硬删除（含其下全部角色卡/规格卡事件；仅 human，GUI 二次确认）。物理 purge 事件行，不可恢复。 */
    deleteChain(chainId: string, actor: Actor): Promise<void>;
    renameTask(taskId: string, title: string, actor: Actor): Promise<Task>;
    blockTask(taskId: string, reason: string, actor: Actor, opts?: {
        boundTaskId?: string;
    }): Promise<Task>;
    unblockTask(taskId: string, actor: Actor): Promise<Task>;
    heartbeat(taskId: string, actor: Actor, opts?: {
        boundTaskId?: string;
    }): Promise<Task>;
    /** 标记任务失败（runner 异常/心跳超时回收）；投影递增 attempts（infra 瞬时错误不计数）。重试由调度器重派。 */
    failTask(taskId: string, reason: string, actor: Actor, opts?: {
        infra?: boolean;
    }): Promise<Task>;
    comment(taskId: string, body: string, actor: Actor): Promise<KanbanEvent>;
    archiveTask(taskId: string, actor: Actor): Promise<Task>;
    /** 仅 draft 规格卡可挂附件（V 挂清单附件（/openspec: 建链）/ human GUI 上传）。 */
    addSpecCardAttachment(cardId: string, attachment: SpecCardAttachment, actor: Actor): Promise<SpecCard>;
    /** 评审事件（交付质量链）：recordReview 记录评审卡结论并更新被评审任务 reviewStatus。
     *  actor 必须 system（V/角色不可伪造评审结论）；verdict=pass → review/passed，否则 review/failed。
     *  投影（projection.ts）据事件更新 target.reviewStatus（passed/failed）。 */
    recordReview(reviewTaskId: string, targetTaskId: string, evidence: ReviewEvidence, actor: Actor): Promise<KanbanEvent>;
    /** 评审超限放弃：review/gave-up（含证据链信息）。仅 system。 */
    reviewGaveUp(reviewTaskId: string, targetTaskId: string, reason: string, actor: Actor): Promise<KanbanEvent>;
    /** 人工恢复被 blocked 的链（2026-09-15 恢复能力）：仅 human；fail-closed 只接受 blocked。
     *  发 chain/reopened（状态机 blocked → executing），并向链末锚点卡写 [recovery] 审计评论（禁止静默恢复）。 */
    reopenChain(chainId: string, reason: string, actor: Actor): Promise<KanbanEvent>;
    /** 人工评审豁免（2026-09-15 恢复能力）：仅 human；要求目标 reviewStatus ∈ {failed, gave-up}（防误豁免 passed/pending）。
     *  发 review/waived（投影更新 target.reviewStatus='waived'），并向目标卡写 [recovery] 审计评论。 */
    waiveReview(reviewTaskId: string, targetTaskId: string, reason: string, actor: Actor): Promise<KanbanEvent>;
    /** 评审失败返工卡创建（评审失败闭环）：原任务保持 done（不可变），新建返工卡继承 rework 字段。
     *  仅 system（can('create-rework-task')=system）；V 建执行卡、system 建返工卡。
     *  语义（2026-09-07 修正）：返工=该卡自己的独立会话——resumeSessionId 不继承源卡会话（置 null），
     *  首跑由 runTask create `kbn-<reworkId>`，卡自身失败重试再 resume 该会话；reworkOfTaskId 保留溯源。
     *  旧实现继承 source.sessionId 造成三方错位：runTask 首跑不消费它（hasRunHistory=false→create 新会话）、
     *  UI（BoardCard resumeSessionId??sessionId）却跳到源卡会话 → 「返工在后台跑但哪都找不到它」。 */
    createReworkTask(input: {
        sourceTaskId: string;
        reviewTaskId: string;
        reason: string;
        issues?: ReviewIssue[];
    }, actor: Actor): Promise<Task>;
    snapshot(): Promise<BoardState>;
    listTasks(opts?: {
        assignee?: Role;
        status?: Task['status'];
    }): Promise<Task[]>;
}

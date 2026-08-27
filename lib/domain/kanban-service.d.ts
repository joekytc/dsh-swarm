import type { EventStore } from './event-store.js';
import { type Actor } from './permissions.js';
import type { AuditEvidence, BoardState, Chain, Handoff, KanbanEvent, SpecCard, SpecCardAttachment, SpecCardSections, Task, TaskMode, Role, ReviewEvidence } from './types.js';
export type KanbanListener = (event: KanbanEvent) => void;
/** 首句：trim 后按首个换行或「。？！ 」截断；超长兜底 40 字（T7 需求标题规范化）。 */
export declare function firstSentence(text: string): string;
/** 默认链标题：【需求】<一句话需求描述>。来源优先级 /plan: rest 首句 → checklist.problem 首句 → 未命名需求。 */
export declare function buildChainTitle(requirementName: string | null, _openspecRest: string, problem: string): string;
/** 看板领域门面：三界面（工具/CLI/UI）统一路由的唯一入口。 */
export declare class KanbanService {
    private state;
    private readonly store;
    private emitQueue;
    private readonly listeners;
    private onChainCompletedHook;
    constructor(store: EventStore);
    private emit;
    /** D23：注入链完成核对钩子（由调度层设置；仅一个消费者）。 */
    setOnChainCompleted(hook: (chainId: string) => void | Promise<void>): void;
    /** T22：订阅持久化后的看板事件；返回解除订阅函数。listener 异常不影响已落盘状态。 */
    subscribe(listener: KanbanListener): () => void;
    /** T22：返回 seq >= 入参 的事件（与 EventStore.readSince 同为 inclusive 语义）。 */
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
    /** D23：链完成验收核对发警告（仅 system/dispatcher 可发）。Chain 状态保持 completed。 */
    auditWarning(chainId: string, evidence: AuditEvidence[], actor: Actor): Promise<KanbanEvent>;
    /** D23：用户确认产物归属（仅 human，GUI confirm-audit action）。放行最终汇报。 */
    confirmAudit(chainId: string, actor: Actor): Promise<KanbanEvent>;
    /** T7：链标题改名（仅 human，GUI）。发 chain/title-updated 事件（非状态转换）。 */
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
    /** T10.5：仅 draft 规格卡可挂附件（V 挂清单附件（/openspec: 建链）/ human GUI 上传）。 */
    addSpecCardAttachment(cardId: string, attachment: SpecCardAttachment, actor: Actor): Promise<SpecCard>;
    /** 评审事件（交付质量链）：recordReview 记录评审卡结论并更新被评审任务 reviewStatus。
     *  actor 必须 system（V/角色不可伪造评审结论）；verdict=pass → review/passed，否则 review/failed。
     *  投影（projection.ts）据事件更新 target.reviewStatus（passed/failed）。 */
    recordReview(reviewTaskId: string, targetTaskId: string, evidence: ReviewEvidence, actor: Actor): Promise<KanbanEvent>;
    /** 评审超限放弃：review/gave-up（含证据链信息）。仅 system。 */
    reviewGaveUp(reviewTaskId: string, targetTaskId: string, reason: string, actor: Actor): Promise<KanbanEvent>;
    /** 评审失败返工卡创建（评审失败闭环）：原任务保持 done（不可变），新建返工卡继承 rework 字段。
     *  仅 system（can('create-rework-task')=system）；V 建执行卡、system 建返工卡。 */
    createReworkTask(input: {
        sourceTaskId: string;
        reviewTaskId: string;
        reason: string;
    }, actor: Actor): Promise<Task>;
    snapshot(): Promise<BoardState>;
    listTasks(opts?: {
        assignee?: Role;
        status?: Task['status'];
    }): Promise<Task[]>;
}

export type Role = 'v' | 'p' | 'w' | 'd' | 'pt' | 'dt';
export type TaskMode = 'file' | 'external' | 'kb' | 'openspec' | 'mattpocock' | 'align' | 'execute' | 'review-plan' | 'review-impl';
export type TaskStatus = 'triage' | 'todo' | 'ready' | 'running' | 'blocked' | 'done' | 'failed' | 'archived';
export type ChainStatus = 'planning' | 'executing' | 'completed' | 'aborted';
export type SpecCardStatus = 'draft' | 'approved';
/** 评审状态（交付质量链）：not-required 普通卡 / pending 等待评审 / passed 通过 / failed 失败待返工 / gave-up 超限放弃。 */
export type ReviewStatus = 'not-required' | 'pending' | 'passed' | 'failed' | 'gave-up';
/** 评审结论：pass=通过 / fail=不通过。 */
export type ReviewVerdict = 'pass' | 'fail';
/** 评审问题条目（PT/DT 交接 evidence.issues）。 */
export interface ReviewIssue {
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    detail: string;
    location?: string;
    resolved: boolean;
}
/** 评审证据（PT/DT 交接 metadata.review_evidence）：机械校验通过才允许评审卡 pass。 */
export interface ReviewEvidence {
    verdict: ReviewVerdict;
    issues: ReviewIssue[];
    test?: Record<string, unknown>;
    build?: Record<string, unknown>;
    typecheck?: Record<string, unknown>;
    lint?: Record<string, unknown>;
    diff?: Record<string, unknown>;
    git?: Record<string, unknown>;
    openCodeReview?: Record<string, unknown>;
    reviewPage?: {
        pagePath: string;
        kbUrl: string;
    };
}
export type EventKind = 'chain/created' | 'chain/executing' | 'chain/completed' | 'chain/aborted' | 'chain/root-task-set' | 'chain/audit-warning' | 'chain/audit-confirmed' | 'spec-card/created' | 'spec-card/edited' | 'spec-card/approved' | 'task/created' | 'task/claimed' | 'task/heartbeat' | 'task/commented' | 'task/completed' | 'task/blocked' | 'task/unblocked' | 'task/archived' | 'task/failed' | 'review/passed' | 'review/failed' | 'review/gave-up';
export interface SpecCardSections {
    problem: string;
    solution: string;
    user_stories: string[];
    impl_decisions: string[];
    testing: string;
    out_of_scope: string;
}
export interface SpecCardAttachment {
    name: string;
    kind: 'file-prefetch' | 'external' | 'kb' | 'other';
    ref: string;
}
export interface Chain {
    id: string;
    title: string;
    status: ChainStatus;
    rootTaskId: string | null;
    specCardId: string | null;
    ownerSessionId: string;
    /** 发起 /plan: 的主 agent 会话工作目录（Q5：角色会话统一创建于此，便于管理 profile 会话）。null=未捕获（GUI 建链），回退 kanban 存储。 */
    workspaceDir: string | null;
    createdAt: number;
}
export interface SpecCard {
    id: string;
    chainId: string;
    status: SpecCardStatus;
    sections: SpecCardSections;
    attachments: SpecCardAttachment[];
    rawDialogueRef: string | null;
    approvedAt: number | null;
    approvedBy: string | null;
}
export interface Task {
    id: string;
    chainId: string;
    title: string;
    body: string;
    assignee: Role;
    status: TaskStatus;
    mode: TaskMode;
    priority: number;
    parents: string[];
    children: string[];
    createdBy: 'v' | 'human' | 'auto';
    attempts: number;
    heartbeats: number[];
    /** 确定性会话 id（kbn-<taskId>），与角色会话 id 一致，供追踪定位与 resume。 */
    sessionId: string;
    /** 返工来源任务 id（评审失败 createReworkTask 生成）；null=非返工卡。 */
    reworkOfTaskId: string | null;
    /** resume 会话 id（返工卡沿用被返工任务的会话，避免重头）；null=默认 kbn-<taskId>。 */
    resumeSessionId: string | null;
    /** 返工尝试次数（从被返工任务继承 +1）。 */
    reviewAttempt: number;
    /** 评审状态（普通卡 not-required）。 */
    reviewStatus: ReviewStatus;
}
export interface Handoff {
    summary: string;
    metadata: Record<string, unknown>;
    completedAt: number;
}
/** D23 链完成验收核对证据：主会话越权写工作区产物的单个线索。 */
export interface AuditEvidence {
    source: 'main-session-scan' | 'artifact-reconciliation' | string;
    detail: string;
    paths: string[];
    at?: number;
}
/** D23 链完成验收核对投影视图：warning 事件 + （可选）用户确认。 */
export interface ChainAudit {
    evidence: AuditEvidence[];
    warnedAt: number;
    warnedSeq: number;
    confirmedAt: number | null;
    confirmedBy: string | null;
    confirmedSeq: number | null;
}
/** 审计事件不是状态转换（不改变 Chain 状态，见 state-machine.ts）。 */
export declare const isAuditEventKind: (kind: EventKind) => boolean;
export interface KanbanEvent {
    seq: number;
    chainId: string;
    taskId: string | null;
    kind: EventKind;
    payload: Record<string, unknown>;
    author: string;
    at: number;
}
export interface BoardState {
    chains: Map<string, Chain>;
    tasks: Map<string, Task>;
    specCards: Map<string, SpecCard>;
    handoffs: Map<string, Handoff>;
    auditWarnings: Map<string, ChainAudit>;
    events: KanbanEvent[];
}

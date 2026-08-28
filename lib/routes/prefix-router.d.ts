import { KanbanService } from '../domain/kanban-service.js';
import type { PlanningChecklist } from '../domain/planning-checklist.js';
export interface PrefixRouteResult {
    kind: 'plan' | 'openspec' | 'learning' | 'none';
    chainId?: string;
    specCardId?: string;
    rest: string;
    brief?: string;
    guidance?: string;
    error?: string;
}
export declare function parsePrefix(message: string, cfg: {
    plan: string;
    openspec: string;
    learning?: string;
}): PrefixRouteResult;
/** v2：/plan: 零副作用——不建链/规格卡/任务卡，仅返回路由结果（workspaceDir/sessionId 由 main-session-tools 捕获）。 */
export declare function handlePlanRoute(message: string, _service: KanbanService, cfg: {
    plan: string;
    openspec: string;
}, _ownerSessionId: string): Promise<PrefixRouteResult>;
export interface OpenspecPlanningInput {
    workspaceDir: string | null;
    checklist: PlanningChecklist;
    checklistRef: string;
    /** T7：/plan: rest 原始需求描述；null=无 /plan: 捕获（回退 checklist.problem 首句/未命名需求）。 */
    requirementName?: string | null;
}
/** v2：/openspec: 建链——从清单机械映射规格卡六段 → 挂 file-prefetch(仓库 localPath)+kb(清单页) → 批准 → executing。 */
export declare function handleOpenspecRoute(message: string, service: KanbanService, cfg: {
    plan: string;
    openspec: string;
}, planning: OpenspecPlanningInput, ownerSessionId: string): Promise<PrefixRouteResult>;
/** v2：/learning: 零副作用——不建链建卡，仅机械提取证据包供主 agent 蒸馏。歧义返回候选列表，链不存在返回错误文本（不 throw）。 */
export declare function handleLearningRoute(message: string, service: KanbanService, cfg: {
    plan: string;
    openspec: string;
    learning?: string;
}, _ownerSessionId: string): Promise<PrefixRouteResult>;

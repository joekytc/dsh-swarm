import { KanbanService } from '../domain/kanban-service.js';
import type { PlanningChecklist } from '../domain/planning-checklist.js';
import type { PrefixRoutes } from '../config.js';
/** 防线D：/openspec: 建链后同步等待首张任务卡的最长时长与轮询间隔（fail-open：超时返回 pending，
 *  由链级看门狗接管）。可变对象供测试注入短值（vitest 文件级隔离）。 */
export declare const OPENSPEC_FIRST_CARD: {
    timeoutMs: number;
    pollIntervalMs: number;
};
export interface PrefixRouteResult {
    kind: 'plan' | 'openspec' | 'learning' | 'send' | 'none';
    chainId?: string;
    specCardId?: string;
    rest: string;
    brief?: string;
    guidance?: string;
    error?: string;
    /** /openspec: 建链结果；false=被护栏拦截（reason 说明原因），未建任何链/卡。 */
    approved?: boolean;
    reason?: string;
    /** 防线D：建链后同步等待的首卡结果。{taskId,status}=V 已建卡；{pending:true}=等待超时（fail-open，看门狗接管）。 */
    firstCard?: {
        taskId: string;
        status: string;
    } | {
        pending: true;
    };
}
export declare function parsePrefix(message: string, cfg: PrefixRoutes): PrefixRouteResult;
/** v2：/plan: 零副作用——不建链/规格卡/任务卡，仅返回路由结果（workspaceDir/sessionId 由 main-session-tools 捕获）。 */
export declare function handlePlanRoute(message: string, _service: KanbanService, cfg: PrefixRoutes, _ownerSessionId: string): Promise<PrefixRouteResult>;
export interface OpenspecPlanningInput {
    workspaceDir: string | null;
    checklist: PlanningChecklist;
    checklistRef: string;
    /** T7：/plan: rest 原始需求描述；null=无 /plan: 捕获（回退 checklist.problem 首句/未命名需求）。 */
    requirementName?: string | null;
}
/** v2：/openspec: 建链——从清单机械映射规格卡六段 → 挂 file-prefetch(仓库 localPath)+kb(清单页) → 批准 → executing。 */
export declare function handleOpenspecRoute(message: string, service: KanbanService, cfg: PrefixRoutes, planning: OpenspecPlanningInput, ownerSessionId: string): Promise<PrefixRouteResult>;
/** /learning 零副作用引导文案：命令串从 config 派生（决策12），歧义/未找到时注入主 agent。 */
export declare function buildLearningGuidance(routes: PrefixRoutes): string;
/** v2：/learning 零副作用——不建链建卡，仅机械提取证据包供主 agent 蒸馏。歧义返回候选列表，链不存在返回错误文本（不 throw）。 */
export declare function handleLearningRoute(message: string, service: KanbanService, cfg: PrefixRoutes, _ownerSessionId: string): Promise<PrefixRouteResult>;

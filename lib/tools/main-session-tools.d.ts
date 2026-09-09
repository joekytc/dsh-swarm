import type { Context } from '@deepseek-ai/cordis';
import type { PrefixRoutes } from '../config.js';
import type { ConfigProvider } from '../services/config-provider.js';
import { type PlanningToolDeps } from './planning-tools.js';
import type { PlanningChecklist } from '../domain/planning-checklist.js';
/** v2 规划上下文（/plan: 捕获 → planning_checklist_save 回写 → /openspec: 建链）。模块级内存，随插件进程存活。 */
export interface PlanningContext {
    workspaceDir: string | null;
    sessionId: string;
    checklist: PlanningChecklist | null;
    checklistRef: string | null;
    checklistSource: 'kb' | 'temp' | null;
    /** /plan: rest 原始需求描述（建链默认标题来源，优先级最高）。 */
    requirementName: string | null;
    /** 蜂群模式标记：kanban_route 触发方式（intent=swarm / 前缀=prefix）；planning_checklist_save 指导文案分叉数据源。 */
    mode?: 'swarm' | 'prefix' | null;
}
export declare const planningBySession: Map<string, PlanningContext>;
export declare const KANBAN_HANDOFF_RULE: (routes: PrefixRoutes, opts?: {
    swarm?: boolean;
}) => string;
/** 防线③：/openspec: 成功后的逐链确定性叙述规则（2026-09-04 mtmgp81q：模型口播 ch_1_mtjrhkrf
 *  与工具结果 ch_1_mtmgp81q 脱节）。逐字引用锚点 + firstCard 成败结论；整包缓存回放仍可能
 *  绕过 prompt 层——最终防线是链级看门狗（防线①）。 */
export declare function buildOpenspecNarrationRule(r: {
    chainId: string;
    specCardId: string;
    firstCard?: {
        taskId: string;
        status: string;
    } | {
        pending: true;
    };
}): string;
export declare function buildSpawnPrefetch(ctx: Context): PlanningToolDeps['spawnPrefetch'] | undefined;
/** v2 主会话工具面：/plan: 捕获规划上下文（零副作用）→ planning_checklist_save 回写 → /openspec: 建链。
 *  工具面 = kanban_route + 只读 kanban 子集 + spec_card_view + planning 工具；
 *  无 spec_card_edit/approve、无 kanban_create/complete/block（主会话越权写由工具面裁剪 + prefetch 子代理只读护栏双保险）。 */
export declare function registerMainSessionTools(ctx: Context, configProvider: ConfigProvider): void;

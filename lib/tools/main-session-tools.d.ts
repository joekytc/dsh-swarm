import type { Context } from '@deepseek-ai/cordis';
import type { KanbanConfig } from '../config.js';
import type { PlanningChecklist } from '../domain/planning-checklist.js';
/** v2 规划上下文（/plan: 捕获 → planning_checklist_save 回写 → /openspec: 建链）。模块级内存，随插件进程存活。 */
export interface PlanningContext {
    workspaceDir: string | null;
    sessionId: string;
    checklist: PlanningChecklist | null;
    checklistRef: string | null;
    checklistSource: 'kb' | 'temp' | null;
}
export declare const planningBySession: Map<string, PlanningContext>;
/** v2 主会话工具面：/plan: 捕获规划上下文（零副作用）→ planning_checklist_save 回写 → /openspec: 用清单建链。
 *  工具面 = kanban_route + 只读 kanban 子集 + spec_card_view + planning 工具；
 *  无 spec_card_edit/approve、无 kanban_create/complete/block（主会话越权写由工具面裁剪 + prefetch 子代理只读护栏双保险）。 */
export declare function registerMainSessionTools(ctx: Context, config: KanbanConfig): void;

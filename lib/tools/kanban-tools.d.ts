import { KanbanService } from '../domain/kanban-service.js';
import { type Actor } from '../domain/permissions.js';
/** 工具执行上下文：由角色 agent scope 注入；主会话=human；调度器=system。
 *  boundTaskId：角色 agent 会话绑定的任务（AgentSessionRef.task_id，P1-4 会话绑定）。 */
export interface ToolCaller {
    actor: Actor;
    boundTaskId?: string;
}
/** 工具定义工厂（P1-3）：不直接注册；由 T15 toolsets 按角色 agent-scope 装配，或由主会话注册其专属子集。
 *  getCaller：装配方提供的闭包（捕获 actor/boundTaskId），execute 内取用——不依赖 execute 第二参数（DSH ToolRunContext 真实形状以官方为准）。 */
export declare function buildKanbanTools(service: KanbanService, getCaller: () => ToolCaller): import("@deepseek-ai/dsh-tools").ToolDefinition[];

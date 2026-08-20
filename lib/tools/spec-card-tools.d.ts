import { KanbanService } from '../domain/kanban-service.js';
import type { ToolCaller } from './kanban-tools.js';
/** 规格卡工具工厂：主会话（human）专属——编辑/批准仅 human；查看任意角色可读。 */
export declare function buildSpecCardTools(service: KanbanService, getCaller: () => ToolCaller): import("@deepseek-ai/dsh-tools").ToolDefinition[];

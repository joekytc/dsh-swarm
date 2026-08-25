import type { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { type PlanningChecklist } from '../domain/planning-checklist.js';
import type { ToolCaller } from './kanban-tools.js';
import type { AgentModelOptions } from '../dispatcher/dispatcher.js';
export interface PlanningToolDeps {
    service: KanbanService;
    wiki: WikiVaultClient;
    getCaller(): ToolCaller;
    /** 真实实现：spawn 只读预取子代理并返回其文本输出；测试注入 stub。 */
    spawnPrefetch?(prompt: string, workspaceDir: string, agentOptions?: AgentModelOptions): Promise<string>;
    tempDir(): string;
    pagePrefix?: string;
    ownerSessionId?: string;
    defaultModel?: AgentModelOptions;
    /** 清单落库成功回调（kb 与 temp 两分支各调一次），供 main-session-tools 回写 planningBySession。 */
    onChecklistSaved?(saved: {
        ref: string;
        source: 'kb' | 'temp';
        checklist: PlanningChecklist;
    }): void;
}
/** 主 agent 规划期工具：需求澄清清单落库（KB 优先/临时目录兜底）+ 只读仓库预取（子代理）。 */
export declare function buildPlanningTools(deps: PlanningToolDeps): import("@deepseek-ai/dsh-tools").ToolDefinition[];

import type { Agent } from '@deepseek-ai/dsh-agent';
import type { KanbanService } from '../domain/kanban-service.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { type PlanningChecklist } from '../domain/planning-checklist.js';
import type { ToolCaller } from './kanban-tools.js';
import type { AgentModelOptions } from '../dispatcher/dispatcher.js';
import type { PrefixRoutes } from '../config.js';
/** 工具运行时上下文（dsh-tools ToolRunContext 窄型）：agent loop 注入调用者 Agent 与取消信号，
 *  planning_prefetch 经官方子代理缝启动时需透传（parent + signal）。 */
export interface PrefetchExecContext {
    agent?: Agent;
    signal?: AbortSignal;
}
export interface PlanningToolDeps {
    service: KanbanService;
    wiki: WikiVaultClient;
    getCaller(): ToolCaller;
    /** 真实实现：经官方子代理缝（ctx.subagents.start）启动只读预取子代理并返回其文本输出；测试注入 stub。
     *  parentAgent = 发起调用的主 agent（血缘/模型继承源），由 planning_prefetch 的 exec.agent 透传。 */
    spawnPrefetch?(prompt: string, workspaceDir: string, parentAgent?: Agent, signal?: AbortSignal): Promise<string>;
    tempDir(): string;
    pagePrefix?: string;
    ownerSessionId?: string;
    /** 斜杠命令前缀路由（决策12 单一事实源），用于 description 文案派生。 */
    prefixRoutes: PrefixRoutes;
    defaultModel?: AgentModelOptions;
    /** 清单落库成功回调（kb 与 temp 两分支各调一次），供 main-session-tools 回写 planningBySession。 */
    onChecklistSaved?(saved: {
        ref: string;
        source: 'kb' | 'temp';
        checklist: PlanningChecklist;
    }): void;
    /** memory.enabled；false 时 planning_memory_recall 返回 disabled 提示（planning_learning_save 不受影响）。 */
    memoryEnabled?: boolean;
}
/** 主 agent 规划期工具：需求澄清清单落库（KB 优先/临时目录兜底）+ 只读仓库预取（子代理）。 */
export declare function buildPlanningTools(deps: PlanningToolDeps): import("@deepseek-ai/dsh-tools").ToolDefinition[];

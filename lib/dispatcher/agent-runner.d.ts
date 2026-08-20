import type { Context } from '@deepseek-ai/cordis';
import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import type { AgentModelOptions } from './dispatcher.js';
/** 每任务一次性角色 agent：创建/resume、上下文组装、协议违规检测。 */
export declare class AgentRunner {
    private readonly ctx;
    private readonly kanban;
    private readonly config;
    private readonly wiki;
    private readonly defaultModel;
    constructor(ctx: Context, kanban: KanbanService, config: KanbanConfig, wiki: WikiVaultClient, defaultModel?: AgentModelOptions);
    private buildContext;
    runTask(taskId: string): Promise<void>;
    /** M3(B)：D(execute) 目标仓库在会话工作空间外时，跑 D 前询问用户是否允许。
     *  经 ctx.userQuestions（GUI 弹窗）单次询问；无询问通道或拒绝 → 返回 false（由调用方 claim+block 等待人工放行）。 */
    private requestRepoPermission;
    private workspaceDir;
}

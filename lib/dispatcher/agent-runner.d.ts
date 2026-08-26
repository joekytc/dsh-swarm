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
    /** RC2：resume 前先查 agents registry 同名会话是否仍 live——live 则直接复用（后续 followup 续用），
     *  避免 block→unblock→重跑同一会话时 resume 抛 "cannot prepare session while it is live"
     *  （对齐 VOrchestrator.getVAgent 的 live 复用逻辑）。agents.get 未实现 → 防御回退 resume。 */
    private resumeOrReuse;
    /** M3(B)：D(execute) 目标仓库在会话工作空间外时，跑 D 前询问用户是否允许。
     *  经 ctx.userQuestions（GUI 弹窗）单次询问；无询问通道或拒绝 → 返回 false（由调用方 claim+block 等待人工放行）。 */
    private requestRepoPermission;
}

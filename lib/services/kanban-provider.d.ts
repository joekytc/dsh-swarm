import { Service, type Context } from '@deepseek-ai/cordis';
import { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
import type { ConfigProvider } from './config-provider.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        kanban: KanbanProvider;
    }
}
export declare class KanbanProvider extends Service {
    readonly service: KanbanService;
    /** GUI retry 的任务执行器（由 startDispatcher 装配后注入；webServer 先于 agents 就绪时可为 null）。 */
    runner: {
        runTask(taskId: string): Promise<void>;
    } | null;
    /** 整链硬删除后的联动钩子（由 startDispatcher 装配注入）：dispatcher 游标同步 + V 编排 entry 清理。
     *  purge 物理重排 events seq，若不同步则删链后新建链的可唤醒事件被运行中实例永久跳过。 */
    onChainDeleted: ((chainId: string) => Promise<void> | void) | null;
    constructor(ctx: Context, config: KanbanConfig, configProvider: ConfigProvider);
}

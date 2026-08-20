import { Service, type Context } from '@deepseek-ai/cordis';
import { KanbanService } from '../domain/kanban-service.js';
import type { KanbanConfig } from '../config.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        kanban: KanbanProvider;
    }
}
export declare class KanbanProvider extends Service {
    readonly service: KanbanService;
    /** T32 fix：GUI retry 的任务执行器（由 startDispatcher 装配后注入；webServer 先于 agents 就绪时可为 null）。 */
    runner: {
        runTask(taskId: string): Promise<void>;
    } | null;
    constructor(ctx: Context, config: KanbanConfig);
}

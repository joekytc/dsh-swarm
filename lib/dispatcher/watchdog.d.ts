import type { KanbanService } from '../domain/kanban-service.js';
/** 心跳超时回收（running 无心跳 → failed，可重试）。
 *  failed 任务的熔断（attempts≥maxRetries → blocked(gave_up)）与重派由调度器（Dispatcher.tick）统一处理（B1）。 */
export declare class Watchdog {
    private timer;
    private readonly kanban;
    private readonly cfg;
    constructor(kanban: KanbanService, cfg: {
        staleTimeoutSeconds: number;
        maxRetries: number;
    });
    tick(now?: number): Promise<void>;
    start(intervalMs: number): void;
    stop(): void;
}

import type { Context } from '@deepseek-ai/cordis';
import type { KanbanConfig } from '../config.js';
import { EventWaker } from './event-waker.js';
import { Watchdog } from './watchdog.js';
import type { KanbanService } from '../domain/kanban-service.js';
export interface AgentModelOptions {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** 读取部署默认模型（settings 的 agent-default-model 优先，其次 dsh-agent-default-model），角色未单独配置时回退使用。 */
export declare function resolveDefaultModel(ctx: Context): AgentModelOptions | undefined;
export interface DispatcherDeps {
    kanban: KanbanService;
    runner: {
        runTask(taskId: string): Promise<void>;
    };
    waker: EventWaker;
    watchdog: Watchdog;
    maxRetries: number;
    /** lastSeq 持久化文件（与事件日志同目录，B6）。 */
    stateFile: string;
    /** 修复轮 6：调度器运行日志文件（storageDir/dispatcher.log）。 */
    logFile: string;
}
/** 调度器：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  - B1：failed 且 attempts<maxRetries 的任务重派（claim→running，AgentRunner resume 同一会话）；
 *        attempts≥maxRetries 熔断 blocked(gave_up)。
 *  - B6：lastSeq 持久化，重启后仅唤醒 lastSeq 之后的事件。
 *  - R5：inFlight 互斥，防止慢 tick 与下一轮并发重复派发同一任务。 */
export declare class Dispatcher {
    private readonly kanban;
    private readonly runner;
    private readonly waker;
    private readonly watchdog;
    private readonly maxRetries;
    private readonly stateFile;
    private readonly logFile;
    private lastSeq;
    private inFlight;
    private timer;
    constructor(deps: DispatcherDeps);
    private ensureLastSeq;
    tick(): Promise<void>;
    start(intervalMs: number): void;
    stop(): void;
}
/** 调度层装配：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  仅在 agents 与 kanban 服务同时可用时由插件入口调用（不依赖可能已错过的 ready 事件）。 */
export declare function startDispatcher(ctx: Context, config: KanbanConfig): void;

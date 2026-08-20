import type { KanbanEvent } from '../domain/types.js';
import type { KanbanConfig } from '../config.js';
type WakeImpl = (chainId: string) => Promise<void>;
/** 监听 kanban 事件并唤醒 V 编排会话（去重：同一链路在途只唤醒一次）。 */
export declare class EventWaker {
    private inFlight;
    private wakeImpl;
    constructor(_ctx: unknown, _config: KanbanConfig);
    /** 注入真实唤醒实现（T11.5：VOrchestrator.wakeV——创建/恢复 V 编排 agent 会话，按 R20 阶段序列建卡）。 */
    setWakeImpl(impl: WakeImpl): void;
    onEvent(ev: KanbanEvent): Promise<void>;
}
export {};

/** 监听 kanban 事件并唤醒 V 编排会话（去重：同一链路在途只唤醒一次）。 */
export class EventWaker {
    inFlight = new Set();
    wakeImpl = async () => { };
    constructor(_ctx, _config) { }
    /** 注入真实唤醒实现（T11.5：VOrchestrator.wakeV——创建/恢复 V 编排 agent 会话，按 R20 阶段序列建卡）。 */
    setWakeImpl(impl) { this.wakeImpl = impl; }
    async onEvent(ev) {
        const wakeable = (ev.kind === 'chain/created' || ev.kind === 'task/completed' || ev.kind === 'task/blocked' || ev.kind === 'spec-card/approved');
        if (!wakeable)
            return;
        if (this.inFlight.has(ev.chainId))
            return;
        this.inFlight.add(ev.chainId);
        try {
            await this.wakeImpl(ev.chainId);
        }
        finally {
            this.inFlight.delete(ev.chainId);
        }
    }
}

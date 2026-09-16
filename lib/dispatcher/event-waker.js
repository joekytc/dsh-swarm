/** 监听 kanban 事件并唤醒 V 编排会话（去重：同一链路在途只唤醒一次）。 */
export class EventWaker {
    inFlight = new Set();
    wakeImpl = async () => { };
    constructor(_ctx, _config) { }
    /** 注入真实唤醒实现（VOrchestrator.wakeV——创建/恢复 V 编排 agent 会话，按阶段序列建卡）。 */
    setWakeImpl(impl) { this.wakeImpl = impl; }
    async onEvent(ev) {
        // V 仅在规格卡批准后（spec-card/approved）或任务完成/阻塞（驱动阶段推进）时唤醒；
        // chain/created 不再唤醒 V（V 不再处理旧 w1 预取阶段，等 /openspec: 建卡 + 批准后再行动）。
        // 2026-09-15 恢复能力：人工恢复（chain/reopened）与评审豁免（review/waived）同样唤醒 V，
        // 重入编排按最后一条 review 事件判定推进（否则恢复动作后无人推进 = 恢复形同虚设）。
        const wakeable = (ev.kind === 'task/completed' || ev.kind === 'task/blocked' || ev.kind === 'spec-card/approved'
            || ev.kind === 'chain/reopened' || ev.kind === 'review/waived');
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

import type { KanbanEvent } from '../domain/types.js';
import type { KanbanConfig } from '../config.js';

type WakeImpl = (chainId: string) => Promise<void>;

/** 监听 kanban 事件并唤醒 V 编排会话（去重：同一链路在途只唤醒一次）。 */
export class EventWaker {
  private inFlight = new Set<string>();
  private wakeImpl: WakeImpl = async () => {};

  constructor(_ctx: unknown, _config: KanbanConfig) {}

  /** 注入真实唤醒实现（T11.5：VOrchestrator.wakeV——创建/恢复 V 编排 agent 会话，按 R20 阶段序列建卡）。 */
  setWakeImpl(impl: WakeImpl): void { this.wakeImpl = impl; }

  async onEvent(ev: KanbanEvent): Promise<void> {
    // v2：V 仅在规格卡批准后（spec-card/approved）或任务完成/阻塞（驱动阶段推进）时唤醒；
    // chain/created 不再唤醒 V（V 不再处理旧 w1 预取阶段，等 /openspec: 建卡 + 批准后再行动）。
    const wakeable =
      (ev.kind === 'task/completed' || ev.kind === 'task/blocked' || ev.kind === 'spec-card/approved');
    if (!wakeable) return;
    if (this.inFlight.has(ev.chainId)) return;
    this.inFlight.add(ev.chainId);
    try {
      await this.wakeImpl(ev.chainId);
    } finally {
      this.inFlight.delete(ev.chainId);
    }
  }
}

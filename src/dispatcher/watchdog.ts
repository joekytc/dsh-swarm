import type { KanbanService } from '../domain/kanban-service.js';

/** 心跳超时回收（running 无心跳 → failed，可重试）。
 *  failed 任务的熔断（attempts≥maxRetries → blocked(gave_up)）与重派由调度器（Dispatcher.tick）统一处理（B1）。 */
export class Watchdog {
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly kanban: KanbanService;
  private readonly cfg: { staleTimeoutSeconds: number; maxRetries: number };
  constructor(
    kanban: KanbanService,
    cfg: { staleTimeoutSeconds: number; maxRetries: number },
  ) { this.kanban = kanban; this.cfg = cfg; }

  async tick(now = Date.now()): Promise<void> {
    const state = await this.kanban.snapshot();
    for (const t of state.tasks.values()) {
      if (t.status === 'running') {
        const lastBeat = t.heartbeats.at(-1) ?? state.events.find((e) => e.taskId === t.id && e.kind === 'task/claimed')?.at ?? now;
        if (now - lastBeat > this.cfg.staleTimeoutSeconds * 1000) {
          await this.kanban.failTask(t.id, 'stale-reclaim', 'system'); // P0-5：超时回收发 failed（可重试），不直接 block
        }
      }
      // failed 任务不在此处理：Dispatcher.tick 负责 attempts<maxRetries 重派 / attempts≥maxRetries 熔断
    }
  }

  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

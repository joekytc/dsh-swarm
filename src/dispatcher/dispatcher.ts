import type { Context } from '@deepseek-ai/cordis';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KanbanConfig } from '../config.js';
import { KanbanProvider } from '../services/kanban-provider.js';
import { EventWaker } from './event-waker.js';
import { VOrchestrator, type ChainOrchestration } from './v-orchestrator.js';
import { AgentRunner } from './agent-runner.js';
import { Watchdog } from './watchdog.js';
import type { Task } from '../domain/types.js';

/** 调度层装配：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  仅当 ctx.agents 可用时启动（测试裸 Context / CLI 无 agents 则跳过）。 */
export function startDispatcher(ctx: Context, config: KanbanConfig): void {
  (ctx as unknown as { on(name: string, fn: () => void): () => boolean }).on('ready', () => {
    const provider = ctx.get('kanban') as KanbanProvider | undefined;
    if (!provider) return;
    if (!(ctx as { agents?: unknown }).agents) return;
    const kanban = provider.service;
    const storageDir = config.storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd());
    const orchFile = join(storageDir, 'orchestration.json');
    const orchestrations = new Map<string, ChainOrchestration>();
    try {
      const raw = JSON.parse(readFileSync(orchFile, 'utf8')) as Array<[string, ChainOrchestration]>;
      for (const [k, v] of raw) orchestrations.set(k, v);
    } catch { /* 首次启动无文件 */ }
    const saveOrchs = () => {
      try { writeFileSync(orchFile, JSON.stringify([...orchestrations.entries()], null, 2)); } catch { /* 忽略写失败 */ }
    };
    const vOrch = new VOrchestrator(kanban, (ctx as { agents: unknown }).agents as never, config, orchestrations);
    const waker = new EventWaker(ctx, config);
    waker.setWakeImpl(async (chainId) => { await vOrch.wakeV(chainId); saveOrchs(); });
    const runner = new AgentRunner(ctx, kanban, config);
    const watchdog = new Watchdog(kanban, config.dispatcher);

    let lastSeq = -1;
    const tick = async () => {
      try {
        const state = await kanban.snapshot();
        for (const ev of state.events) {
          if (ev.seq > lastSeq) { lastSeq = ev.seq; await waker.onEvent(ev); }
        }
        for (const t of state.tasks.values()) {
          if ((t.status === 'ready' || t.status === 'todo') && parentsDone(t, state)) {
            await runner.runTask(t.id);
          }
        }
        await watchdog.tick();
      } catch { /* 单轮失败不致命；看门狗/唤醒在下一轮重试 */ }
    };
    const timer = setInterval(() => { void tick(); }, 2000);
    (ctx as unknown as { on(name: string, fn: () => void): () => boolean }).on('dispose', () => { clearInterval(timer); watchdog.stop(); });
    watchdog.start(config.dispatcher.heartbeatIntervalSeconds * 1000);
    void tick();
  });
}

function parentsDone(task: Task, state: { tasks: Map<string, { status: string }> }): boolean {
  return task.parents.every((pid) => {
    const parent = state.tasks.get(pid);
    return parent !== undefined && (parent.status === 'done' || parent.status === 'archived');
  });
}

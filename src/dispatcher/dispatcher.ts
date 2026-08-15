import type { Context } from '@deepseek-ai/cordis';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KanbanConfig } from '../config.js';
import { KanbanProvider } from '../services/kanban-provider.js';
import { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { EventWaker } from './event-waker.js';
import { VOrchestrator, type ChainOrchestration } from './v-orchestrator.js';
import { AgentRunner } from './agent-runner.js';
import { Watchdog } from './watchdog.js';
import type { Task } from '../domain/types.js';

export interface AgentModelOptions {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** 读取部署默认模型（settings 的 agent-default-model 优先，其次 dsh-agent-default-model），角色未单独配置时回退使用。 */
function resolveDefaultModel(ctx: Context): AgentModelOptions | undefined {
  try {
    const settings = ctx.get('settings') as { get(ns: string): unknown } | undefined;
    const m = settings?.get('agent-default-model') as Partial<AgentModelOptions> | undefined;
    if (m?.provider && m?.model) {
      return m.reasoningEffort
        ? { provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort }
        : { provider: m.provider, model: m.model };
    }
  } catch {
    // settings 不可用则继续尝试 agentDefaultModel
  }
  try {
    const svc = ctx.get('agentDefaultModel') as { currentSelection(): AgentModelOptions } | undefined;
    const sel = svc?.currentSelection();
    return sel?.provider && sel?.model ? sel : undefined;
  } catch {
    return undefined;
  }
  return undefined;
}

/** 调度层装配：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  仅在 agents 与 kanban 服务同时可用时由插件入口调用（不依赖可能已错过的 ready 事件）。 */
export function startDispatcher(ctx: Context, config: KanbanConfig): void {
  const provider = ctx.get('kanban') as KanbanProvider | undefined;
  const agents = ctx.get('agents');
  if (!provider || !agents) return;
  const kanban = provider.service;
  const wiki = new WikiVaultClient(config.wikiVault);
  const defaultModel = resolveDefaultModel(ctx);
  console.info('[dsh-kanban] role default model = ' + (defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'none'));
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
  const vOrch = new VOrchestrator(kanban, agents as never, config, orchestrations, wiki, defaultModel);
  const waker = new EventWaker(ctx, config);
  waker.setWakeImpl(async (chainId) => { await vOrch.wakeV(chainId); saveOrchs(); });
  const runner = new AgentRunner(ctx, kanban, config, wiki, defaultModel);
  provider.runner = runner; // T32 fix：HTTP retry 复用同一执行器（failed→claim→spawn/resume）
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
}

function parentsDone(task: Task, state: { tasks: Map<string, { status: string }> }): boolean {
  return task.parents.every((pid) => {
    const parent = state.tasks.get(pid);
    return parent !== undefined && (parent.status === 'done' || parent.status === 'archived');
  });
}

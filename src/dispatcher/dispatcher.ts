import type { Context } from '@deepseek-ai/cordis';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { KanbanConfig } from '../config.js';
import { KanbanProvider } from '../services/kanban-provider.js';
import { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { EventWaker } from './event-waker.js';
import { VOrchestrator, type ChainOrchestration } from './v-orchestrator.js';
import { AgentRunner } from './agent-runner.js';
import { Watchdog } from './watchdog.js';
import { ChainAuditor } from './chain-auditor.js';
import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanEvent, Task } from '../domain/types.js';

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

function parentsDone(task: Task, state: { tasks: Map<string, { status: string }> }): boolean {
  return task.parents.every((pid) => {
    const parent = state.tasks.get(pid);
    return parent !== undefined && (parent.status === 'done' || parent.status === 'archived');
  });
}

export interface DispatcherDeps {
  kanban: KanbanService;
  runner: { runTask(taskId: string): Promise<void> };
  waker: EventWaker;
  watchdog: Watchdog;
  maxRetries: number;
  /** lastSeq 持久化文件（与事件日志同目录，B6）。 */
  stateFile: string;
  /** 修复轮 6：调度器运行日志文件（storageDir/dispatcher.log）。 */
  logFile: string;
}

/** B6：从状态文件恢复 lastSeq；无文件时回退到事件日志尾行（不重放旧事件重复唤醒 V）。 */
function loadLastSeq(stateFile: string): number | null {
  try {
    const raw = JSON.parse(readFileSync(stateFile, 'utf8')) as { lastSeq?: number };
    return typeof raw.lastSeq === 'number' ? raw.lastSeq : null;
  } catch {
    return null;
  }
}

function saveLastSeq(stateFile: string, lastSeq: number): void {
  try {
    writeFileSync(stateFile, JSON.stringify({ lastSeq }));
  } catch { /* 忽略写失败：事件日志仍是事实源 */ }
}

/** 修复轮 6：把 [dsh-kanban] 关键事件追加到 storageDir/dispatcher.log，便于无控制台时观测调度器状态。 */
function logToFile(file: string, msg: string): void {
  try { writeFileSync(file, new Date().toISOString() + ' ' + msg + '\n', { flag: 'a' }); } catch { /* 忽略写失败 */ }
}

/** 修复轮 6：单次异步操作加超时护栏——一个挂起的 V 编排会话不得卡死整个调度器 tick。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout: ' + label)), ms)),
  ]);
}

/** 调度器：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  - B1：failed 且 attempts<maxRetries 的任务重派（claim→running，AgentRunner resume 同一会话）；
 *        attempts≥maxRetries 熔断 blocked(gave_up)。
 *  - B6：lastSeq 持久化，重启后仅唤醒 lastSeq 之后的事件。
 *  - R5：inFlight 互斥，防止慢 tick 与下一轮并发重复派发同一任务。 */
export class Dispatcher {
  private readonly kanban: KanbanService;
  private readonly runner: { runTask(taskId: string): Promise<void> };
  private readonly waker: EventWaker;
  private readonly watchdog: Watchdog;
  private readonly maxRetries: number;
  private readonly stateFile: string;
  private readonly logFile: string;
  private lastSeq: number | null = null; // null=尚未加载（首轮 tick 从状态文件/事件日志尾行恢复）
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: DispatcherDeps) {
    this.kanban = deps.kanban;
    this.runner = deps.runner;
    this.waker = deps.waker;
    this.watchdog = deps.watchdog;
    this.maxRetries = deps.maxRetries;
    this.stateFile = deps.stateFile;
    this.logFile = deps.logFile;
  }

  private async ensureLastSeq(state: { events: KanbanEvent[] }): Promise<void> {
    if (this.lastSeq !== null) return;
    // 修复轮 6：无状态文件（首次启动）时从 -1 起处理全部事件，避免跳过已存在的
    // chain/created / spec-card/approved 等可唤醒事件导致 V 永不建卡（B6 回归）。
    // 重放安全：VOrchestrator.wakeV 的 B6 幂等（已有匹配卡则跳过）保证不重复建卡。
    this.lastSeq = loadLastSeq(this.stateFile) ?? -1;
    logToFile(this.logFile, '[tick] initial lastSeq=' + this.lastSeq);
  }

  async tick(): Promise<void> {
    if (this.inFlight) return; // R5：防重叠 tick 并发派发同一任务
    this.inFlight = true;
    try {
      const state = await this.kanban.snapshot();
      await this.ensureLastSeq(state);
      let advanced = false;
      for (const ev of state.events) {
        if (ev.seq > this.lastSeq!) {
          this.lastSeq = ev.seq;
          advanced = true;
          try {
            await withTimeout(this.waker.onEvent(ev), 60_000, 'wakeV ev=' + ev.seq + ' chain=' + ev.chainId);
          } catch (err) {
            logToFile(this.logFile, '[tick] wakeV failed ev=' + ev.seq + ' chain=' + ev.chainId + ': ' + String(err));
          }
        }
      }
      if (advanced) saveLastSeq(this.stateFile, this.lastSeq!);
      for (const t of state.tasks.values()) {
        if (!parentsDone(t, state)) continue;
        if (t.status === 'ready' || t.status === 'todo') {
          await this.runner.runTask(t.id);
        } else if (t.status === 'failed' && t.attempts < this.maxRetries) {
          // B1：failed 重派——AgentRunner 内 claim→running + resume 同一会话
          await this.runner.runTask(t.id);
        } else if (t.status === 'failed') {
          // B1：attempts≥maxRetries 熔断 blocked(gave_up)，人工介入
          await this.kanban.blockTask(t.id, 'gave_up: max retries', 'system');
        }
      }
      await this.watchdog.tick();
    } catch (e) {
      console.error('[dsh-kanban][debug] tick error: ' + String(e));
      logToFile(this.logFile, '[tick] error: ' + String(e));
    } finally {
      this.inFlight = false;
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

/** 调度层装配：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  仅在 agents 与 kanban 服务同时可用时由插件入口调用（不依赖可能已错过的 ready 事件）。 */
export function startDispatcher(ctx: Context, config: KanbanConfig): void {
  const storageDir = config.storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd());
  const logFile = join(storageDir, 'dispatcher.log');
  const provider = ctx.get('kanban') as KanbanProvider | undefined;
  const agents = ctx.get('agents');
  logToFile(logFile, '[startDispatcher] invoked provider=' + Boolean(provider) + ' agents=' + Boolean(agents));
  if (!provider || !agents) {
    logToFile(logFile, '[startDispatcher] SKIPPED: agents or kanban provider missing');
    return;
  }
  try {
    startDispatcherInner(ctx, config, storageDir, logFile, provider, agents);
  } catch (err) {
    logToFile(logFile, '[startDispatcher] FAILED: ' + String(err));
    console.error('[dsh-kanban][debug] startDispatcher failed: ' + String(err));
  }
}

/** 调度器装配主体（startDispatcher 的容错包裹内执行，异常落盘不阻断插件加载）。 */
function startDispatcherInner(
  ctx: Context,
  config: KanbanConfig,
  storageDir: string,
  logFile: string,
  provider: KanbanProvider,
  agents: unknown,
): void {
  const kanban = provider.service;
  const wiki = new WikiVaultClient(config.wikiVault);
  const defaultModel = resolveDefaultModel(ctx);
  console.info('[dsh-kanban] role default model = ' + (defaultModel ? defaultModel.provider + '/' + defaultModel.model : 'none'));
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
  // D23：链完成验收核对（重）——Chain(completed) 时核对主会话是否越权写工作区产物；
  // 发现越权 → chain/audit-warning，阻塞最终汇报直至用户 GUI 确认（chain/audit-confirmed）。
  const auditor = new ChainAuditor({
    kanban,
    workspacesRoot: join(storageDir, 'workspaces'),
    listLiveAgents: () => ((ctx.get('agents') as { list?(): Array<{ id: string; session?: { events: unknown[] } }> } | undefined)?.list?.() ?? []),
  });
  kanban.setOnChainCompleted(async (chainId) => {
    // 修复轮 7：传入本链发起工作区（Chain.workspaceDir），审计仅扫描该工作区内的会话，排除其他项目主会话
    const chainState = await kanban.snapshot();
    const workspaceDir = chainState.chains.get(chainId)?.workspaceDir ?? null;
    const evidence = await auditor.check(chainId, workspaceDir);
    if (evidence.length > 0) {
      console.warn('[dsh-kanban] chain audit warning: ' + chainId + ' evidence=' + evidence.length);
      await kanban.auditWarning(chainId, evidence, 'system');
    }
  });
  const waker = new EventWaker(ctx, config);
  waker.setWakeImpl(async (chainId) => { await vOrch.wakeV(chainId); saveOrchs(); });
  const runner = new AgentRunner(ctx, kanban, config, wiki, defaultModel);
  provider.runner = runner; // T32 fix：HTTP retry 复用同一执行器（failed→claim→spawn/resume）
  const watchdog = new Watchdog(kanban, config.dispatcher);
  const dispatcher = new Dispatcher({
    kanban,
    runner,
    waker,
    watchdog,
    maxRetries: config.dispatcher.maxRetries,
    stateFile: join(dirname(orchFile), 'dispatcher-state.json'), // 与事件日志同目录（B6）
    logFile,
  });
  (ctx as unknown as { on(name: string, fn: () => void): () => boolean }).on('dispose', () => { dispatcher.stop(); watchdog.stop(); });
  dispatcher.start(2000);
  watchdog.start(config.dispatcher.heartbeatIntervalSeconds * 1000);
  logToFile(logFile, '[startDispatcher] dispatcher started (tick=2000ms)');
  void dispatcher.tick();
}

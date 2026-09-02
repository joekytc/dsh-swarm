import type { Context } from '@deepseek-ai/cordis';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConfigProvider } from '../services/config-provider.js';
import { KanbanProvider } from '../services/kanban-provider.js';
import { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { EventWaker } from './event-waker.js';
import { VOrchestrator, type ChainOrchestration } from './v-orchestrator.js';
import { AgentRunner } from './agent-runner.js';
import { Watchdog } from './watchdog.js';
import { ChainAuditor } from './chain-auditor.js';
import { mergeDAfterReview } from './merge-gate.js';
import { buildSubagentTreeGuard } from '../roles/toolsets.js';
import { syncKbLinks } from '../wiki/kb-linkage.js';
import type { KanbanService } from '../domain/kanban-service.js';
import type { KanbanEvent, Task } from '../domain/types.js';

export interface AgentModelOptions {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** 读取部署默认模型（settings 的 agent-default-model 优先，其次 dsh-agent-default-model），角色未单独配置时回退使用。 */
export function resolveDefaultModel(ctx: Context): AgentModelOptions | undefined {
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

/** 修复轮 6：把 [dsh-swarm] 关键事件追加到 storageDir/dispatcher.log，便于无控制台时观测调度器状态。 */
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
    let loaded = loadLastSeq(this.stateFile) ?? -1;
    // 游标自愈：purge/renumber（整链硬删除物理重排 events.jsonl seq）或外部修复会把
    // 新事件 seq 压到旧游标之下，若不钳回，spec-card/approved 等可唤醒事件将被永久
    // 跳过 → V 永不建卡（2026-09-02 实测事故）。游标超前即视为状态文件失效，回退
    // 全量重放；重复唤醒由 wakeV B6 幂等与 done 卡不可变兜底。
    const maxSeq = state.events.length > 0 ? state.events[state.events.length - 1]!.seq : -1;
    if (loaded > maxSeq) {
      logToFile(this.logFile, '[tick] lastSeq=' + loaded + ' > maxSeq=' + maxSeq + ' (post-purge cursor skew) → rewind to -1 and replay');
      loaded = -1;
    }
    this.lastSeq = loaded;
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
      console.error('[dsh-swarm][debug] tick error: ' + String(e));
      logToFile(this.logFile, '[tick] error: ' + String(e));
    } finally {
      this.inFlight = false;
    }
  }

  start(intervalMs: number): void {
    this.stop();
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
  }

  /** 整链硬删除联动（E）：purge 物理重排 events.jsonl seq，游标必须同步钳到当前 maxSeq。
   *  否则删链后新建链的可唤醒事件（seq < 旧内存游标）被运行中实例永久跳过——A1 仅在启动时自愈，
   *  覆盖不了运行中删链场景（2026-09-02 残留审计结论）。 */
  async onPurge(): Promise<void> {
    const state = await this.kanban.snapshot();
    const maxSeq = state.events.length > 0 ? state.events[state.events.length - 1]!.seq : -1;
    this.lastSeq = maxSeq;
    saveLastSeq(this.stateFile, maxSeq);
    logToFile(this.logFile, '[onPurge] cursor synced to maxSeq=' + maxSeq);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

/** 调度层装配：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  仅在 agents 与 kanban 服务同时可用时由插件入口调用（不依赖可能已错过的 ready 事件）。
 *  Task 7：收 ConfigProvider——storageDir 取启动时快照；wiki/模型链经 getEffective() 调用时热读取。 */
/** 启动 reconcile（F）：剔除事件流中已不存在的链的编排 entry（历史残留/外部 purge）。
 *  原地删除并返回被移除的 chainId 列表（调用方负责持久化与日志）。 */
export function reconcileOrchestrations<T>(orch: Map<string, T>, chains: Set<string>): string[] {
  const removed = [...orch.keys()].filter((k) => !chains.has(k));
  for (const k of removed) orch.delete(k);
  return removed;
}

export function startDispatcher(ctx: Context, configProvider: ConfigProvider): void {
  const storageDir = configProvider.getEffective().storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd());
  const logFile = join(storageDir, 'dispatcher.log');
  const provider = ctx.get('kanban') as KanbanProvider | undefined;
  const agents = ctx.get('agents');
  logToFile(logFile, '[startDispatcher] invoked provider=' + Boolean(provider) + ' agents=' + Boolean(agents));
  if (!provider || !agents) {
    logToFile(logFile, '[startDispatcher] SKIPPED: agents or kanban provider missing');
    return;
  }
  try {
    startDispatcherInner(ctx, configProvider, storageDir, logFile, provider, agents);
  } catch (err) {
    logToFile(logFile, '[startDispatcher] FAILED: ' + String(err));
    console.error('[dsh-swarm][debug] startDispatcher failed: ' + String(err));
  }
}

/** 调度器装配主体（startDispatcher 的容错包裹内执行，异常落盘不阻断插件加载）。
 *  config = 启动时快照，仅喂静态依赖（EventWaker/Watchdog/maxRetries）；
 *  wiki 与模型链读点走 configProvider.getEffective() 热生效（Task 7）。 */
function startDispatcherInner(
  ctx: Context,
  configProvider: ConfigProvider,
  storageDir: string,
  logFile: string,
  provider: KanbanProvider,
  agents: unknown,
): void {
  const config = configProvider.getEffective();
  const kanban = provider.service;
  const wiki = new WikiVaultClient(() => configProvider.getEffective().wikiVault);
  const defaultModel = resolveDefaultModel(ctx);
  console.info('[dsh-swarm] role default model = ' + (defaultModel ? defaultModel.provider + '/' + defaultModel.model : 'none'));
  const orchFile = join(storageDir, 'orchestration.json');
  const orchestrations = new Map<string, ChainOrchestration>();
  try {
    const raw = JSON.parse(readFileSync(orchFile, 'utf8')) as Array<[string, ChainOrchestration]>;
    for (const [k, v] of raw) orchestrations.set(k, v);
  } catch { /* 首次启动无文件 */ }
  const saveOrchs = () => {
    try { writeFileSync(orchFile, JSON.stringify([...orchestrations.entries()], null, 2)); } catch { /* 忽略写失败 */ }
  };
  const vOrch = new VOrchestrator(ctx, kanban, agents as never, configProvider, orchestrations, wiki, defaultModel);
  // D23：链完成验收核对（重）——Chain(completed) 时核对主会话是否越权写工作区产物；
  // 发现越权 → chain/audit-warning，阻塞最终汇报直至用户 GUI 确认（chain/audit-confirmed）。
  const auditor = new ChainAuditor({
    kanban,
    workspacesRoot: join(storageDir, 'workspaces'),
    listLiveAgents: () => ((ctx.get('agents') as { list?(): Array<{ id: string; session?: { events: unknown[]; header?: { cwd?: string; agentPreset?: string } } }> } | undefined)?.list?.() ?? []),
  });
  kanban.setOnChainCompleted(async (chainId) => {
    // 修复轮 7：传入本链发起工作区（Chain.workspaceDir），审计仅扫描该工作区内的会话，排除其他项目主会话
    const chainState = await kanban.snapshot();
    const workspaceDir = chainState.chains.get(chainId)?.workspaceDir ?? null;
    const evidence = await auditor.check(chainId, workspaceDir);
    if (evidence.length > 0) {
      console.warn('[dsh-swarm] chain audit warning: ' + chainId + ' evidence=' + evidence.length);
      await kanban.auditWarning(chainId, evidence, 'system');
    }
    // 合入门控（architecture-review 建议1）：DT 通过后由 system 合入 TARGET_BRANCH；D 不再提前 merge/push。
    // 解析失败软跳过（[merge-skip]），合入失败记录 [merge-failed]，均不阻断收尾（坏代码未被合入 = 方向安全）。
    try {
      const r = await mergeDAfterReview(kanban, chainId, storageDir);
      if (r !== 'skipped') logToFile(logFile, '[merge-gate] chain=' + chainId + ' result=' + r);
    } catch (err) {
      console.error('[dsh-swarm][debug] merge gate failed ' + chainId + ': ' + String(err));
      logToFile(logFile, '[merge-gate] error chain=' + chainId + ' ' + String(err));
    }
  });
  // Q3&5：W2/W3(w:kb) 完成 → 机械互链登记（清单页 ↔ 计划页 ↔ 结果页）。
  // syncKbLinks 内部对 wiki 读写全容错，失败不阻塞完成；钩子本身再包一层 try（防御未来改动抛错）。
  kanban.setOnTaskCompleted(async (taskId) => {
    try {
      const snap = await kanban.snapshot();
      await syncKbLinks(wiki, snap, taskId);
    } catch (err) {
      console.error('[dsh-swarm][debug] kb linkage failed task=' + taskId + ': ' + String(err));
    }
  });
  const waker = new EventWaker(ctx, config);
  vOrch.onOrchChange = saveOrchs; // Fix D：stall re-wake 路径绕过 EventWaker，orch 变化自行落盘
  waker.setWakeImpl(async (chainId) => {
    try { await vOrch.wakeV(chainId); } catch (err) {
      console.error('[dsh-swarm][debug] wakeV error chain=' + chainId + ': ' + String(err));
    }
    saveOrchs();
  });
  // 0.1.0 delegation（spec FR2）：全局子代理写护栏——普通插件 ctx 上注册的 guard 全局
  // 生效（dsh-tools：普通上下文守卫全局生效，agent.ctx 守卫仅对该 agent 生效）。
  // guard 内部仅对 kanban-dt 系会话收紧；DT 父会话自身仍由 agent-runner 的 agent.ctx
  // guard 双保险。dispose 时注销。
  const toolsSvc = ctx.get('tools') as { guard?(g: unknown): () => void } | undefined;
  const unguardSubagents = toolsSvc?.guard?.(buildSubagentTreeGuard());
  if (unguardSubagents) {
    (ctx as unknown as { on(name: string, fn: () => void): () => boolean }).on('dispose', unguardSubagents);
  }
  const runner = new AgentRunner(ctx, kanban, configProvider, wiki, defaultModel);
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
  (ctx as unknown as { on(name: string, fn: () => void): () => boolean }).on('dispose', () => { dispatcher.stop(); watchdog.stop(); vOrch.dispose(); });
  dispatcher.start(2000);
  watchdog.start(config.dispatcher.heartbeatIntervalSeconds * 1000);
  logToFile(logFile, '[startDispatcher] dispatcher started (tick=2000ms)');
  void dispatcher.tick();
  // 整链硬删除联动（E/F/G-min）：purge 物理重排事件 seq → 游标同步钳回（运行中实例不重启发跳过）；
  // V 编排 entry 同步剔除。kanban-http 的 delete 分支调用 provider.onChainDeleted。
  provider.onChainDeleted = async (chainId: string) => {
    await dispatcher.onPurge();
    orchestrations.delete(chainId);
    saveOrchs();
    logToFile(logFile, '[chain-deleted] cursor synced + orch entry removed chain=' + chainId);
  };
  // 启动 reconcile（F）：历史残留/外部 purge 留下的死链编排 entry，按事件流存活链剔除
  void (async () => {
    try {
      const snap = await kanban.snapshot();
      const removed = reconcileOrchestrations(orchestrations, new Set(snap.chains.keys()));
      if (removed.length > 0) {
        saveOrchs();
        logToFile(logFile, '[orch-reconcile] removed dead entries: ' + removed.join(','));
      }
    } catch (err) { logToFile(logFile, '[orch-reconcile] failed: ' + String(err)); }
  })();
}

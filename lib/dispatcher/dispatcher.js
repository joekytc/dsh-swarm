import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { KanbanProvider } from '../services/kanban-provider.js';
import { WikiVaultClient } from '../wiki/wiki-vault-client.js';
import { LocalWikiClient } from '../wiki/local-kb-client.js';
import { ensureLocalKbRoot } from '../wiki/local-kb.js';
import { EventWaker } from './event-waker.js';
import { VOrchestrator } from './v-orchestrator.js';
import { AgentRunner } from './agent-runner.js';
import { Watchdog } from './watchdog.js';
import { ChainAuditor } from './chain-auditor.js';
import { mergeDAfterReview } from './merge-gate.js';
import { buildSubagentTreeGuard, buildSwarmSessionGuard } from '../roles/toolsets.js';
import { syncKbLinks } from '../wiki/kb-linkage.js';
/** 读取部署默认模型（settings 的 agent-default-model 优先，其次 dsh-agent-default-model），角色未单独配置时回退使用。 */
export function resolveDefaultModel(ctx) {
    try {
        const settings = ctx.get('settings');
        const m = settings?.get('agent-default-model');
        if (m?.provider && m?.model) {
            return m.reasoningEffort
                ? { provider: m.provider, model: m.model, reasoningEffort: m.reasoningEffort }
                : { provider: m.provider, model: m.model };
        }
    }
    catch {
        // settings 不可用则继续尝试 agentDefaultModel
    }
    try {
        const svc = ctx.get('agentDefaultModel');
        const sel = svc?.currentSelection();
        return sel?.provider && sel?.model ? sel : undefined;
    }
    catch {
        return undefined;
    }
}
function parentsDone(task, state) {
    return task.parents.every((pid) => {
        const parent = state.tasks.get(pid);
        return parent !== undefined && (parent.status === 'done' || parent.status === 'archived');
    });
}
/** B6：从状态文件恢复 lastSeq；无文件时回退到事件日志尾行（不重放旧事件重复唤醒 V）。 */
function loadLastSeq(stateFile) {
    try {
        const raw = JSON.parse(readFileSync(stateFile, 'utf8'));
        return typeof raw.lastSeq === 'number' ? raw.lastSeq : null;
    }
    catch {
        return null;
    }
}
function saveLastSeq(stateFile, lastSeq) {
    try {
        writeFileSync(stateFile, JSON.stringify({ lastSeq }));
    }
    catch { /* 忽略写失败：事件日志仍是事实源 */ }
}
/** 修复轮 6：把 [dsh-swarm] 关键事件追加到 storageDir/dispatcher.log，便于无控制台时观测调度器状态。 */
function logToFile(file, msg) {
    try {
        writeFileSync(file, new Date().toISOString() + ' ' + msg + '\n', { flag: 'a' });
    }
    catch { /* 忽略写失败 */ }
}
/** wakeImpl 装配（防线②，2026-09-04 mtmgp81q 死法教训）：wakeV 异常必须落盘 dispatcher.log——
 *  原实现仅 console.error，无控制台运行时零痕迹（排障最大障碍）。吞异常是为防 withTimeout
 *  超时后迟到的 rejection 变 unhandledRejection；onSettled（saveOrchs）无论成败都执行。 */
export function makeWakeImpl(wakeV, logFile, onSettled) {
    return async (chainId) => {
        try {
            await wakeV(chainId);
        }
        catch (err) {
            console.error('[dsh-swarm][debug] wakeV error chain=' + chainId + ': ' + String(err));
            logToFile(logFile, '[wakeV] error chain=' + chainId + ': ' + String(err));
        }
        onSettled();
    };
}
/** 修复轮 6：单次异步操作加超时护栏——一个挂起的 V 编排会话不得卡死整个调度器 tick。 */
function withTimeout(p, ms, label) {
    return Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: ' + label)), ms)),
    ]);
}
/** 防线①：链级进度看门狗阈值。tick=2000ms × 45 ticks = 90s 无进展即重唤醒（grill Q2 决议）。 */
export const STALL_WATCHDOG_TICKS = 45;
/** 防线①：链级重唤醒上限（grill Q3 决议：超限 [create-failed] + chain/blocked）。 */
export const STALL_WATCHDOG_REWAKE_LIMIT = 3;
/** 调度器：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  - B1：failed 且 attempts<maxRetries 的任务重派（claim→running，AgentRunner resume 同一会话）；
 *        attempts≥maxRetries 熔断 blocked(gave_up)。
 *  - B6：lastSeq 持久化，重启后仅唤醒 lastSeq 之后的事件。
 *  - R5：inFlight 互斥，防止慢 tick 与下一轮并发重复派发同一任务。 */
export class Dispatcher {
    kanban;
    runner;
    waker;
    watchdog;
    maxRetries;
    stateFile;
    logFile;
    agents; // Fix round 1：宿主 agents 注册表（热重载豁免判据）
    stallProbe;
    lastSeq = null; // null=尚未加载（首轮 tick 从状态文件/事件日志尾行恢复）
    orphanReconciled = false; // 启动 reconcile（G）一次性闸：仅首轮 tick 执行孤儿收敛
    inFlight = false;
    stallState = new Map();
    timer = null;
    constructor(deps) {
        this.kanban = deps.kanban;
        this.runner = deps.runner;
        this.waker = deps.waker;
        this.watchdog = deps.watchdog;
        this.maxRetries = deps.maxRetries;
        this.stateFile = deps.stateFile;
        this.logFile = deps.logFile;
        this.agents = deps.agents;
        this.stallProbe = deps.stallProbe;
    }
    async ensureLastSeq(state) {
        if (this.lastSeq !== null)
            return;
        // 修复轮 6：无状态文件（首次启动）时从 -1 起处理全部事件，避免跳过已存在的
        // chain/created / spec-card/approved 等可唤醒事件导致 V 永不建卡（B6 回归）。
        // 重放安全：VOrchestrator.wakeV 的 B6 幂等（已有匹配卡则跳过）保证不重复建卡。
        let loaded = loadLastSeq(this.stateFile) ?? -1;
        // 游标自愈：purge/renumber（整链硬删除物理重排 events.jsonl seq）或外部修复会把
        // 新事件 seq 压到旧游标之下，若不钳回，spec-card/approved 等可唤醒事件将被永久
        // 跳过 → V 永不建卡（2026-09-02 实测事故）。游标超前即视为状态文件失效，回退
        // 全量重放；重复唤醒由 wakeV B6 幂等与 done 卡不可变兜底。
        const maxSeq = state.events.length > 0 ? state.events[state.events.length - 1].seq : -1;
        if (loaded > maxSeq) {
            logToFile(this.logFile, '[tick] lastSeq=' + loaded + ' > maxSeq=' + maxSeq + ' (post-purge cursor skew) → rewind to -1 and replay');
            loaded = -1;
        }
        this.lastSeq = loaded;
        logToFile(this.logFile, '[tick] initial lastSeq=' + this.lastSeq);
    }
    async tick() {
        if (this.inFlight)
            return; // R5：防重叠 tick 并发派发同一任务
        this.inFlight = true;
        try {
            const state = await this.kanban.snapshot();
            await this.ensureLastSeq(state);
            // 启动 reconcile（G）：仅首轮执行，位置在游标自愈之后、正常事件消费之前——
            // 游标 rewind 可能全量重放旧事件，必须先把上次进程遗留的 running 孤儿卡收敛为 blocked，
            // 消除「进程重启 → whenIdle 协程死亡 → 卡 running 悬挂到看门狗 4h」的口子。
            if (!this.orphanReconciled) {
                this.orphanReconciled = true;
                await reconcileOrphanRunningTasks(this.kanban, state.tasks.values(), this.logFile, this.agents);
            }
            let advanced = false;
            for (const ev of state.events) {
                if (ev.seq > this.lastSeq) {
                    this.lastSeq = ev.seq;
                    advanced = true;
                    try {
                        await withTimeout(this.waker.onEvent(ev), 60_000, 'wakeV ev=' + ev.seq + ' chain=' + ev.chainId);
                    }
                    catch (err) {
                        logToFile(this.logFile, '[tick] wakeV failed ev=' + ev.seq + ' chain=' + ev.chainId + ': ' + String(err));
                    }
                }
            }
            if (advanced)
                saveLastSeq(this.stateFile, this.lastSeq);
            for (const t of state.tasks.values()) {
                if (!parentsDone(t, state))
                    continue;
                if (t.status === 'ready' || t.status === 'todo') {
                    await this.runner.runTask(t.id);
                }
                else if (t.status === 'failed' && t.attempts < this.maxRetries) {
                    // B1：failed 重派——AgentRunner 内 claim→running + resume 同一会话
                    await this.runner.runTask(t.id);
                }
                else if (t.status === 'failed') {
                    // B1：attempts≥maxRetries 熔断 blocked(gave_up)，人工介入
                    await this.kanban.blockTask(t.id, 'gave_up: max retries', 'system');
                }
            }
            await this.watchdog.tick();
            await this.chainStallWatchdog(state);
        }
        catch (e) {
            console.error('[dsh-swarm][debug] tick error: ' + String(e));
            logToFile(this.logFile, '[tick] error: ' + String(e));
        }
        finally {
            this.inFlight = false;
        }
    }
    /** 防线①：链级进度看门狗（与 wakeVInner 内建 stall 互补，后者挂在 wakeVInner 内部，
     *  异常退出/挂起/未触发时失效——2026-09-04 mtmgp81q）。只看最终事实：
     *  executing 非 summary + 链上零非终态任务卡 + 无在途唤醒 + 本链无新看板事件，
     *  持续 STALL_WATCHDOG_TICKS 个 tick → 重唤醒（≤STALL_WATCHDOG_REWAKE_LIMIT 次）→
     *  仍停滞 → [create-failed] 评论（有锚点卡时）+ blockChain 终态（人工恢复=删链重跑）。 */
    async chainStallWatchdog(state) {
        if (!this.stallProbe)
            return;
        for (const chain of state.chains.values()) {
            if (chain.status !== 'executing') {
                this.stallState.delete(chain.id);
                continue;
            }
            const orch = this.stallProbe.orchestrationOf(chain.id);
            if (!orch || orch.phase === 'summary') {
                this.stallState.delete(chain.id);
                continue;
            }
            const seen = this.stallState.get(chain.id) ?? { ticks: 0, rewakes: 0, lastSeq: -1 };
            const set = () => this.stallState.set(chain.id, seen);
            // 本链最新事件 seq：有新事件 = 链有活动（任何 kind，含评论/心跳）。
            // 重置计数后不 continue：无新事件的首个观测 tick 即停滞计数起点（否则 45 tick 只累计 44，
            // 与 brief 测试「STALL_WATCHDOG_TICKS 个 tick → 重唤醒」差一拍——实测 2026-09-04）。
            let chainMaxSeq = -1;
            for (let i = state.events.length - 1; i >= 0; i--) {
                const e = state.events[i];
                if (e.chainId === chain.id) {
                    chainMaxSeq = e.seq;
                    break;
                }
            }
            if (chainMaxSeq > seen.lastSeq) {
                seen.lastSeq = chainMaxSeq;
                seen.ticks = 0;
                set();
            }
            if (this.stallProbe.isWakeInFlight(chain.id)) {
                seen.ticks = 0;
                set();
                continue;
            }
            const chainTasks = [...state.tasks.values()].filter((t) => t.chainId === chain.id);
            if (chainTasks.some((t) => t.status !== 'done' && t.status !== 'archived')) {
                seen.ticks = 0;
                set();
                continue;
            }
            seen.ticks += 1;
            if (seen.ticks < STALL_WATCHDOG_TICKS) {
                set();
                continue;
            }
            if (seen.rewakes < STALL_WATCHDOG_REWAKE_LIMIT) {
                seen.rewakes += 1;
                seen.ticks = 0;
                set();
                logToFile(this.logFile, `[stall-watchdog] zero-progress chain=${chain.id} phase=${orch.phase} → rewake ${seen.rewakes}/${STALL_WATCHDOG_REWAKE_LIMIT}`);
                this.stallProbe.wake(chain.id).catch((err) => logToFile(this.logFile, '[stall-watchdog] wake failed chain=' + chain.id + ': ' + String(err)));
                continue;
            }
            // 终态显形
            const anchor = chainTasks.at(-1);
            if (anchor) {
                const already = state.events.some((e) => e.taskId === anchor.id && e.kind === 'task/commented' && String(e.payload['body'] ?? '').startsWith('[create-failed]'));
                if (!already) {
                    try {
                        await this.kanban.comment(anchor.id, `[create-failed] 看门狗：链持续无进展且自动重唤醒 ${STALL_WATCHDOG_REWAKE_LIMIT} 次未建卡（phase=${orch.phase}），已置 blocked，请人工处理。`, 'system');
                    }
                    catch (err) {
                        logToFile(this.logFile, '[stall-watchdog] comment failed chain=' + chain.id + ': ' + String(err));
                    }
                }
            }
            try {
                await this.kanban.blockChain(chain.id, `[stall-watchdog] phase=${orch.phase} 持续无进展，重唤醒 ${STALL_WATCHDOG_REWAKE_LIMIT} 次未建卡`);
            }
            catch (err) {
                logToFile(this.logFile, '[stall-watchdog] blockChain failed chain=' + chain.id + ': ' + String(err));
            }
            logToFile(this.logFile, `[stall-watchdog] chain=${chain.id} → blocked`);
            this.stallState.delete(chain.id);
        }
    }
    start(intervalMs) {
        this.stop();
        this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    }
    /** 整链硬删除联动（E）：purge 物理重排 events.jsonl seq，游标必须同步钳到当前 maxSeq。
     *  否则删链后新建链的可唤醒事件（seq < 旧内存游标）被运行中实例永久跳过——A1 仅在启动时自愈，
     *  覆盖不了运行中删链场景（2026-09-02 残留审计结论）。 */
    async onPurge() {
        const state = await this.kanban.snapshot();
        const maxSeq = state.events.length > 0 ? state.events[state.events.length - 1].seq : -1;
        this.lastSeq = maxSeq;
        saveLastSeq(this.stateFile, maxSeq);
        logToFile(this.logFile, '[onPurge] cursor synced to maxSeq=' + maxSeq);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
/** 调度层装配：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  仅在 agents 与 kanban 服务同时可用时由插件入口调用（不依赖可能已错过的 ready 事件）。
 *  Task 7：收 ConfigProvider——storageDir 取启动时快照；wiki/模型链经 getEffective() 调用时热读取。 */
/** 启动 reconcile（F）：剔除事件流中已不存在的链的编排 entry（历史残留/外部 purge）。
 *  原地删除并返回被移除的 chainId 列表（调用方负责持久化与日志）。 */
export function reconcileOrchestrations(orch, chains) {
    const removed = [...orch.keys()].filter((k) => !chains.has(k));
    for (const k of removed)
        orch.delete(k);
    return removed;
}
/** 启动 reconcile（G）：进程重启会杀死 runner 的 whenIdle 协程，上次遗留的 running 卡无人收尾，
 *  看门狗默认 4h（staleTimeoutSeconds=14400）才回收——重启后立即把 running 孤儿卡收敛为 blocked
 *  （system comment + blockTask），中断显形且可重派续跑（重派将 resume 同一会话，进度保留）。
 *  状态机注：TaskStatus 无独立 'claimed' 态——claimTask 发 task/claimed 事件后投影即为 running，
 *  扫描 running 即覆盖「claimed 未收尾」；todo/ready/triage 从未派发，done/blocked/failed/archived
 *  已有归属或终态（且 failed 的处置归 B1 重派/熔断管辖），均不动。
 *  Fix round 1（热重载兼容，双重判据）：收敛每张 running 卡前先查宿主 agents 注册表
 *  ctx.get('agents').get('kbn-<taskId>')（session id 构造同 AgentRunner.resumeOrReuse，Task 2 同款探明）。
 *  两个世界的分野：
 *  - 进程重启：agents 注册表随宿主进程消亡，新进程内 kbn-<taskId> 必然查不到（undefined）
 *    → 会话已死 → 全部收敛，语义与修复前一致；
 *  - 插件热重载：宿主进程未死，dsh 插件重载重跑 startDispatcherInner → orphanReconciled 闸复位，
 *    但宿主 agent 会话仍 live（注册表命中）→ 本进程真在跑，不是孤儿 → 跳过该卡，
 *    避免把合法 running 卡误收敛为 blocked。
 *  agents 服务缺失 / 无 get 方法（测试桩/异常宿主）→ 无法证明 live，按原行为收敛（保守）。
 *  调用位置必须在游标自愈（ensureLastSeq）之后、事件消费之前：游标 rewind 会全量重放旧事件，
 *  先收敛孤儿可保证本次 tick 消费的重放事件面对的是已收敛状态，且孤儿产生的 block 事件天然
 *  落在本轮快照之外（下一轮才被消费唤醒 V 走阻塞复核），不与启动重放交错。
 *  幂等：仅启动执行一次（调用方置闸）；对同一卡重复调用时状态机拒绝 running→blocked 之外的
 *  非法转换，comment/block 失败均 try/catch 记日志跳过不抛（单卡失败不阻断其余收敛）。 */
export async function reconcileOrphanRunningTasks(kanban, tasks, logFile, agents) {
    const orphans = [...tasks].filter((t) => t.status === 'running');
    const agentsSvc = agents;
    const handled = [];
    for (const t of orphans) {
        const live = typeof agentsSvc?.get === 'function' ? agentsSvc.get('kbn-' + t.id) : undefined;
        if (live) {
            // 宿主注册表命中 → 会话仍 live（热重载世界），本进程真在跑，跳过不收敛
            logToFile(logFile, '[orphan-reconcile] skip live session task=' + t.id + ' (host reload, session alive)');
            continue;
        }
        try {
            await kanban.comment(t.id, '[runner-interrupted] dsh 重启中断会话，置为阻塞以便重派续跑（进度保留，重派将 resume 同会话）', 'system');
        }
        catch (err) {
            // comment 无状态语义且恒放行，失败仅可能是存储层异常——记日志后仍继续 block
            logToFile(logFile, '[orphan-reconcile] comment failed task=' + t.id + ': ' + String(err));
        }
        try {
            await kanban.blockTask(t.id, 'runner-interrupted: 进程重启，会话中断', 'system');
            handled.push(t.id);
        }
        catch (err) {
            // 防御：状态机拒绝（卡恰被并发流转/已收敛）→ 记日志跳过，不抛
            logToFile(logFile, '[orphan-reconcile] block failed task=' + t.id + ': ' + String(err));
        }
    }
    if (handled.length > 0) {
        logToFile(logFile, '[orphan-reconcile] reconciled orphan running tasks: ' + handled.join(','));
    }
    return handled;
}
export function startDispatcher(ctx, configProvider) {
    const storageDir = configProvider.getEffective().storageDir.replace('$DSH_HOME', process.env.DSH_HOME ?? process.cwd());
    const logFile = join(storageDir, 'dispatcher.log');
    const provider = ctx.get('kanban');
    const agents = ctx.get('agents');
    logToFile(logFile, '[startDispatcher] invoked provider=' + Boolean(provider) + ' agents=' + Boolean(agents));
    if (!provider || !agents) {
        logToFile(logFile, '[startDispatcher] SKIPPED: agents or kanban provider missing');
        return;
    }
    try {
        startDispatcherInner(ctx, configProvider, storageDir, logFile, provider, agents);
    }
    catch (err) {
        logToFile(logFile, '[startDispatcher] FAILED: ' + String(err));
        console.error('[dsh-swarm][debug] startDispatcher failed: ' + String(err));
    }
}
/** 调度器装配主体（startDispatcher 的容错包裹内执行，异常落盘不阻断插件加载）。
 *  config = 启动时快照，仅喂静态依赖（EventWaker/Watchdog/maxRetries）；
 *  wiki 与模型链读点走 configProvider.getEffective() 热生效（Task 7）。 */
function startDispatcherInner(ctx, configProvider, storageDir, logFile, provider, agents) {
    const config = configProvider.getEffective();
    const kanban = provider.service;
    // D2 双模式：local 走 LocalWikiClient（互链读写落本地库），remote 用配置的 WikiVaultClient（Task 10 同款分支）。
    // 消费方（AgentRunner/VOrchestrator）字段仍标 WikiVaultClient——local 为 LocalWikiClient（read/write/search 同面），Task 10 同款断言。
    const wiki = (configProvider.mode === 'local'
        ? new LocalWikiClient(ensureLocalKbRoot())
        : new WikiVaultClient(() => configProvider.getEffective().wikiVault));
    const defaultModel = resolveDefaultModel(ctx);
    console.info('[dsh-swarm] role default model = ' + (defaultModel ? defaultModel.provider + '/' + defaultModel.model : 'none'));
    const orchFile = join(storageDir, 'orchestration.json');
    const orchestrations = new Map();
    try {
        const raw = JSON.parse(readFileSync(orchFile, 'utf8'));
        for (const [k, v] of raw)
            orchestrations.set(k, v);
    }
    catch { /* 首次启动无文件 */ }
    const saveOrchs = () => {
        try {
            writeFileSync(orchFile, JSON.stringify([...orchestrations.entries()], null, 2));
        }
        catch { /* 忽略写失败 */ }
    };
    const vOrch = new VOrchestrator(ctx, kanban, agents, configProvider, orchestrations, wiki, defaultModel);
    // D23：链完成验收核对（重）——Chain(completed) 时核对主会话是否越权写工作区产物；
    // 发现越权 → chain/audit-warning，阻塞最终汇报直至用户 GUI 确认（chain/audit-confirmed）。
    const auditor = new ChainAuditor({
        kanban,
        workspacesRoot: join(storageDir, 'workspaces'),
        listLiveAgents: () => (ctx.get('agents')?.list?.() ?? []),
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
            if (r !== 'skipped')
                logToFile(logFile, '[merge-gate] chain=' + chainId + ' result=' + r);
        }
        catch (err) {
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
        }
        catch (err) {
            console.error('[dsh-swarm][debug] kb linkage failed task=' + taskId + ': ' + String(err));
        }
    });
    const waker = new EventWaker(ctx, config);
    vOrch.onOrchChange = saveOrchs; // Fix D：stall re-wake 路径绕过 EventWaker，orch 变化自行落盘
    waker.setWakeImpl(makeWakeImpl(vOrch.wakeV.bind(vOrch), logFile, saveOrchs));
    // 0.1.0 delegation（spec FR2）：全局子代理写护栏——普通插件 ctx 上注册的 guard 全局
    // 生效（dsh-tools：普通上下文守卫全局生效，agent.ctx 守卫仅对该 agent 生效）。
    // guard 内部仅对 kanban-dt 系会话收紧；DT 父会话自身仍由 agent-runner 的 agent.ctx
    // guard 双保险。dispose 时注销。
    const toolsSvc = ctx.get('tools');
    const unguardSubagents = toolsSvc?.guard?.(buildSubagentTreeGuard());
    if (unguardSubagents) {
        ctx.on('dispose', unguardSubagents);
    }
    // 蜂群模式硬闸（swarm-mode-design §7）：header.agentPreset==='swarm' 时只读+git 反选拦截；
    // 内部对其余会话恒放行。dispose 时注销（与 subagent guard 同款）。
    const unguardSwarm = toolsSvc?.guard?.(buildSwarmSessionGuard());
    if (unguardSwarm) {
        ctx.on('dispose', unguardSwarm);
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
        agents, // Fix round 1：启动 reconcile 热重载豁免判据（宿主 agents 注册表）
        stallProbe: vOrch, // 防线①：链级停滞探针（orchestrationOf/isWakeInFlight/wake）
    });
    ctx.on('dispose', () => { dispatcher.stop(); watchdog.stop(); vOrch.dispose(); });
    dispatcher.start(2000);
    watchdog.start(config.dispatcher.heartbeatIntervalSeconds * 1000);
    logToFile(logFile, '[startDispatcher] dispatcher started (tick=2000ms)');
    void dispatcher.tick();
    // 整链硬删除联动（E/F/G-min）：purge 物理重排事件 seq → 游标同步钳回（运行中实例不重启发跳过）；
    // V 编排 entry 同步剔除。kanban-http 的 delete 分支调用 provider.onChainDeleted。
    provider.onChainDeleted = async (chainId) => {
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
        }
        catch (err) {
            logToFile(logFile, '[orch-reconcile] failed: ' + String(err));
        }
    })();
}

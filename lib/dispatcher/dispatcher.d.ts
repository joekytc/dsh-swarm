import type { Context } from '@deepseek-ai/cordis';
import type { ConfigProvider } from '../services/config-provider.js';
import { EventWaker } from './event-waker.js';
import { Watchdog } from './watchdog.js';
import type { KanbanService } from '../domain/kanban-service.js';
import type { Task } from '../domain/types.js';
export interface AgentModelOptions {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
/** 读取部署默认模型（settings 的 agent-default-model 优先，其次 dsh-agent-default-model），角色未单独配置时回退使用。 */
export declare function resolveDefaultModel(ctx: Context): AgentModelOptions | undefined;
export interface DispatcherDeps {
    kanban: KanbanService;
    runner: {
        runTask(taskId: string): Promise<void>;
    };
    waker: EventWaker;
    watchdog: Watchdog;
    maxRetries: number;
    /** lastSeq 持久化文件（与事件日志同目录，B6）。 */
    stateFile: string;
    /** 修复轮 6：调度器运行日志文件（storageDir/dispatcher.log）。 */
    logFile: string;
    /** Fix round 1：宿主 agents 注册表（ctx.get('agents')）——启动 reconcile 判别 kbn-<taskId>
     *  会话是否仍 live（插件热重载豁免）；缺省/无 get 方法时按原行为收敛（保守）。 */
    agents?: unknown;
    /** 防线①：链级停滞探针（生产传 VOrchestrator；测试传桩）。缺省=看门狗关闭（行为同旧）。 */
    stallProbe?: {
        orchestrationOf(chainId: string): {
            phase: string;
        } | null;
        isWakeInFlight(chainId: string): boolean;
        wake(chainId: string): Promise<void>;
    };
}
/** wakeImpl 装配（防线②，2026-09-04 mtmgp81q 死法教训）：wakeV 异常必须落盘 dispatcher.log——
 *  原实现仅 console.error，无控制台运行时零痕迹（排障最大障碍）。吞异常是为防 withTimeout
 *  超时后迟到的 rejection 变 unhandledRejection；onSettled（saveOrchs）无论成败都执行。 */
export declare function makeWakeImpl(wakeV: (chainId: string) => Promise<void>, logFile: string, onSettled: () => void): (chainId: string) => Promise<void>;
/** 防线①：链级进度看门狗阈值。tick=2000ms × 45 ticks = 90s 无进展即重唤醒（grill Q2 决议）。 */
export declare const STALL_WATCHDOG_TICKS = 45;
/** 防线①：链级重唤醒上限（grill Q3 决议：超限 [create-failed] + chain/blocked）。 */
export declare const STALL_WATCHDOG_REWAKE_LIMIT = 3;
/** 调度器：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  - B1：failed 且 attempts<maxRetries 的任务重派（claim→running，AgentRunner resume 同一会话）；
 *        attempts≥maxRetries 熔断 blocked(gave_up)。
 *  - B6：lastSeq 持久化，重启后仅唤醒 lastSeq 之后的事件。
 *  - R5：inFlight 互斥，防止慢 tick 与下一轮并发重复派发同一任务。 */
export declare class Dispatcher {
    private readonly kanban;
    private readonly runner;
    private readonly waker;
    private readonly watchdog;
    private readonly maxRetries;
    private readonly stateFile;
    private readonly logFile;
    private readonly agents;
    private readonly stallProbe;
    private lastSeq;
    private orphanReconciled;
    private inFlight;
    private stallState;
    private timer;
    constructor(deps: DispatcherDeps);
    private ensureLastSeq;
    tick(): Promise<void>;
    /** 防线①：链级进度看门狗（与 wakeVInner 内建 stall 互补，后者挂在 wakeVInner 内部，
     *  异常退出/挂起/未触发时失效——2026-09-04 mtmgp81q）。只看最终事实：
     *  executing 非 summary + 链上零非终态任务卡 + 无在途唤醒 + 本链无新看板事件，
     *  持续 STALL_WATCHDOG_TICKS 个 tick → 重唤醒（≤STALL_WATCHDOG_REWAKE_LIMIT 次）→
     *  仍停滞 → [create-failed] 评论（有锚点卡时）+ blockChain 终态（人工恢复=删链重跑）。 */
    private chainStallWatchdog;
    start(intervalMs: number): void;
    /** 整链硬删除联动（E）：purge 物理重排 events.jsonl seq，游标必须同步钳到当前 maxSeq。
     *  否则删链后新建链的可唤醒事件（seq < 旧内存游标）被运行中实例永久跳过——A1 仅在启动时自愈，
     *  覆盖不了运行中删链场景（2026-09-02 残留审计结论）。 */
    onPurge(): Promise<void>;
    stop(): void;
}
/** 调度层装配：事件唤醒 V（R20 逐阶段建卡）+ 每任务一次性角色 agent + 心跳看门狗。
 *  仅在 agents 与 kanban 服务同时可用时由插件入口调用（不依赖可能已错过的 ready 事件）。
 *  Task 7：收 ConfigProvider——storageDir 取启动时快照；wiki/模型链经 getEffective() 调用时热读取。 */
/** 启动 reconcile（F）：剔除事件流中已不存在的链的编排 entry（历史残留/外部 purge）。
 *  原地删除并返回被移除的 chainId 列表（调用方负责持久化与日志）。 */
export declare function reconcileOrchestrations<T>(orch: Map<string, T>, chains: Set<string>): string[];
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
export declare function reconcileOrphanRunningTasks(kanban: KanbanService, tasks: Iterable<Task>, logFile: string, agents?: unknown): Promise<string[]>;
export declare function startDispatcher(ctx: Context, configProvider: ConfigProvider): void;

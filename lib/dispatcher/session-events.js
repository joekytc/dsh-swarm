// src/dispatcher/session-events.ts
/**
 * 会话事件条目统一读取助手：
 * 0.1.2（DSH-0.1.2-A4-03）起 Session.events getter 已移除——宿主新读取面是
 * `session.seq`（日志长度）+ `session.snapshotEvents(fromSeq?, toSeqExclusive?)`。
 * 事件条目形态（落盘与快照一致）为 { type, seq, time, data: { ... } }（append 时
 * name/arguments 位于 e.data 下而非顶层）。
 * 本助手兼容两种形态（顶层展开 / data 嵌套），供 v-orchestrator / agent-runner / chain-auditor
 * 等所有消费点使用（先 snapshotEvents()、无则回退 events、再 []），避免逐个踩 `e.name 取不到` 的坑。
 */
/** 取事件类型（如 'tool/call'）。 */
export function eventType(e) {
    const t = e?.type ?? e?.data?.type;
    return typeof t === 'string' ? t : undefined;
}
/** 取工具调用名（如 'kanban_complete' / 'bash' / 'kanban_create'）。 */
export function toolName(e) {
    const rec = e;
    const n = rec?.name ?? rec?.data?.name;
    return typeof n === 'string' ? n : undefined;
}
/** 取工具调用参数对象（兼容 JSON 字符串 / 对象两种落盘形态）。 */
export function toolArgs(e) {
    const rec = e;
    const a = rec?.arguments ?? rec?.data?.arguments;
    if (a && typeof a === 'object')
        return a;
    if (typeof a === 'string') {
        try {
            return JSON.parse(a);
        }
        catch {
            return {};
        }
    }
    return {};
}
/** run_code 派发子调用事件名（start 与完成两种）新旧宿主双名集合：
 *  旧宿主会话落盘为 tool/code-dispatch-start / tool/code-dispatch；
 *  宿主 V3+ 会话格式改名为 tool/ptc-dispatch-start / tool/ptc-dispatch。
 *  消费方（链审计器按派发子调用判定 run_code 实际写行为）双名等价命中，勿散落硬编码。 */
export const RUN_CODE_DISPATCH_EVENT_TYPES = new Set([
    'tool/code-dispatch-start',
    'tool/code-dispatch',
    'tool/ptc-dispatch-start',
    'tool/ptc-dispatch',
]);
/** 该事件是否为 run_code 派发子调用事件（start 或完成，新旧事件名皆认）。 */
export function isRunCodeDispatchEvent(e) {
    const t = eventType(e);
    return t !== undefined && RUN_CODE_DISPATCH_EVENT_TYPES.has(t);
}
/** 取 assistant 消息的网关缓存回放标记（replayState.response.responseModel，如 'from-cache'）。
 *  非 assistant/message 或无标记返回 null。2026-09-04：远程网关回复缓存整包回放时由 SSE
 *  id/model 字段透传（dsh 纯透传），插件侧据此识别缓存劫持零产出。兼容落盘（data.message）
 *  与 live 内存（顶层 message）两种形态。 */
export function replayModel(e) {
    const rec = e;
    const m = rec?.data?.message?.source?.replayState?.response?.responseModel
        ?? rec?.message?.source?.replayState?.response?.responseModel;
    return typeof m === 'string' ? m : null;
}
/** 网关合成拒答/缓存回放标记集（usage 全 0，非真实模型输出）：
 *  - from-cache：Higress 语义缓存命中（网关侧可用请求头 x-higress-skip-ai-cache: on 跳过，2026-09-22 网关团队确认）
 *  - from-security-guard：安全护栏合成拒答（销服一体 W2 卡会话 5 例实证，responseId 可供网关审计）
 *  角色会话拿到合成文本会当结论空闲退出（protocol_violation 源头之一），必须识别。 */
export const GUARD_SYNTH_REPLAY_MODELS = new Set(['from-cache', 'from-security-guard']);
/** 该事件是否为网关合成拒答/缓存回放的 assistant 消息（判定与标记集单一事实源）。 */
export function isGuardSynthesizedReply(e) {
    const m = replayModel(e);
    return m !== null && GUARD_SYNTH_REPLAY_MODELS.has(m);
}
export function turnEndOf(e) {
    const rec = e;
    const t = rec?.type ?? rec?.data?.type;
    if (t !== 'turn/end')
        return null;
    const reason = rec?.data?.reason ?? rec?.reason;
    const kind = typeof reason?.kind === 'string' ? reason.kind : null;
    if (!kind)
        return null;
    return {
        turn: Number(rec?.data?.turn ?? rec?.turn) || 0,
        kind,
        code: typeof reason?.error?.code === 'string' ? reason.error.code : null,
        message: typeof reason?.error?.message === 'string' ? reason.error.message : null,
    };
}
/** 会话内最后一次 agent-preset/selected 的 preset id（如 'kanban-w'）；无该事件返回 null。 */
export function agentPresetSelected(events) {
    let found = null;
    for (const e of events) {
        if (eventType(e) !== 'agent-preset/selected')
            continue;
        const rec = e;
        const p = rec?.agentPreset ?? rec?.data?.agentPreset;
        if (typeof p === 'string')
            found = p;
    }
    return found;
}
/** 本轮增量（seq > fromSeq）内最后一轮 turn/end——拒答重试会产生第二轮，取 seq 最大者。
 *  无 turn/end（测试桩/宿主变体）→ null，调用方按「无轮信息」回退原判据，不改变既有行为。 */
export function lastTurnEnd(events, fromSeq) {
    let best = null;
    let bestSeq = -1;
    for (const e of events) {
        const rec = e;
        const seq = Number(rec?.seq ?? rec?.data?.seq) || 0;
        if (seq <= fromSeq)
            continue;
        const info = turnEndOf(e);
        if (info && seq >= bestSeq) {
            best = info;
            bestSeq = seq;
        }
    }
    return best;
}

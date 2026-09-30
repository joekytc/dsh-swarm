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
export function eventType(e: { type?: unknown; data?: { type?: unknown } }): string | undefined {
  const t = e?.type ?? e?.data?.type;
  return typeof t === 'string' ? t : undefined;
}

/** 取工具调用名（如 'kanban_complete' / 'bash' / 'kanban_create'）。 */
export function toolName(e: unknown): string | undefined {
  const rec = e as { name?: unknown; data?: { name?: unknown } } | null;
  const n = rec?.name ?? rec?.data?.name;
  return typeof n === 'string' ? n : undefined;
}

/** 取工具调用参数对象（兼容 JSON 字符串 / 对象两种落盘形态）。 */
export function toolArgs(e: unknown): Record<string, unknown> {
  const rec = e as { arguments?: unknown; data?: { arguments?: unknown } } | null;
  const a = rec?.arguments ?? rec?.data?.arguments;
  if (a && typeof a === 'object') return a as Record<string, unknown>;
  if (typeof a === 'string') {
    try { return JSON.parse(a) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

/** 取 assistant 消息的网关缓存回放标记（replayState.response.responseModel，如 'from-cache'）。
 *  非 assistant/message 或无标记返回 null。2026-09-04：远程网关回复缓存整包回放时由 SSE
 *  id/model 字段透传（dsh 纯透传），插件侧据此识别缓存劫持零产出。兼容落盘（data.message）
 *  与 live 内存（顶层 message）两种形态。 */
export function replayModel(e: unknown): string | null {
  const rec = e as { message?: { source?: { replayState?: { response?: { responseModel?: unknown } } } }; data?: { message?: { source?: { replayState?: { response?: { responseModel?: unknown } } } } } } | null;
  const m = rec?.data?.message?.source?.replayState?.response?.responseModel
    ?? rec?.message?.source?.replayState?.response?.responseModel;
  return typeof m === 'string' ? m : null;
}

/** 网关合成拒答/缓存回放标记集（usage 全 0，非真实模型输出）：
 *  - from-cache：Higress 语义缓存命中（网关侧可用请求头 x-higress-skip-ai-cache: on 跳过，2026-09-22 网关团队确认）
 *  - from-security-guard：安全护栏合成拒答（销服一体 W2 卡会话 5 例实证，responseId 可供网关审计）
 *  角色会话拿到合成文本会当结论空闲退出（protocol_violation 源头之一），必须识别。 */
export const GUARD_SYNTH_REPLAY_MODELS: ReadonlySet<string> = new Set(['from-cache', 'from-security-guard']);

/** 该事件是否为网关合成拒答/缓存回放的 assistant 消息（判定与标记集单一事实源）。 */
export function isGuardSynthesizedReply(e: unknown): boolean {
  const m = replayModel(e);
  return m !== null && GUARD_SYNTH_REPLAY_MODELS.has(m);
}

/** turn/end 结束原因（区分「环境错误秒退」与「角色正常收敛」的单一读取点）：
 *  落盘形态 {"type":"turn/end","seq":N,"data":{"turn":T,"reason":{"kind":"completed"} |
 *  {"kind":"error","error":{"code":"UNKNOWN_MODEL","message":"…"}}}}；
 *  live 顶层展开形态经顶层 turn/reason 兜底兼容。非 turn/end 或 reason 不可读 → null。 */
export interface TurnEndInfo { turn: number; kind: string; code: string | null; message: string | null }

export function turnEndOf(e: unknown): TurnEndInfo | null {
  const rec = e as {
    type?: unknown;
    data?: { type?: unknown; turn?: unknown; reason?: { kind?: unknown; error?: { code?: unknown; message?: unknown } } };
    turn?: unknown;
    reason?: { kind?: unknown; error?: { code?: unknown; message?: unknown } };
  } | null;
  const t = rec?.type ?? rec?.data?.type;
  if (t !== 'turn/end') return null;
  const reason = rec?.data?.reason ?? rec?.reason;
  const kind = typeof reason?.kind === 'string' ? reason.kind : null;
  if (!kind) return null;
  return {
    turn: Number(rec?.data?.turn ?? rec?.turn) || 0,
    kind,
    code: typeof reason?.error?.code === 'string' ? reason.error.code : null,
    message: typeof reason?.error?.message === 'string' ? reason.error.message : null,
  };
}

/** 本轮增量（seq > fromSeq）内最后一轮 turn/end——拒答重试会产生第二轮，取 seq 最大者。
 *  无 turn/end（测试桩/宿主变体）→ null，调用方按「无轮信息」回退原判据，不改变既有行为。 */
export function lastTurnEnd(events: ReadonlyArray<unknown>, fromSeq: number): TurnEndInfo | null {
  let best: TurnEndInfo | null = null;
  let bestSeq = -1;
  for (const e of events) {
    const rec = e as { seq?: unknown; data?: { seq?: unknown } } | null;
    const seq = Number(rec?.seq ?? rec?.data?.seq) || 0;
    if (seq <= fromSeq) continue;
    const info = turnEndOf(e);
    if (info && seq >= bestSeq) { best = info; bestSeq = seq; }
  }
  return best;
}

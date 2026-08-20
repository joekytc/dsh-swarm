// src/dispatcher/session-events.ts
/**
 * 会话事件条目统一读取助手（修复轮 6，举一反三）：
 * dsh-session 的 session.events 条目落盘形态为 { type, seq, time, data: { ... } }（append 时
 * data 嵌套在 data 键下），name/arguments 等字段位于 e.data 下而非顶层。
 * 本助手兼容两种形态（顶层展开 / data 嵌套），供 v-orchestrator / agent-runner / chain-auditor
 * 等所有读取 agent.session.events 的消费点使用，避免逐个踩 `e.name 取不到` 的坑。
 */
/** 取事件类型（如 'tool/call'）。 */
export function eventType(e) {
    const t = e?.type ?? e?.data?.type;
    return typeof t === 'string' ? t : undefined;
}
/** 取工具调用名（如 'kanban_complete' / 'bash' / 'kanban_create'）。 */
export function toolName(e) {
    const n = e?.name ?? e?.data?.name;
    return typeof n === 'string' ? n : undefined;
}
/** 取工具调用参数对象（兼容 JSON 字符串 / 对象两种落盘形态）。 */
export function toolArgs(e) {
    const a = e?.arguments ?? e?.data?.arguments;
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

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
export declare function eventType(e: {
    type?: unknown;
    data?: {
        type?: unknown;
    };
}): string | undefined;
/** 取工具调用名（如 'kanban_complete' / 'bash' / 'kanban_create'）。 */
export declare function toolName(e: unknown): string | undefined;
/** 取工具调用参数对象（兼容 JSON 字符串 / 对象两种落盘形态）。 */
export declare function toolArgs(e: unknown): Record<string, unknown>;
/** 取 assistant 消息的网关缓存回放标记（replayState.response.responseModel，如 'from-cache'）。
 *  非 assistant/message 或无标记返回 null。2026-09-04：远程网关回复缓存整包回放时由 SSE
 *  id/model 字段透传（dsh 纯透传），插件侧据此识别缓存劫持零产出。 */
export declare function replayModel(e: unknown): string | null;

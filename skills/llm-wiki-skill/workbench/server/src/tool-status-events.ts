import { homedir } from "node:os";

import type { AgentEvent } from "@earendil-works/pi-agent-core";

export const TOOL_STATUS_SCHEMA_VERSION = 1;

export type ToolStatusKind =
	| "assistant_text_delta"
	| "tool_status_start"
	| "tool_status_update"
	| "tool_status_end"
	| "tool_status_summary"
	| "assistant_done"
	| "assistant_cancelled"
	| "assistant_error";

export type ToolRunStatus = "running" | "done" | "failed" | "cancelled";

export interface ToolStatusBaseEvent {
	schemaVersion: 1;
	type: ToolStatusKind;
	runId: string;
	messageId: string;
	seq: number;
}

export interface ToolDisplay {
	toolCallId: string;
	toolName: string;
	action: string;
	target: string;
}

export interface ToolStatusStartEvent extends ToolStatusBaseEvent, ToolDisplay {
	type: "tool_status_start";
	status: "running";
	args: Record<string, unknown>;
	runningToolCount: number;
	otherRunningCount: number;
}

export interface ToolStatusUpdateEvent extends ToolStatusBaseEvent, ToolDisplay {
	type: "tool_status_update";
	status: "running";
	args: Record<string, unknown>;
	detail: unknown;
	runningToolCount: number;
	otherRunningCount: number;
}

export interface ToolStatusEndEvent extends ToolStatusBaseEvent, ToolDisplay {
	type: "tool_status_end";
	status: Exclude<ToolRunStatus, "running">;
	result: unknown;
	summary: string | null;
	error: string | null;
	durationMs: number;
	runningToolCount: number;
	otherRunningCount: number;
}

export interface ToolStatusSummaryEvent extends ToolStatusBaseEvent {
	type: "tool_status_summary";
	items: Array<ToolDisplay & { status: Exclude<ToolRunStatus, "running">; summary: string | null }>;
	remainingRunningCount: number;
}

export interface AssistantTextDeltaEvent extends ToolStatusBaseEvent {
	type: "assistant_text_delta";
	delta: string;
}

export interface AssistantDoneEvent extends ToolStatusBaseEvent {
	type: "assistant_done";
}

export interface AssistantCancelledEvent extends ToolStatusBaseEvent {
	type: "assistant_cancelled";
	reason: string;
}

export interface AssistantErrorEvent extends ToolStatusBaseEvent {
	type: "assistant_error";
	error: string;
}

export type ToolStatusContractEvent =
	| AssistantTextDeltaEvent
	| ToolStatusStartEvent
	| ToolStatusUpdateEvent
	| ToolStatusEndEvent
	| ToolStatusSummaryEvent
	| AssistantDoneEvent
	| AssistantCancelledEvent
	| AssistantErrorEvent;

type ToolStatusEventDraft = ToolStatusContractEvent extends infer Event
	? Event extends ToolStatusContractEvent
		? Omit<Event, "schemaVersion" | "runId" | "messageId" | "seq">
		: never
	: never;

export interface ToolStatusAdapterOptions {
	runId: string;
	messageId: string;
	startSeq?: number;
	now?: () => number;
	homeDir?: string;
}

type RedactionOptions = Required<Pick<ToolStatusAdapterOptions, "homeDir">>;

interface RunningToolState extends ToolDisplay {
	args: Record<string, unknown>;
	startedAt: number;
}

interface CompletedToolState extends ToolDisplay {
	status: Exclude<ToolRunStatus, "running">;
	summary: string | null;
}

type ToolExecutionEvent = Extract<
	AgentEvent,
	{ type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end" }
>;

export interface ToolStatusStartInput {
	toolCallId: string;
	toolName: string;
	args?: unknown;
}

export interface ToolStatusUpdateInput extends ToolStatusStartInput {
	partialResult?: unknown;
}

export interface ToolStatusEndInput {
	toolCallId: string;
	toolName: string;
	result?: unknown;
	isError?: boolean;
}

export interface SsePayload {
	event: string;
	data: string;
}

export type SsePayloadWriter = (payload: SsePayload) => Promise<void>;

export class OrderedSseWriter {
	private queue: Promise<void> = Promise.resolve();
	private closed = false;

	constructor(private readonly writePayload: SsePayloadWriter) {}

	writeContract(event: ToolStatusContractEvent): Promise<void> {
		return this.write({ event: event.type, data: JSON.stringify(event) });
	}

	writeNamed(event: string, data: unknown): Promise<void> {
		return this.write({ event, data: typeof data === "string" ? data : JSON.stringify(data) });
	}

	write(payload: SsePayload): Promise<void> {
		if (this.closed) return this.queue;
		const next = this.queue.then(async () => {
			if (!this.closed) await this.writePayload(payload);
		});
		this.queue = next.catch(() => {});
		return next;
	}

	flush(): Promise<void> {
		return this.queue;
	}

	close(): void {
		this.closed = true;
	}
}

export class PromptRunRegistry {
	private readonly activeRunIds = new Map<string, string>();

	begin(sessionId: string, runId: string): boolean {
		if (this.activeRunIds.has(sessionId)) return false;
		this.activeRunIds.set(sessionId, runId);
		return true;
	}

	end(sessionId: string, runId: string): void {
		if (this.activeRunIds.get(sessionId) === runId) this.activeRunIds.delete(sessionId);
	}

	get(sessionId: string): string | null {
		return this.activeRunIds.get(sessionId) ?? null;
	}
}

export class ToolStatusEventAdapter {
	private seq: number;
	private readonly now: () => number;
	private readonly redaction: RedactionOptions;
	private readonly runningTools = new Map<string, RunningToolState>();
	private readonly completedTools: CompletedToolState[] = [];

	constructor(private readonly options: ToolStatusAdapterOptions) {
		this.seq = options.startSeq ?? 0;
		this.now = options.now ?? Date.now;
		this.redaction = { homeDir: options.homeDir ?? homedir() };
	}

	adapt(event: unknown): ToolStatusContractEvent[] {
		if (isAgentEventType(event, "message_update")) {
			const inner = event.assistantMessageEvent;
			if (inner.type === "text_delta") {
				return [this.makeEvent({ type: "assistant_text_delta", delta: inner.delta })];
			}
			return [];
		}
		if (isAgentEventType(event, "tool_execution_start")) return [this.toolStart(event)];
		if (isAgentEventType(event, "tool_execution_update")) return [this.toolUpdate(event)];
		if (isAgentEventType(event, "tool_execution_end")) return [this.toolEnd(event)];
		return [];
	}

	startTool(input: ToolStatusStartInput): ToolStatusStartEvent {
		return this.toolStart({
			type: "tool_execution_start",
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			args: input.args,
		});
	}

	updateTool(input: ToolStatusUpdateInput): ToolStatusUpdateEvent {
		return this.toolUpdate({
			type: "tool_execution_update",
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			args: input.args,
			partialResult: input.partialResult,
		});
	}

	endTool(input: ToolStatusEndInput): ToolStatusEndEvent {
		return this.toolEnd({
			type: "tool_execution_end",
			toolCallId: input.toolCallId,
			toolName: input.toolName,
			result: input.result,
			isError: input.isError ?? false,
		});
	}

	finishAssistant(): ToolStatusContractEvent[] {
		const events: ToolStatusContractEvent[] = [];
		if (this.completedTools.length > 0 || this.runningTools.size > 0) {
			events.push(
				this.makeEvent({
					type: "tool_status_summary",
					items: this.completedTools.map((item) => ({ ...item })),
					remainingRunningCount: this.runningTools.size,
				}),
			);
		}
		events.push(this.makeEvent({ type: "assistant_done" }));
		return events;
	}

	failAssistant(error: unknown): ToolStatusContractEvent[] {
		return [this.makeEvent({ type: "assistant_error", error: normalizeError(error, this.redaction) })];
	}

	cancelAssistant(reason = "cancelled"): ToolStatusContractEvent[] {
		return [
			...this.cancelActiveTools(reason),
			this.makeEvent({ type: "assistant_cancelled", reason: redactText(reason, this.redaction, 160) }),
		];
	}

	cancelActiveTools(reason = "cancelled"): ToolStatusEndEvent[] {
		const events: ToolStatusEndEvent[] = [];
		for (const tool of [...this.runningTools.values()]) {
			this.runningTools.delete(tool.toolCallId);
			const summary = redactText(reason, this.redaction, 160);
			this.completedTools.push({ ...tool, status: "cancelled", summary });
			events.push(
				this.makeEvent({
					type: "tool_status_end",
					toolCallId: tool.toolCallId,
					toolName: tool.toolName,
					action: tool.action,
					target: tool.target,
					status: "cancelled",
					result: null,
					summary,
					error: null,
					durationMs: Math.max(0, this.now() - tool.startedAt),
					runningToolCount: this.runningTools.size,
					otherRunningCount: this.runningTools.size,
				}),
			);
		}
		return events;
	}

	getRunningTools(): ToolDisplay[] {
		return [...this.runningTools.values()].map(({ toolCallId, toolName, action, target }) => ({
			toolCallId,
			toolName,
			action,
			target,
		}));
	}

	private toolStart(event: Extract<ToolExecutionEvent, { type: "tool_execution_start" }>): ToolStatusStartEvent {
		const args = sanitizeRecord(event.args, this.redaction);
		const display = formatToolDisplay(event.toolName, args, undefined, this.redaction);
		this.runningTools.set(event.toolCallId, {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			...display,
			args,
			startedAt: this.now(),
		});
		return this.makeEvent({
			type: "tool_status_start",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			...display,
			status: "running",
			args,
			runningToolCount: this.runningTools.size,
			otherRunningCount: Math.max(0, this.runningTools.size - 1),
		});
	}

	private toolUpdate(event: Extract<ToolExecutionEvent, { type: "tool_execution_update" }>): ToolStatusUpdateEvent {
		const args = sanitizeRecord(event.args, this.redaction);
		const detail = sanitizeValue(event.partialResult, this.redaction);
		const display = formatToolDisplay(event.toolName, args, detail, this.redaction);
		const existing = this.runningTools.get(event.toolCallId);
		this.runningTools.set(event.toolCallId, {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			...display,
			args,
			startedAt: existing?.startedAt ?? this.now(),
		});
		return this.makeEvent({
			type: "tool_status_update",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			...display,
			status: "running",
			args,
			detail,
			runningToolCount: this.runningTools.size,
			otherRunningCount: Math.max(0, this.runningTools.size - 1),
		});
	}

	private toolEnd(event: Extract<ToolExecutionEvent, { type: "tool_execution_end" }>): ToolStatusEndEvent {
		const existing = this.runningTools.get(event.toolCallId);
		const result = sanitizeValue(event.result, this.redaction);
		const display =
			existing ?? {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				...formatToolDisplay(event.toolName, {}, result, this.redaction),
				args: {},
				startedAt: this.now(),
			};
		this.runningTools.delete(event.toolCallId);
		const status = event.isError ? "failed" : "done";
		const summary = summarizeResult(result, this.redaction);
		const error = status === "failed" ? normalizeError(result, this.redaction) : null;
		this.completedTools.push({
			toolCallId: display.toolCallId,
			toolName: display.toolName,
			action: display.action,
			target: display.target,
			status,
			summary,
		});
		return this.makeEvent({
			type: "tool_status_end",
			toolCallId: display.toolCallId,
			toolName: display.toolName,
			action: display.action,
			target: display.target,
			status,
			result,
			summary,
			error,
			durationMs: Math.max(0, this.now() - display.startedAt),
			runningToolCount: this.runningTools.size,
			otherRunningCount: this.runningTools.size,
		});
	}

	private makeEvent<T extends ToolStatusEventDraft>(
		event: T,
	): Extract<ToolStatusContractEvent, { type: T["type"] }> {
		this.seq += 1;
		const fullEvent = {
			schemaVersion: TOOL_STATUS_SCHEMA_VERSION,
			runId: this.options.runId,
			messageId: this.options.messageId,
			seq: this.seq,
			...event,
		};
		return fullEvent as unknown as Extract<ToolStatusContractEvent, { type: T["type"] }>;
	}
}

export function formatToolDisplay(
	toolName: string,
	args: unknown,
	detail?: unknown,
	redaction: RedactionOptions = { homeDir: homedir() },
): Pick<ToolDisplay, "action" | "target"> {
	const lower = toolName.toLowerCase();
	const argRecord = toRecord(args);
	const detailRecord = toRecord(detail);
	const details = toRecord(detailRecord.details);
	const merged = { ...details, ...detailRecord, ...argRecord };
	const pathTarget = firstString(merged, [
		"path",
		"filePath",
		"filepath",
		"targetPath",
		"target",
		"absolutePath",
		"relativePath",
	]);
	const queryTarget = firstString(merged, ["query", "pattern", "search", "term", "needle"]);
	const commandTarget = firstString(merged, ["command", "cmd", "script"]);
	const skillTarget = firstString(merged, ["skill", "skillName", "name", "slug", "command"]);

	if (lower.includes("read")) {
		return { action: "读取", target: redactPathTarget(pathTarget, redaction) };
	}
	if (lower.includes("write") || lower.includes("edit")) {
		return { action: lower.includes("edit") ? "编辑" : "写入", target: redactPathTarget(pathTarget, redaction) };
	}
	if (lower.includes("bash") || lower.includes("shell") || lower.includes("command")) {
		return { action: "运行命令", target: redactCommandTarget(commandTarget ?? pathTarget, redaction) };
	}
	if (lower.includes("search") || lower.includes("grep") || lower.includes("find")) {
		const target = queryTarget && pathTarget ? `${queryTarget} in ${pathTarget}` : queryTarget ?? pathTarget;
		return { action: "搜索", target: redactText(target ?? "未知目标", redaction, 96) };
	}
	if (lower.includes("skill")) {
		return { action: "调用 Skill", target: redactText(skillTarget ?? "未知 Skill", redaction, 96) };
	}
	return {
		action: `运行 ${toolName}`,
		target: redactText(pathTarget ?? queryTarget ?? commandTarget ?? skillTarget ?? "未知目标", redaction, 96),
	};
}

export function buildToolStatusContractFixture(): ToolStatusContractEvent[] {
	let tick = 1_000;
	const adapter = new ToolStatusEventAdapter({
		runId: "fixture-run",
		messageId: "fixture-message",
		homeDir: "/Users/example",
		now: () => {
			tick += 10;
			return tick;
		},
	});
	return [
		...adapter.adapt({
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "我来检查。",
				partial: { role: "assistant", content: [{ type: "text", text: "我来检查。" }] },
			},
		} as unknown as AgentEvent),
		...adapter.adapt({
			type: "tool_execution_start",
			toolCallId: "read-1",
			toolName: "read",
			args: { path: "/Users/example/projects/private/source.md" },
		}),
		...adapter.adapt({
			type: "tool_execution_update",
			toolCallId: "read-1",
			toolName: "read",
			args: { path: "/Users/example/projects/private/source.md" },
			partialResult: { details: { bytes: 128, path: "/Users/example/projects/private/source.md" } },
		}),
		...adapter.adapt({
			type: "tool_execution_end",
			toolCallId: "read-1",
			toolName: "read",
			result: { content: [{ type: "text", text: "ok /Users/example/projects/private/source.md" }] },
			isError: false,
		}),
		...adapter.finishAssistant(),
	];
}

function sanitizeRecord(value: unknown, redaction: RedactionOptions): Record<string, unknown> {
	const sanitized = sanitizeValue(value, redaction);
	return toRecord(sanitized);
}

function sanitizeValue(value: unknown, redaction: RedactionOptions): unknown {
	if (typeof value === "string") return redactText(value, redaction, 300);
	if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, redaction));
	if (!value || typeof value !== "object") return value;
	const result: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(value)) {
		const max = /command|cmd|script/i.test(key) ? 140 : 300;
		result[key] = typeof raw === "string" ? redactText(raw, redaction, max) : sanitizeValue(raw, redaction);
	}
	return result;
}

function redactPathTarget(value: string | undefined, redaction: RedactionOptions): string {
	if (!value?.trim()) return "未知路径";
	return compactPath(redactHome(value, redaction), 96);
}

function redactCommandTarget(value: string | undefined, redaction: RedactionOptions): string {
	if (!value?.trim()) return "未知命令";
	return redactText(value, redaction, 120);
}

function redactText(value: string, redaction: RedactionOptions, maxLength: number): string {
	const redacted = redactHome(value, redaction).replace(/\/Users\/[^/\s]+/g, "/Users/<user>");
	if (redacted.length <= maxLength) return redacted;
	const keep = Math.max(20, maxLength - 3);
	return `${redacted.slice(0, Math.ceil(keep * 0.6))}...${redacted.slice(-Math.floor(keep * 0.4))}`;
}

function redactHome(value: string, redaction: RedactionOptions): string {
	const home = redaction.homeDir.replace(/\/+$/, "");
	if (!home) return value;
	return value.split(home).join("~");
}

function compactPath(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	const parts = value.split("/").filter(Boolean);
	if (parts.length <= 3) return redactText(value, { homeDir: "" }, maxLength);
	const prefix = value.startsWith("~/") ? "~/" : value.startsWith("/") ? "/" : "";
	const tail = parts.slice(-3).join("/");
	return `${prefix}.../${tail}`;
}

function summarizeResult(result: unknown, redaction: RedactionOptions): string | null {
	if (!result) return null;
	if (typeof result === "string") return redactText(result, redaction, 160);
	const record = toRecord(result);
	const content = record.content;
	if (Array.isArray(content)) {
		const text = content
			.map((part) => {
				const p = toRecord(part);
				return typeof p.text === "string" ? p.text : "";
			})
			.filter(Boolean)
			.join(" ");
		if (text) return redactText(text, redaction, 160);
	}
	for (const key of ["summary", "message", "error", "stderr", "stdout"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return redactText(value, redaction, 160);
	}
	return null;
}

function normalizeError(error: unknown, redaction: RedactionOptions): string {
	if (error instanceof Error) return redactText(error.message, redaction, 200);
	if (typeof error === "string") return redactText(error, redaction, 200);
	const record = toRecord(error);
	for (const key of ["error", "message", "stderr"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return redactText(value, redaction, 200);
	}
	const summary = summarizeResult(error, redaction);
	return summary ?? "工具执行失败";
}

function toRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function isAgentEventType<T extends AgentEvent["type"]>(
	event: unknown,
	type: T,
): event is Extract<AgentEvent, { type: T }> {
	return isRecord(event) && event.type === type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import type {
	AssistantCancelledEvent,
	AssistantErrorEvent,
	ToolDisplay,
	ToolRunStatus,
	ToolStatusContractEvent,
	ToolStatusEndEvent,
	ToolStatusStartEvent,
	ToolStatusSummaryEvent,
	ToolStatusUpdateEvent,
} from "./api";

type CompletedStatus = Exclude<ToolRunStatus, "running">;

export interface ToolStatusModelOptions {
	coalesceMs?: number;
	maxCompletedItems?: number;
	maxSummaryItems?: number;
}

export interface ToolStatusReduceOptions {
	nowMs: number;
}

export interface ToolStatusActiveItem extends ToolDisplay {
	status: "running";
	args: Record<string, unknown>;
	detail?: unknown;
	startSeq: number;
	lastSeq: number;
}

export interface ToolStatusCompletedItem extends ToolDisplay {
	status: CompletedStatus;
	args: Record<string, unknown>;
	summary: string | null;
	error: string | null;
	durationMs: number;
	lastSeq: number;
}

export interface ToolStatusSummaryState {
	items: Array<ToolDisplay & { status: CompletedStatus; summary: string | null }>;
	remainingRunningCount: number;
	overflowCount: number;
	overflowLabel: string | null;
}

export interface IgnoredToolStatusEvent {
	seq: number;
	type: ToolStatusContractEvent["type"];
	reason: "foreign-run" | "foreign-message" | "duplicate-or-late";
}

interface PendingToolUpdate {
	event: ToolStatusUpdateEvent;
	nowMs: number;
}

export interface ToolStatusState {
	runId: string;
	messageId: string;
	active: ToolStatusActiveItem[];
	completed: ToolStatusCompletedItem[];
	failures: ToolStatusCompletedItem[];
	summary: ToolStatusSummaryState;
	ignored: IgnoredToolStatusEvent[];
	isDone: boolean;
	cancelReason: string | null;
	error: string | null;
	lastSeq: number;
	coalesceMs: number;
	nextUpdateFlushAt: number;
	pendingUpdateCount: number;
	completedOverflowCount: number;
	completedOverflowLabel: string | null;
	maxCompletedItems: number;
	maxSummaryItems: number;
	pendingUpdates: Record<string, PendingToolUpdate>;
}

const DEFAULT_COALESCE_MS = 100;
const DEFAULT_MAX_COMPLETED_ITEMS = 20;
const DEFAULT_MAX_SUMMARY_ITEMS = 8;

export function createToolStatusState(
	runId: string,
	messageId: string,
	options: ToolStatusModelOptions = {},
): ToolStatusState {
	return {
		runId,
		messageId,
		active: [],
		completed: [],
		failures: [],
		summary: {
			items: [],
			remainingRunningCount: 0,
			overflowCount: 0,
			overflowLabel: null,
		},
		ignored: [],
		isDone: false,
		cancelReason: null,
		error: null,
		lastSeq: 0,
		coalesceMs: options.coalesceMs ?? DEFAULT_COALESCE_MS,
		nextUpdateFlushAt: Number.POSITIVE_INFINITY,
		pendingUpdateCount: 0,
		completedOverflowCount: 0,
		completedOverflowLabel: null,
		maxCompletedItems: options.maxCompletedItems ?? DEFAULT_MAX_COMPLETED_ITEMS,
		maxSummaryItems: options.maxSummaryItems ?? DEFAULT_MAX_SUMMARY_ITEMS,
		pendingUpdates: {},
	};
}

export function reduceToolStatusEvents(
	state: ToolStatusState,
	events: readonly ToolStatusContractEvent[],
	options: ToolStatusReduceOptions,
): ToolStatusState {
	return events.reduce((nextState, event) => reduceToolStatusEvent(nextState, event, options), state);
}

export function reduceToolStatusEvent(
	state: ToolStatusState,
	event: ToolStatusContractEvent,
	options: ToolStatusReduceOptions,
): ToolStatusState {
	const ignoredReason = getIgnoredReason(state, event);
	if (ignoredReason) {
		return {
			...state,
			ignored: [...state.ignored, { seq: event.seq, type: event.type, reason: ignoredReason }],
		};
	}

	const acceptedState = { ...state, lastSeq: event.seq };
	switch (event.type) {
		case "tool_status_start":
			return reduceStart(acceptedState, event, options.nowMs);
		case "tool_status_update":
			return reduceUpdate(acceptedState, event, options.nowMs);
		case "tool_status_end":
			return reduceEnd(acceptedState, event);
		case "tool_status_summary":
			return reduceSummary(acceptedState, event);
		case "assistant_done":
			return { ...acceptedState, active: [], pendingUpdates: {}, pendingUpdateCount: 0, isDone: true };
		case "assistant_cancelled":
			return reduceCancelled(acceptedState, event);
		case "assistant_error":
			return reduceError(acceptedState, event);
		case "assistant_text_delta":
			return acceptedState;
		default:
			return assertNever(event);
	}
}

export function flushToolStatusUpdates(state: ToolStatusState, nowMs: number): ToolStatusState {
	if (state.pendingUpdateCount === 0 || nowMs < state.nextUpdateFlushAt) return state;
	let nextState = state;
	for (const pending of Object.values(state.pendingUpdates)) {
		nextState = applyUpdateToActive(nextState, pending.event, pending.nowMs);
	}
	return {
		...nextState,
		pendingUpdates: {},
		pendingUpdateCount: 0,
		nextUpdateFlushAt: nowMs + state.coalesceMs,
	};
}

export function cancelActiveToolStatus(state: ToolStatusState, reason = "已停止"): ToolStatusState {
	if (state.active.length === 0 && state.pendingUpdateCount === 0) {
		return { ...state, isDone: true, cancelReason: reason };
	}
	const cancelledItems: ToolStatusCompletedItem[] = state.active.map((item) => ({
		toolCallId: item.toolCallId,
		toolName: item.toolName,
		action: item.action,
		target: item.target,
		status: "cancelled",
		args: item.args,
		summary: reason,
		error: null,
		durationMs: 0,
		lastSeq: item.lastSeq,
	}));
	const nextState = capCompleted({
		...state,
		active: [],
		completed: [...state.completed, ...cancelledItems],
		pendingUpdates: {},
		pendingUpdateCount: 0,
		isDone: true,
		cancelReason: reason,
	});
	const summaryItems = nextState.completed.map((item) => ({
		toolCallId: item.toolCallId,
		toolName: item.toolName,
		action: item.action,
		target: item.target,
		status: item.status,
		summary: item.summary,
	}));
	const cappedItems = summaryItems.slice(0, nextState.maxSummaryItems);
	const overflowCount = Math.max(0, summaryItems.length - cappedItems.length);
	return {
		...nextState,
		summary: {
			items: cappedItems,
			remainingRunningCount: 0,
			overflowCount,
			overflowLabel: makeOverflowLabel(overflowCount),
		},
	};
}

function reduceStart(state: ToolStatusState, event: ToolStatusStartEvent, nowMs: number): ToolStatusState {
	const active = withoutTool(state.active, event.toolCallId);
	const nextItem: ToolStatusActiveItem = {
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		action: event.action,
		target: event.target,
		status: "running",
		args: event.args ?? {},
		startSeq: event.seq,
		lastSeq: event.seq,
	};
	return {
		...state,
		active: [...active, nextItem],
		nextUpdateFlushAt: Number.isFinite(state.nextUpdateFlushAt)
			? state.nextUpdateFlushAt
			: nowMs + state.coalesceMs,
	};
}

function reduceUpdate(state: ToolStatusState, event: ToolStatusUpdateEvent, nowMs: number): ToolStatusState {
	if (nowMs < state.nextUpdateFlushAt) {
		const pendingUpdates = {
			...state.pendingUpdates,
			[event.toolCallId]: { event, nowMs },
		};
		return {
			...state,
			pendingUpdates,
			pendingUpdateCount: state.pendingUpdateCount + 1,
		};
	}
	return {
		...applyUpdateToActive(state, event, nowMs),
		nextUpdateFlushAt: nowMs + state.coalesceMs,
	};
}

function applyUpdateToActive(
	state: ToolStatusState,
	event: ToolStatusUpdateEvent,
	nowMs: number,
): ToolStatusState {
	const existing = state.active.find((item) => item.toolCallId === event.toolCallId);
	const nextItem: ToolStatusActiveItem = {
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		action: event.action,
		target: event.target,
		status: "running",
		args: Object.keys(event.args ?? {}).length > 0 ? event.args : existing?.args ?? {},
		detail: event.detail,
		startSeq: existing?.startSeq ?? event.seq,
		lastSeq: event.seq,
	};
	return {
		...state,
		active: [...withoutTool(state.active, event.toolCallId), nextItem],
		nextUpdateFlushAt: Number.isFinite(state.nextUpdateFlushAt)
			? state.nextUpdateFlushAt
			: nowMs + state.coalesceMs,
	};
}

function reduceEnd(state: ToolStatusState, event: ToolStatusEndEvent): ToolStatusState {
	const existing = state.active.find((item) => item.toolCallId === event.toolCallId);
	const args = existing?.args ?? {};
	const completedItem: ToolStatusCompletedItem = {
		toolCallId: event.toolCallId,
		toolName: event.toolName,
		action: event.action,
		target: event.target,
		status: event.status,
		args,
		summary: event.summary,
		error: event.error,
		durationMs: event.durationMs,
		lastSeq: event.seq,
	};
	return capCompleted({
		...state,
		active: withoutTool(state.active, event.toolCallId),
		pendingUpdates: omitTool(state.pendingUpdates, event.toolCallId),
		pendingUpdateCount: Object.keys(omitTool(state.pendingUpdates, event.toolCallId)).length,
		completed: [...state.completed, completedItem],
		failures: event.status === "failed" ? [...state.failures, completedItem] : state.failures,
	});
}

function reduceSummary(state: ToolStatusState, event: ToolStatusSummaryEvent): ToolStatusState {
	const cappedItems = event.items.slice(0, state.maxSummaryItems);
	const overflowCount = Math.max(0, event.items.length - cappedItems.length);
	return {
		...state,
		summary: {
			items: cappedItems,
			remainingRunningCount: event.remainingRunningCount,
			overflowCount,
			overflowLabel: makeOverflowLabel(overflowCount),
		},
	};
}

function reduceCancelled(state: ToolStatusState, event: AssistantCancelledEvent): ToolStatusState {
	return {
		...state,
		active: [],
		pendingUpdates: {},
		pendingUpdateCount: 0,
		isDone: true,
		cancelReason: event.reason,
	};
}

function reduceError(state: ToolStatusState, event: AssistantErrorEvent): ToolStatusState {
	return {
		...state,
		active: [],
		pendingUpdates: {},
		pendingUpdateCount: 0,
		isDone: true,
		error: event.error,
	};
}

function capCompleted(state: ToolStatusState): ToolStatusState {
	const overflowCount = Math.max(0, state.completed.length - state.maxCompletedItems);
	if (overflowCount === 0) {
		return {
			...state,
			completedOverflowCount: 0,
			completedOverflowLabel: null,
		};
	}
	return {
		...state,
		completed: state.completed.slice(overflowCount),
		completedOverflowCount: state.completedOverflowCount + overflowCount,
		completedOverflowLabel: makeOverflowLabel(state.completedOverflowCount + overflowCount),
	};
}

function getIgnoredReason(
	state: ToolStatusState,
	event: ToolStatusContractEvent,
): IgnoredToolStatusEvent["reason"] | null {
	if (event.runId !== state.runId) return "foreign-run";
	if (event.messageId !== state.messageId) return "foreign-message";
	if (event.seq <= state.lastSeq) return "duplicate-or-late";
	return null;
}

function withoutTool<T extends ToolDisplay>(items: readonly T[], toolCallId: string): T[] {
	return items.filter((item) => item.toolCallId !== toolCallId);
}

function omitTool<T>(items: Record<string, T>, toolCallId: string): Record<string, T> {
	const nextItems = { ...items };
	delete nextItems[toolCallId];
	return nextItems;
}

function makeOverflowLabel(count: number): string | null {
	return count > 0 ? `还有 ${count} 项` : null;
}

function assertNever(value: never): never {
	throw new Error(`Unsupported tool status event: ${JSON.stringify(value)}`);
}

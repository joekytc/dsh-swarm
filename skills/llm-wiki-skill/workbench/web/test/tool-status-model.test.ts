import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildToolStatusContractFixture } from "../../server/src/tool-status-events";
import {
	cancelActiveToolStatus,
	createToolStatusState,
	flushToolStatusUpdates,
	reduceToolStatusEvent,
	reduceToolStatusEvents,
} from "../src/lib/tool-status-model";
import type {
	ToolStatusContractEvent,
	ToolStatusEndEvent,
	ToolStatusStartEvent,
	ToolStatusSummaryEvent,
	ToolStatusUpdateEvent,
} from "../src/lib/api";

const runId = "run-1";
const messageId = "message-1";

describe("tool status model", () => {
	it("reuses the backend contract fixture and rejects contract drift", () => {
		const fixture = buildToolStatusContractFixture();
		const expectedKeys: Record<ToolStatusContractEvent["type"], string[]> = {
			assistant_text_delta: ["delta", "messageId", "runId", "schemaVersion", "seq", "type"],
			tool_status_start: [
				"action",
				"args",
				"messageId",
				"otherRunningCount",
				"runId",
				"runningToolCount",
				"schemaVersion",
				"seq",
				"status",
				"target",
				"toolCallId",
				"toolName",
				"type",
			],
			tool_status_update: [
				"action",
				"args",
				"detail",
				"messageId",
				"otherRunningCount",
				"runId",
				"runningToolCount",
				"schemaVersion",
				"seq",
				"status",
				"target",
				"toolCallId",
				"toolName",
				"type",
			],
			tool_status_end: [
				"action",
				"durationMs",
				"error",
				"messageId",
				"otherRunningCount",
				"result",
				"runId",
				"runningToolCount",
				"schemaVersion",
				"seq",
				"status",
				"summary",
				"target",
				"toolCallId",
				"toolName",
				"type",
			],
			tool_status_summary: ["items", "messageId", "remainingRunningCount", "runId", "schemaVersion", "seq", "type"],
			assistant_done: ["messageId", "runId", "schemaVersion", "seq", "type"],
			assistant_cancelled: ["messageId", "reason", "runId", "schemaVersion", "seq", "type"],
			assistant_error: ["error", "messageId", "runId", "schemaVersion", "seq", "type"],
		};

		assert.deepEqual(
			fixture.map((event) => ({ type: event.type, keys: Object.keys(event).sort() })),
			fixture.map((event) => ({ type: event.type, keys: expectedKeys[event.type] })),
		);

		const state = reduceToolStatusEvents(createToolStatusState("fixture-run", "fixture-message"), fixture, {
			nowMs: 1_000,
		});

		assert.equal(state.completed[0]?.toolCallId, "read-1");
		assert.equal(state.completed[0]?.status, "done");
		assert.equal(state.summary.items[0]?.toolCallId, "read-1");
		assert.equal(state.active.length, 0);
		assert.equal(state.isDone, true);
	});

	it("tracks sequential, missing-args, failed, cancelled, and parallel tools", () => {
		const state = reduceToolStatusEvents(
			createToolStatusState(runId, messageId),
			[
				start("read-1", "read", 1, { path: "a.md" }),
				end("read-1", "read", 2, "done", "read a.md"),
				start("unknown-args", "custom_tool", 3),
				update("unknown-args", "custom_tool", 4),
				end("unknown-args", "custom_tool", 5, "failed", "missing args", "bad input"),
				start("write-1", "write", 6, { path: "out.md" }),
				start("bash-1", "bash", 7, { command: "npm test" }),
				end("write-1", "write", 8, "cancelled", "cancelled"),
				end("bash-1", "bash", 9, "done", "tests passed"),
			],
			{ nowMs: 1_000 },
		);

		assert.equal(state.active.length, 0);
		assert.deepEqual(
			state.completed.map((item) => [item.toolCallId, item.status]),
			[
				["read-1", "done"],
				["unknown-args", "failed"],
				["write-1", "cancelled"],
				["bash-1", "done"],
			],
		);
		assert.deepEqual(
			state.failures.map((item) => [item.toolCallId, item.error]),
			[["unknown-args", "bad input"]],
		);
		assert.deepEqual(
			state.completed.map((item) => item.args),
			[{ path: "a.md" }, {}, { path: "out.md" }, { command: "npm test" }],
		);
	});

	it("keys events by runId/messageId and ignores late, duplicate, and unknown-run events", () => {
		let state = createToolStatusState(runId, messageId);
		state = reduceToolStatusEvent(state, start("read-1", "read", 1), { nowMs: 1_000 });
		state = reduceToolStatusEvent(state, start("foreign", "read", 2, {}, "other-run", messageId), { nowMs: 1_000 });
		state = reduceToolStatusEvent(state, start("wrong-message", "read", 3, {}, runId, "other-message"), {
			nowMs: 1_000,
		});
		state = reduceToolStatusEvent(state, update("read-1", "read", 1), { nowMs: 1_000 });
		state = reduceToolStatusEvent(state, end("read-1", "read", 4, "done"), { nowMs: 1_000 });
		state = reduceToolStatusEvent(state, update("read-1", "read", 3), { nowMs: 1_000 });
		state = reduceToolStatusEvent(state, end("read-1", "read", 4, "done"), { nowMs: 1_000 });

		assert.deepEqual(
			state.completed.map((item) => item.toolCallId),
			["read-1"],
		);
		assert.deepEqual(
			state.ignored.map((item) => item.reason),
			["foreign-run", "foreign-message", "duplicate-or-late", "duplicate-or-late", "duplicate-or-late"],
		);
	});

	it("coalesces rapid update events and flushes visible updates on a bounded cadence", () => {
		let state = createToolStatusState(runId, messageId, { coalesceMs: 100 });
		state = reduceToolStatusEvent(state, start("search-1", "search", 1, { query: "alpha" }), { nowMs: 0 });
		state = reduceToolStatusEvent(state, update("search-1", "search", 2, { phase: "one" }), { nowMs: 10 });
		state = reduceToolStatusEvent(state, update("search-1", "search", 3, { phase: "two" }), { nowMs: 40 });
		state = reduceToolStatusEvent(state, update("search-1", "search", 4, { phase: "three" }), { nowMs: 80 });

		assert.equal(state.active[0]?.detail, undefined);
		assert.equal(state.pendingUpdateCount, 3);
		assert.equal(state.coalesceMs, 100);

		state = flushToolStatusUpdates(state, 120);

		assert.deepEqual(state.active[0]?.detail, { phase: "three" });
		assert.equal(state.pendingUpdateCount, 0);
		assert.equal(state.nextUpdateFlushAt, 220);
	});

	it("caps completed history and summary items with remaining counts", () => {
		const events: ToolStatusContractEvent[] = [];
		for (let index = 1; index <= 5; index += 1) {
			events.push(start(`tool-${index}`, "read", index * 2 - 1));
			events.push(end(`tool-${index}`, "read", index * 2, "done", `summary ${index}`));
		}
		events.push(summary(11, 5));

		const state = reduceToolStatusEvents(createToolStatusState(runId, messageId, { maxCompletedItems: 3, maxSummaryItems: 2 }), events, {
			nowMs: 1_000,
		});

		assert.deepEqual(
			state.completed.map((item) => item.toolCallId),
			["tool-3", "tool-4", "tool-5"],
		);
		assert.equal(state.completedOverflowCount, 2);
		assert.equal(state.completedOverflowLabel, "还有 2 项");
		assert.deepEqual(
			state.summary.items.map((item) => item.toolCallId),
			["tool-1", "tool-2"],
		);
		assert.equal(state.summary.overflowCount, 3);
		assert.equal(state.summary.overflowLabel, "还有 3 项");
	});

	it("locally cancels active tools without waiting for backend abort confirmation", () => {
		const running = reduceToolStatusEvents(
			createToolStatusState(runId, messageId),
			[
				start("read-1", "read", 1, { path: "a.md" }),
				start("bash-1", "bash", 2, { command: "npm test" }),
			],
			{ nowMs: 1_000 },
		);

		const cancelled = cancelActiveToolStatus(running, "用户已停止");

		assert.equal(cancelled.active.length, 0);
		assert.equal(cancelled.isDone, true);
		assert.equal(cancelled.cancelReason, "用户已停止");
		assert.deepEqual(
			cancelled.completed.map((item) => [item.toolCallId, item.status, item.summary]),
			[
				["read-1", "cancelled", "用户已停止"],
				["bash-1", "cancelled", "用户已停止"],
			],
		);
		assert.equal(cancelled.summary.items.length, 2);
	});
});

function start(
	toolCallId: string,
	toolName: string,
	seq: number,
	args: Record<string, unknown> = {},
	eventRunId = runId,
	eventMessageId = messageId,
): ToolStatusStartEvent {
	return {
		schemaVersion: 1,
		type: "tool_status_start",
		runId: eventRunId,
		messageId: eventMessageId,
		seq,
		toolCallId,
		toolName,
		action: toolName,
		target: "target",
		status: "running",
		args,
		runningToolCount: 1,
		otherRunningCount: 0,
	};
}

function update(
	toolCallId: string,
	toolName: string,
	seq: number,
	detail: unknown = null,
	eventRunId = runId,
	eventMessageId = messageId,
): ToolStatusUpdateEvent {
	return {
		schemaVersion: 1,
		type: "tool_status_update",
		runId: eventRunId,
		messageId: eventMessageId,
		seq,
		toolCallId,
		toolName,
		action: toolName,
		target: "target",
		status: "running",
		args: {},
		detail,
		runningToolCount: 1,
		otherRunningCount: 0,
	};
}

function end(
	toolCallId: string,
	toolName: string,
	seq: number,
	status: ToolStatusEndEvent["status"],
	summaryText: string | null = null,
	error: string | null = null,
): ToolStatusEndEvent {
	return {
		schemaVersion: 1,
		type: "tool_status_end",
		runId,
		messageId,
		seq,
		toolCallId,
		toolName,
		action: toolName,
		target: "target",
		status,
		result: null,
		summary: summaryText,
		error,
		durationMs: 10,
		runningToolCount: 0,
		otherRunningCount: 0,
	};
}

function summary(seq: number, count: number): ToolStatusSummaryEvent {
	return {
		schemaVersion: 1,
		type: "tool_status_summary",
		runId,
		messageId,
		seq,
		items: Array.from({ length: count }, (_, index) => ({
			toolCallId: `tool-${index + 1}`,
			toolName: "read",
			action: "read",
			target: `target ${index + 1}`,
			status: "done",
			summary: `summary ${index + 1}`,
		})),
		remainingRunningCount: 0,
	};
}

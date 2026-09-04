import type { ToolStatusContractEvent } from "./api";
import {
	createToolStatusState,
	reduceToolStatusEvent,
	type ToolStatusState,
} from "./tool-status-model";

export interface LegacyToolMark {
	name: string;
	status: "done";
}

export function createLegacyToolStatusState(
	messageId: string,
	tools: LegacyToolMark[],
): ToolStatusState | undefined {
	if (tools.length === 0) return undefined;
	let state = createToolStatusState(`legacy-${messageId}`, messageId, {
		maxCompletedItems: 50,
		maxSummaryItems: 8,
	});
	for (const [index, tool] of tools.entries()) {
		const display = legacyToolDisplay(tool.name);
		state = reduceToolStatusEvent(state, startEvent(state, display, index), { nowMs: index });
		state = reduceToolStatusEvent(state, endEvent(state, display, tool.name, index), { nowMs: index });
	}
	return reduceToolStatusEvent(
		state,
		{
			schemaVersion: 1,
			type: "assistant_done",
			runId: state.runId,
			messageId: state.messageId,
			seq: tools.length * 2 + 1,
		},
		{ nowMs: tools.length },
	);
}

interface LegacyToolDisplay {
	toolName: string;
	action: string;
	target: string;
	args: Record<string, unknown>;
}

function startEvent(
	state: ToolStatusState,
	display: LegacyToolDisplay,
	index: number,
): Extract<ToolStatusContractEvent, { type: "tool_status_start" }> {
	return {
		schemaVersion: 1,
		type: "tool_status_start",
		runId: state.runId,
		messageId: state.messageId,
		seq: index * 2 + 1,
		toolCallId: `legacy-${index}`,
		toolName: display.toolName,
		action: display.action,
		target: display.target,
		status: "running",
		args: display.args,
		runningToolCount: 1,
		otherRunningCount: 0,
	};
}

function endEvent(
	state: ToolStatusState,
	display: LegacyToolDisplay,
	name: string,
	index: number,
): Extract<ToolStatusContractEvent, { type: "tool_status_end" }> {
	return {
		schemaVersion: 1,
		type: "tool_status_end",
		runId: state.runId,
		messageId: state.messageId,
		seq: index * 2 + 2,
		toolCallId: `legacy-${index}`,
		toolName: display.toolName,
		action: display.action,
		target: display.target,
		status: "done",
		result: null,
		summary: name,
		error: null,
		durationMs: 0,
		runningToolCount: 0,
		otherRunningCount: 0,
	};
}

function legacyToolDisplay(name: string): LegacyToolDisplay {
	const lowerName = name.toLowerCase();
	if (name.includes("读取") || lowerName.includes("read")) {
		return { toolName: "read", action: "读取", target: name, args: { path: name } };
	}
	if (name.includes("写入") || lowerName.includes("write")) {
		return { toolName: "write", action: "写入", target: name, args: { path: name } };
	}
	if (name.includes("搜索") || lowerName.includes("search")) {
		return { toolName: "knowledge_search", action: "搜索", target: name, args: { query: name } };
	}
	if (name.includes("Skill") || lowerName.includes("skill")) {
		return { toolName: "skill_runner", action: "调用 Skill", target: name, args: { skillName: name } };
	}
	if (lowerName.includes("bash") || lowerName.includes("command") || name.includes("命令")) {
		return { toolName: "bash", action: "运行命令", target: name, args: { command: name } };
	}
	return { toolName: "legacy_tool", action: "工具", target: name, args: { name } };
}

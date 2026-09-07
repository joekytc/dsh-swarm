export type ToolStatusGroup = "file" | "command" | "search" | "skill" | "other";

export interface ToolStatusFormatInput {
	toolName: string;
	action?: string;
	target?: string;
	args?: Record<string, unknown>;
	detail?: unknown;
	homeDir?: string;
	maxTargetLength?: number;
}

export interface ToolStatusFormatOutput {
	action: string;
	target: string;
	group: ToolStatusGroup;
}

const DEFAULT_MAX_TARGET_LENGTH = 72;

export function formatToolStatusItem(input: ToolStatusFormatInput): ToolStatusFormatOutput {
	const toolName = input.toolName.trim() || "unknown_tool";
	const lowerToolName = toolName.toLowerCase();
	const merged = mergeRecords(toRecord(input.detail), toRecord(input.args));
	const target = firstString(merged, [
		"path",
		"filePath",
		"filepath",
		"targetPath",
		"target",
		"absolutePath",
		"relativePath",
	]);
	const query = firstString(merged, ["query", "pattern", "search", "term", "needle"]);
	const command = firstString(merged, ["command", "cmd", "script"]);
	const skill = firstString(merged, ["skill", "skillName", "name", "slug"]);
	const maxLength = input.maxTargetLength ?? DEFAULT_MAX_TARGET_LENGTH;
	const fallbackTarget = cleanString(input.target);

	if (isFileTool(lowerToolName)) {
		const action = lowerToolName.includes("edit") ? "编辑" : lowerToolName.includes("write") ? "写入" : "读取";
		return {
			action: cleanString(input.action) || action,
			target: formatPathTarget(target ?? fallbackTarget, input.homeDir, maxLength),
			group: "file",
		};
	}

	if (isCommandTool(lowerToolName)) {
		return {
			action: cleanString(input.action) || "运行命令",
			target: formatTextTarget(command ?? fallbackTarget, input.homeDir, maxLength, "未知命令"),
			group: "command",
		};
	}

	if (isSearchTool(lowerToolName)) {
		const combined = query && target ? `${query} in ${target}` : query ?? target ?? fallbackTarget;
		return {
			action: cleanString(input.action) || "搜索",
			target: formatTextTarget(combined, input.homeDir, maxLength, "未知搜索"),
			group: "search",
		};
	}

	if (isSkillTool(lowerToolName)) {
		return {
			action: cleanString(input.action) || "调用 Skill",
			target: formatTextTarget(skill ?? fallbackTarget, input.homeDir, maxLength, "未知 Skill"),
			group: "skill",
		};
	}

	return {
		action: cleanString(input.action) || `运行 ${toolName}`,
		target: formatTextTarget(target ?? query ?? command ?? skill ?? fallbackTarget, input.homeDir, maxLength, "未知目标"),
		group: "other",
	};
}

export function truncateToolStatusText(value: string, maxLength = DEFAULT_MAX_TARGET_LENGTH): string {
	if (maxLength <= 3) return value.slice(0, maxLength);
	if (value.length <= maxLength) return value;
	const keep = maxLength - 3;
	const headLength = Math.max(1, Math.ceil(keep * 0.45));
	const tailLength = Math.max(1, keep - headLength);
	return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

function formatPathTarget(
	value: string | undefined,
	homeDir: string | undefined,
	maxLength: number,
): string {
	const redacted = redactPrivatePath(cleanString(value), homeDir);
	if (!redacted) return "未知路径";
	return compactPath(redacted, maxLength);
}

function formatTextTarget(
	value: string | undefined,
	homeDir: string | undefined,
	maxLength: number,
	emptyLabel: string,
): string {
	const redacted = redactPrivatePath(cleanString(value), homeDir);
	if (!redacted) return emptyLabel;
	return truncateToolStatusText(redacted, maxLength);
}

function compactPath(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	const normalized = value.replace(/\\/g, "/");
	const parts = normalized.split("/").filter(Boolean);
	if (parts.length <= 3) return truncateToolStatusText(normalized, maxLength);
	const prefix = normalized.startsWith("~/") ? "~/" : normalized.startsWith("/") ? "/" : "";
	const tail = parts.slice(-3).join("/");
	const compacted = `${prefix}.../${tail}`;
	return compacted.length <= maxLength ? compacted : truncateToolStatusText(compacted, maxLength);
}

function redactPrivatePath(value: string | undefined, homeDir: string | undefined): string {
	if (!value) return "";
	let redacted = value;
	const normalizedHome = homeDir?.replace(/\/+$/, "");
	if (normalizedHome) redacted = redacted.split(normalizedHome).join("~");
	return redacted.replace(/\/Users\/[^/\s]+/g, "/Users/<user>");
}

function isFileTool(toolName: string): boolean {
	return toolName.includes("read") || toolName.includes("write") || toolName.includes("edit");
}

function isCommandTool(toolName: string): boolean {
	return toolName.includes("bash") || toolName.includes("shell") || toolName.includes("command");
}

function isSearchTool(toolName: string): boolean {
	return toolName.includes("search") || toolName.includes("grep") || toolName.includes("find");
}

function isSkillTool(toolName: string): boolean {
	return toolName.includes("skill");
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function mergeRecords(...records: Array<Record<string, unknown>>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const record of records) {
		const details = toRecord(record.details);
		Object.assign(result, details, record);
	}
	return result;
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cleanString(value: string | undefined): string | undefined {
	const cleaned = value?.trim();
	return cleaned ? cleaned : undefined;
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ActiveContext } from "../agent.js";

type ToolContent = { type: "text"; text: string };

interface SedimentParams {
	topic?: string;
	note?: string;
}

function formatLocalIso(date: Date): string {
	const offsetMinutes = -date.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const abs = Math.abs(offsetMinutes);
	const hh = String(Math.floor(abs / 60)).padStart(2, "0");
	const mm = String(abs % 60).padStart(2, "0");
	const yyyy = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	const second = String(date.getSeconds()).padStart(2, "0");
	return `${yyyy}-${month}-${day}T${hour}:${minute}:${second}${sign}${hh}:${mm}`;
}

function filenameStamp(date: Date): string {
	const yyyy = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${yyyy}-${month}-${day}-${hour}${minute}`;
}

function extractText(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const record = part as Record<string, unknown>;
			return record.type === "text" && typeof record.text === "string" ? record.text : "";
		})
		.join("");
}

function extractToolNames(message: AgentMessage): string[] {
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return [];
	const names: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const record = part as Record<string, unknown>;
		if (record.type !== "tool_call" && record.type !== "toolCall") continue;
		if (typeof record.name === "string") names.push(record.name);
		else if (typeof record.toolName === "string") names.push(record.toolName);
	}
	return names;
}

function slugify(input: string): string {
	const slug = input
		.trim()
		.replace(/[^\p{Script=Han}\p{Letter}\p{Number}-]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return slug || "chat";
}

function firstUserMessage(messages: AgentMessage[]): string {
	for (const message of messages) {
		if (message.role === "user") {
			const text = extractText(message).trim();
			if (text) return text.slice(0, 20);
		}
	}
	return "chat";
}

function renderMessages(messages: AgentMessage[]): string {
	const parts: string[] = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = extractText(message).trim();
		const tools = extractToolNames(message);
		if (!text && tools.length === 0) continue;

		parts.push(message.role === "user" ? "## 👤 用户" : "## 🤖 助手");
		if (text) parts.push(text);
		if (tools.length > 0) {
			parts.push(
				[
					"<details>",
					"<summary>工具调用</summary>",
					"",
					tools.map((name) => `- ${name}`).join("\n"),
					"",
					"</details>",
				].join("\n"),
			);
		}
	}
	return parts.join("\n\n").trimEnd() + "\n";
}

function assertInside(baseDir: string, target: string): void {
	const resolvedBase = path.resolve(baseDir);
	const resolvedTarget = path.resolve(target);
	if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
		throw new Error("目标路径不在 sessions 目录内");
	}
}

function toolResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text", text } satisfies ToolContent], details };
}

export function createSynthesisExtension(getActive: () => ActiveContext | null) {
	return function synthesisExtension(pi: ExtensionAPI) {
		pi.registerTool({
			name: "sediment_to_wiki",
			label: "结晶到知识库",
			description:
				"把当前对话结晶为当前知识库 wiki/synthesis/sessions/ 下的一个 markdown 文件。可选 topic 影响文件名。",
			parameters: Type.Object({
				topic: Type.Optional(Type.String()),
				note: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params: SedimentParams) {
				const active = getActive();
				if (!active) return toolResult("当前没有活跃知识库。请先选择一个知识库。");

				const messages = active.session.state.messages;
				if (messages.length === 0) {
					return toolResult("当前对话还没有可结晶的内容。");
				}

				const now = new Date();
				const sessionsDir = path.join(active.kb.path, "wiki", "synthesis", "sessions");
				await mkdir(sessionsDir, { recursive: true });

				const topic = params.topic?.trim() ?? "";
				const slugSource = topic || firstUserMessage(messages);
				const filename = `${filenameStamp(now)}-${slugify(slugSource)}.md`;
				const targetPath = path.join(sessionsDir, filename);
				assertInside(sessionsDir, targetPath);

				const relPath = path.posix.join("wiki", "synthesis", "sessions", filename);
				const body = [
					"---",
					`date: ${formatLocalIso(now)}`,
					"source: chat",
					`conversation_id: ${active.conversationId}`,
					`topic: ${topic}`,
					"---",
					params.note?.trim() ? `\n${params.note.trim()}` : "",
					"\n" + renderMessages(messages),
				].join("\n");

				await writeFile(targetPath, body, "utf8");
				return toolResult(`已结晶为 ${relPath}`, { path: relPath });
			},
		});
	};
}

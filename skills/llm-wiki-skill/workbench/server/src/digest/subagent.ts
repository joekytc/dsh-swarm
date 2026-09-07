import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

import {
	authStorage,
	getConfiguredModel,
	getResourceLoader,
	getRoleModel,
	modelRegistry,
} from "../agent.js";
import type { ModelRef } from "../config.js";

export interface DigestFileInput {
	kbPath: string;
	filePath: string;
	purpose: string;
	model?: ModelRef | null;
}

export async function digestFileWithSubagent(
	input: DigestFileInput,
	onProgress?: (chars: number) => void | Promise<void>,
): Promise<string> {
	const loader = await getResourceLoader();
	const model = input.model
		? getConfiguredModel(input.model) ?? (await getRoleModel("digest"))
		: await getRoleModel("digest");
	const { session, modelFallbackMessage } = await createAgentSession({
		cwd: input.kbPath,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(input.kbPath),
		authStorage,
		modelRegistry,
		...(model ? { model } : {}),
		thinkingLevel: "off",
		tools: ["read"],
	});
	if (modelFallbackMessage) console.log(`[digest] ${modelFallbackMessage}`);

	let output = "";
	let lastEmittedChars = 0;
	let lastEmittedAt = 0;
	const unsubscribe = session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			output += event.assistantMessageEvent.delta;
			const now = Date.now();
			if (onProgress && (output.length - lastEmittedChars >= 500 || now - lastEmittedAt >= 300)) {
				lastEmittedChars = output.length;
				lastEmittedAt = now;
				void onProgress(output.length);
			}
		}
	});

	try {
		await session.prompt(buildDigestPrompt(input));
		const trimmed = output.trim();
		if (!trimmed) throw new Error("子代理没有返回内容");
		await onProgress?.(trimmed.length);
		return trimmed;
	} finally {
		unsubscribe();
		session.dispose();
	}
}

function buildDigestPrompt(input: DigestFileInput): string {
	return [
		"你是 llm-wiki 的素材消化子代理。",
		"只处理一个文件，读完后输出一篇可直接保存到 wiki 的中文 Markdown 笔记。",
		"不要改写文件，不要调用写入工具，不要输出过程说明。",
		"",
		`知识库路径：${input.kbPath}`,
		`研究方向：${input.purpose || "未提供"}`,
		`素材文件：${input.filePath}`,
		"",
		"输出结构：",
		"# 标题",
		"",
		"## 核心摘要",
		"用 3-5 条 bullet 说明最重要的信息。",
		"",
		"## 关键细节",
		"整理事实、概念、数字、论点和可复用片段。",
		"",
		"## 与研究方向的关系",
		"说明这份素材为什么值得放进当前知识库。",
		"",
		"## 后续问题",
		"列出 2-5 个值得继续追问的问题。",
	].join("\n");
}

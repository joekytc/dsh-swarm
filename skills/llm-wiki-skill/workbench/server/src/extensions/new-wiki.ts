import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { createWiki } from "../wiki-init.js";

interface NewWikiParams {
	name: string;
	purpose: string;
}

type ToolContent = { type: "text"; text: string };

function toolResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text", text } satisfies ToolContent], details };
}

export function createNewWikiExtension() {
	return function newWikiExtension(pi: ExtensionAPI) {
		pi.registerTool({
			name: "new_wiki",
			label: "新建知识库",
			description:
				"在默认知识库根目录下新建一个 llm-wiki 知识库，调用已安装的 llm-wiki-skill 初始化脚本。",
			parameters: Type.Object({
				name: Type.String(),
				purpose: Type.String(),
			}),
			async execute(_toolCallId, params: NewWikiParams) {
				try {
					const result = await createWiki(params.name, params.purpose);
					return toolResult(`知识库已创建：~/llm-wiki/${result.name}`, { ...result });
				} catch (err) {
					const error = err as Error & { stdout?: string; stderr?: string };
					return toolResult(`创建知识库失败：${error.message}`, {
						stdout: error.stdout ?? "",
						stderr: error.stderr ?? "",
					});
				}
			},
		});
	};
}

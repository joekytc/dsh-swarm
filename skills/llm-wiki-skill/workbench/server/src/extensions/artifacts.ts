import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ActiveContext } from "../agent.js";
import {
	type ArtifactKind,
	finalizeArtifact,
	prepareArtifact,
} from "../artifacts.js";

interface PrepareParams {
	kind: ArtifactKind;
	title: string;
	sourceSkill?: string;
}

interface FinalizeParams {
	id: string;
	primaryFile: string;
	sourceSkill?: string;
}

type ToolContent = { type: "text"; text: string };

function toolResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text", text } satisfies ToolContent], details };
}

export function createArtifactsExtension(getActive: () => ActiveContext | null) {
	return function artifactsExtension(pi: ExtensionAPI) {
		pi.registerTool({
			name: "prepare_artifact",
			label: "准备产物目录",
			description:
				"为 HTML/PDF/Word/PPT/Excel 产物创建工作目录。生成文件前先调用它，返回 id 和 workspacePath。",
			parameters: Type.Object({
				kind: Type.Union([
					Type.Literal("html"),
					Type.Literal("pdf"),
					Type.Literal("docx"),
					Type.Literal("pptx"),
					Type.Literal("xlsx"),
				]),
				title: Type.String(),
				sourceSkill: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params: PrepareParams) {
				const active = getActive();
				if (!active) return toolResult("当前没有活跃知识库。请先选择一个知识库。");
				const prepared = await prepareArtifact({
					kind: params.kind,
					title: params.title,
					sourceConversationId: active.conversationId,
					sourceKbPath: active.kb.path,
					sourceSkill: params.sourceSkill,
				});
				return toolResult(`已准备产物目录：${prepared.workspacePath}`, prepared);
			},
		});

		pi.registerTool({
			name: "finalize_artifact",
			label: "登记产物",
			description:
				"文件生成完成后调用，登记 manifest.json 并通知前端打开右抽屉。primaryFile 必须是产物目录里的文件名。",
			parameters: Type.Object({
				id: Type.String(),
				primaryFile: Type.String(),
				sourceSkill: Type.Optional(Type.String()),
			}),
			async execute(_toolCallId, params: FinalizeParams) {
				try {
					const manifest = await finalizeArtifact(params);
					return toolResult(`产物已登记：${manifest.id} / ${manifest.primaryFile}`, { manifest });
				} catch (err) {
					return toolResult(`登记产物失败：${err instanceof Error ? err.message : String(err)}`);
				}
			},
		});
	};
}

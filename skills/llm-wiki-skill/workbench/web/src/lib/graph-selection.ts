import { wikiPathForGraphNode, type GraphData, type Selection, type SelectionAction } from "@llm-wiki/graph-engine";

export interface SelectionPromptPayload {
	selection: Selection;
	action: SelectionAction | null;
	freeText: string;
	expandedText: string;
	displayText: string;
}

interface SelectionNodeInfo {
	id: string;
	label: string;
	path: string;
	community: string;
}

interface SelectionEdgeInfo {
	from: string;
	to: string;
	type: string;
}

export function buildSelectionPromptPayload(
	data: GraphData,
	selection: Selection,
	action: SelectionAction | null,
	freeText = "",
): SelectionPromptPayload {
	const nodes = selectionNodes(data, selection);
	const edges = selectionEdges(data, selection);
	const title = selectionTitle(data, selection);
	const actionLine = action ? `动作：${action.label}` : "动作：自由提问";
	const freeLine = freeText.trim() ? `补充要求：${freeText.trim()}` : "";
	const expandedText = [
		`@[选区:${title} · ${selection.facts.pageCount}页]`,
		actionLine,
		freeLine,
		"",
		"选区结构事实：",
		`- 页数：${selection.facts.pageCount}`,
		`- 内部链接数：${selection.facts.internalLinkCount}`,
		`- 社区数：${selection.facts.communityCount}`,
		`- 孤立数：${selection.facts.isolatedCount}`,
		"",
		"页面清单：",
		...nodes.map((node, index) => `${index + 1}. [[${node.path}]] - ${node.label} - 社区 ${node.community}`),
		"",
		"链接关系：",
		...(edges.length
			? edges.map((edge) => `- ${edge.from} -> ${edge.to} (${edge.type})`)
			: ["- 选区内没有直接链接"]),
		"",
		"请基于上面的选区信息回答；需要正文细节时，请按页面路径读取。"
	].filter((line) => line !== undefined).join("\n");

	return {
		selection,
		action,
		freeText,
		expandedText,
		displayText: `@[选区:${title} · ${selection.facts.pageCount}页] ${action ? action.label : freeText.trim() || "自由提问"}`
	};
}

export function selectionTitle(data: GraphData, selection: Selection): string {
	if (selection.communityIds.length === 1) {
		const community = data.learning?.communities?.find((item) => String(item.id) === selection.communityIds[0]);
		if (community?.label) return community.label;
	}
	const firstNode = data.nodes.find((node) => selection.nodeIds.includes(node.id));
	return firstNode?.label || selection.nodeIds[0] || "图谱";
}

function selectionNodes(data: GraphData, selection: Selection): SelectionNodeInfo[] {
	const selected = new Set(selection.nodeIds);
	return data.nodes
		.filter((node) => selected.has(node.id))
		.map((node) => ({
			id: node.id,
			label: node.label || node.id,
			path: wikiPathForGraphNode(node),
			community: String(node.community || "_none")
		}));
}

function selectionEdges(data: GraphData, selection: Selection): SelectionEdgeInfo[] {
	const selected = new Set(selection.nodeIds);
	return data.edges
		.filter((edge) => selected.has(edge.from) && selected.has(edge.to))
		.map((edge) => ({
			from: edge.from,
			to: edge.to,
			type: String(edge.type || "EXTRACTED")
		}));
}

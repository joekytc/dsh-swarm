import { pageReaderActions, type GraphOpenPagePayload, type PageReaderActionId } from "@llm-wiki/graph-engine";

export type GraphReaderActionId = PageReaderActionId;

export interface GraphReaderAction {
	id: GraphReaderActionId;
	label: string;
}

export function graphReaderMetaItems(payload: GraphOpenPagePayload): string[] {
	const items = [payload.node.typeLabel];
	if (payload.node.date) items.push(payload.node.date);
	if (payload.node.source) items.push(payload.node.source);
	if (payload.node.type === "source" && payload.node.sourcePath) items.push(payload.node.sourcePath);
	return items;
}

export function graphReaderActions(): GraphReaderAction[] {
	return pageReaderActions();
}

export function graphReaderActionLabels(payload: GraphOpenPagePayload): string[] {
	void payload;
	return graphReaderActions().map((action) => action.label);
}

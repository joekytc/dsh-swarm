import type { Selection } from "@llm-wiki/graph-engine";

export interface GraphSelectionFactView {
	label: string;
	value: number;
}

export interface GraphSelectionViewModel {
	hint: string;
	showFacts: boolean;
	canExpandNeighbors: boolean;
	facts: GraphSelectionFactView[];
	actionLabels: string[];
}

export function graphSelectionViewModel(selection: Selection): GraphSelectionViewModel {
	const showFacts = selection.nodeIds.length >= 2;
	const facts: GraphSelectionFactView[] = showFacts
		? [
				{ label: "页", value: selection.facts.pageCount },
				{ label: "链接", value: selection.facts.internalLinkCount },
				{ label: "社区", value: selection.facts.communityCount },
			]
		: [];
	if (showFacts && selection.facts.isolatedCount > 0) {
		facts.push({ label: "孤立", value: selection.facts.isolatedCount });
	}
	return {
		hint: "Shift+点击 增删节点",
		showFacts,
		canExpandNeighbors: selection.nodeIds.length === 1,
		facts,
		actionLabels: selection.actions?.map((action) => action.label) ?? [],
	};
}

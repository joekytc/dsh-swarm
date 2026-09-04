import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { Selection } from "@llm-wiki/graph-engine";
import { graphSelectionViewModel } from "../src/lib/graph-selection-drawer";

describe("graph selection drawer", () => {
	it("hides structural facts for a single node and keeps unrelated group actions out", () => {
		const view = graphSelectionViewModel(selectionFixture({
			nodeIds: ["a"],
			facts: { pageCount: 1, internalLinkCount: 0, communityCount: 1, isolatedCount: 0 },
			actions: [
				{ id: "summarize_page", label: "总结这一页", tone: "digest" },
				{ id: "find_related_pages", label: "它和谁有关", tone: "bridge" },
			],
		}));

		assert.equal(view.hint, "Shift+点击 增删节点");
		assert.equal(view.showFacts, false);
		assert.equal(view.canExpandNeighbors, true);
		assert.deepEqual(view.facts, []);
		assert.deepEqual(view.actionLabels, ["总结这一页", "它和谁有关"]);
		assert.equal(view.actionLabels.includes("探索潜在联系"), false);
	});

	it("shows structural facts and the shift hint for multi-node selections", () => {
		const view = graphSelectionViewModel(selectionFixture({
			nodeIds: ["a", "b"],
			facts: { pageCount: 2, internalLinkCount: 1, communityCount: 1, isolatedCount: 0 },
			actions: [
				{ id: "summarize_group", label: "总结这一组", tone: "digest" },
				{ id: "explore_group_relationships", label: "探索它们的关系", tone: "bridge" },
			],
		}));

		assert.equal(view.hint, "Shift+点击 增删节点");
		assert.equal(view.showFacts, true);
		assert.equal(view.canExpandNeighbors, false);
		assert.deepEqual(view.facts, [
			{ label: "页", value: 2 },
			{ label: "链接", value: 1 },
			{ label: "社区", value: 1 },
		]);
		assert.deepEqual(view.actionLabels, ["总结这一组", "探索它们的关系"]);
	});
});

function selectionFixture(input: Pick<Selection, "nodeIds" | "facts" | "actions">): Selection {
	return {
		id: "selection-test",
		nodeIds: input.nodeIds,
		communityIds: [],
		facts: input.facts,
		actions: input.actions,
	};
}

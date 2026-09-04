import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	drawerForExcludedGraphObject,
	drawerForGraphSelection,
	drawerForGraphSummaryNode,
	drawerForUnavailableGraphObject,
	graphOpenPagePayloadForCommand,
	graphObjectVisibilityReason,
	graphSelectionCommandForOpenDetail,
} from "../src/lib/graph-summary-actions";
import { closedDrawer } from "../src/lib/drawer-state";
import type { GraphData, GraphSummaryCommand, Selection } from "@llm-wiki/graph-engine";

describe("graph summary actions", () => {
	it("turns a single node selection into a lightweight node summary drawer", () => {
		const drawer = drawerForGraphSelection(graphFixture(), nodeSelection(), closedDrawer());

		assert.equal(drawer.mode, "graph-node-summary");
		assert.equal(drawer.mode === "graph-node-summary" ? drawer.payload.nodeId : null, "a");
		assert.equal(drawer.mode === "graph-node-summary" ? drawer.payload.label : null, "Alpha");
		assert.deepEqual(
			drawer.mode === "graph-node-summary" ? drawer.payload.commands.map((command) => command.kind) : [],
			["open-detail-read", "set-fixed-position", "enter-community"],
		);
	});

	it("turns a single community selection into a lightweight community summary drawer", () => {
		const drawer = drawerForGraphSelection(graphFixture(), communitySelection(), closedDrawer());

		assert.equal(drawer.mode, "graph-community-summary");
		assert.equal(drawer.mode === "graph-community-summary" ? drawer.payload.communityId : null, "c1");
		assert.deepEqual(
			drawer.mode === "graph-community-summary" ? drawer.payload.commands.map((command) => command.kind) : [],
			["enter-community"],
		);
	});

	it("switches a community core node list click to node summary without entering community", () => {
		const drawer = drawerForGraphSummaryNode(graphFixture(), "b", communitySummaryDrawer());

		assert.equal(drawer.mode, "graph-node-summary");
		assert.equal(drawer.mode === "graph-node-summary" ? drawer.payload.nodeId : null, "b");
	});

	it("keeps open detail/read as an explicit graph-reader payload", () => {
		const payload = graphOpenPagePayloadForCommand(graphFixture(), {
			kind: "open-detail-read",
			nodeId: "a",
			path: "wiki/a.md",
			label: "打开详情",
		});

		assert.deepEqual(payload, {
			path: "wiki/a.md",
			node: {
				id: "a",
				title: "Alpha",
				type: "topic",
				typeLabel: "主题",
				sourcePath: "wiki/a.md",
				community: "c1",
				date: null,
				source: null,
				isolated: false,
			},
		});
	});

	it("returns null for graph summary commands that should not open full reading", () => {
		const command: GraphSummaryCommand = { kind: "enter-community", communityId: "c1", label: "进入社区" };

		assert.equal(graphOpenPagePayloadForCommand(graphFixture(), command), null);
	});

	it("turns open detail/read into community focus with the node selected", () => {
		const command: GraphSummaryCommand = {
			kind: "open-detail-read",
			nodeId: "a",
			path: "wiki/a.md",
			label: "打开详情",
		};

		assert.deepEqual(graphSelectionCommandForOpenDetail(graphFixture(), command), {
			id: "c1",
			nodeId: "a",
			type: "enter-community-node",
		});
	});

	it("classifies selected objects excluded by filters or search without clearing state", () => {
		const data = graphFixture();
		const object = { kind: "node" as const, nodeId: "b" };
		const filteredState = {
			searchQuery: "",
			searchResultIds: [],
			typeFilters: { topic: true, entity: false, source: true },
			temporaryObject: null,
		};
		const searchedState = {
			searchQuery: "Alpha",
			searchResultIds: ["a"],
			typeFilters: { topic: true, entity: true, source: true },
			temporaryObject: null,
		};

		assert.equal(graphObjectVisibilityReason(data, filteredState, object), "filter");
		assert.equal(graphObjectVisibilityReason(data, searchedState, object), "search");

		const excluded = drawerForExcludedGraphObject(data, object, "filter", closedDrawer(), {
			selection: { kind: "node", id: "b" },
			searchResultIds: ["a"],
		});
		assert.equal(excluded.mode, "graph-excluded-object");
		assert.deepEqual(
			excluded.mode === "graph-excluded-object" ? excluded.payload.commands.map((command) => command.kind) : [],
			["show-this-object", "clear-temporary-object-display"],
		);

		const unavailable = drawerForUnavailableGraphObject({ ...data, nodes: data.nodes.filter((node) => node.id !== "b") }, object, "missing-node", closedDrawer());
		assert.equal(unavailable.mode, "graph-unavailable-object");
	});
});

function nodeSelection(): Selection {
	return {
		id: "node:a",
		nodeIds: ["a"],
		communityIds: ["c1"],
		facts: {
			pageCount: 1,
			internalLinkCount: 0,
			communityCount: 1,
			isolatedCount: 0,
		},
		actions: [],
	};
}

function communitySelection(): Selection {
	return {
		id: "community:a,b",
		nodeIds: ["a", "b"],
		communityIds: ["c1"],
		facts: {
			pageCount: 2,
			internalLinkCount: 1,
			communityCount: 1,
			isolatedCount: 0,
		},
		actions: [],
	};
}

function communitySummaryDrawer() {
	return drawerForGraphSelection(graphFixture(), communitySelection(), closedDrawer());
}

function graphFixture(): GraphData {
	return {
		meta: {
			build_date: "2026-06-18T00:00:00.000Z",
			wiki_title: "Graph summary action test",
			total_nodes: 2,
			total_edges: 1,
		},
		nodes: [
			{ id: "a", label: "Alpha", type: "topic", community: "c1", source_path: "wiki/a.md" },
			{ id: "b", label: "Beta", type: "entity", community: "c1", source_path: "wiki/b.md" },
		],
		edges: [
			{ id: "a-b", from: "a", to: "b", type: "EXTRACTED", relation_type: "实现", weight: 1 },
		],
		learning: {
			version: 1,
			entry: { recommended_start_node_id: "a", recommended_start_reason: "hub", default_mode: "global" },
			views: {
				path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
				community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
				global: { enabled: true, node_ids: ["a", "b"], degraded: false },
			},
			communities: [
				{ id: "c1", label: "Community", node_count: 2, color_index: 0, members: ["a", "b"] },
			],
		},
	};
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveSelection, type GraphData } from "@llm-wiki/graph-engine";
import { buildSelectionPromptPayload } from "../src/lib/graph-selection";

describe("graph selection prompt payload", () => {
	it("expands a community selection into page list, links, and communities", () => {
		const data = fixtureGraph();
		const selection = resolveSelection(data, { kind: "community", id: "alpha" });
		const action = selection.actions?.find((item) => item.id === "summarize_cluster") ?? null;
		const payload = buildSelectionPromptPayload(data, selection, action);

		assert.match(payload.displayText, /@\[选区:Alpha Group · 2页\] 总结这一簇/);
		assert.match(payload.expandedText, /动作：总结这一簇/);
		assert.match(payload.expandedText, /页面清单：/);
		assert.match(payload.expandedText, /1\. \[\[wiki\/topics\/alpha-a\.md\]\] - Alpha A - 社区 alpha/);
		assert.match(payload.expandedText, /2\. \[\[wiki\/entities\/alpha-b\.md\]\] - Alpha B - 社区 alpha/);
		assert.match(payload.expandedText, /链接关系：/);
		assert.match(payload.expandedText, /- a -> b \(EXTRACTED\)/);
		assert.match(payload.expandedText, /请基于上面的选区信息回答/);
	});

	it("uses stored synthesis session paths when sending graph nodes into chat", () => {
		const data = fixtureGraph();
		data.nodes = [
			{
				id: "session-a",
				label: "Session A",
				type: "synthesis",
				community: "alpha",
				source_path: "wiki/synthesis/sessions/session-a.md",
			},
		];
		data.edges = [];
		const learning = data.learning;
		assert.ok(learning);
		data.learning = {
			...learning,
			views: {
				...learning.views,
				global: { enabled: true, node_ids: ["session-a"], degraded: false },
			},
			communities: [{ id: "alpha", label: "Alpha Group", node_count: 1, color_index: 0 }],
		};

		const selection = resolveSelection(data, { kind: "node", id: "session-a" });
		const payload = buildSelectionPromptPayload(data, selection, null);

		assert.match(payload.expandedText, /1\. \[\[wiki\/synthesis\/sessions\/session-a\.md\]\] - Session A - 社区 alpha/);
		assert.doesNotMatch(payload.expandedText, /wiki\/synthesis\/session-a\.md/);
	});
});

function fixtureGraph(): GraphData {
	return {
		meta: {
			build_date: "2026-06-12T00:00:00.000Z",
			wiki_title: "Selection Fixture",
			total_nodes: 2,
			total_edges: 1
		},
		nodes: [
			{ id: "a", label: "Alpha A", type: "topic", community: "alpha", source_path: "wiki/topics/alpha-a.md" },
			{ id: "b", label: "Alpha B", type: "entity", community: "alpha", source_path: "wiki/entities/alpha-b.md" }
		],
		edges: [
			{ id: "a-b", from: "a", to: "b", type: "EXTRACTED", weight: 1 }
		],
		learning: {
			version: 1,
			entry: { recommended_start_node_id: "a", recommended_start_reason: "community_hub", default_mode: "global" },
			views: {
				path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
				community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
				global: { enabled: true, node_ids: ["a", "b"], degraded: false }
			},
			communities: [
				{ id: "alpha", label: "Alpha Group", node_count: 2, color_index: 0 }
			]
		}
	};
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveSelection, resolveSelectionForCapabilities } from "../src/select";
import type { GraphData, SelectionActionId } from "../src/types";

describe("structured graph selection", () => {
  it("maps a linked single page to page actions", () => {
    const selection = resolveSelection(multicommGraph(), { kind: "node", id: "a1" });

    assert.deepEqual(selection.nodeIds, ["a1"]);
    assert.deepEqual(selection.communityIds, ["alpha"]);
    assert.deepEqual(selection.facts, {
      pageCount: 1,
      internalLinkCount: 0,
      communityCount: 1,
      isolatedCount: 0
    });
    assert.deepEqual(actionIds(selection), ["summarize_page", "find_related_pages", "quote_page"]);
    assert.equal(actionIds(selection).includes("explore_potential_links"), false);
  });

  it("maps an isolated single page to page actions plus the link action", () => {
    const selection = resolveSelection(multicommGraph(), { kind: "node", id: "island" });

    assert.deepEqual(selection.nodeIds, ["island"]);
    assert.deepEqual(selection.communityIds, ["solo"]);
    assert.deepEqual(selection.facts, {
      pageCount: 1,
      internalLinkCount: 0,
      communityCount: 1,
      isolatedCount: 1
    });
    assert.deepEqual(actionIds(selection), ["summarize_page", "find_related_pages", "quote_page", "link_island"]);
    assert.equal(actionIds(selection).includes("explore_potential_links"), false);
  });

  it("selects a community and offers single-community actions", () => {
    const selection = resolveSelection(multicommGraph(), { kind: "community", id: "alpha" });

    assert.deepEqual(selection.nodeIds, ["a1", "a2", "a3"]);
    assert.deepEqual(selection.communityIds, ["alpha"]);
    assert.deepEqual(selection.facts, {
      pageCount: 3,
      internalLinkCount: 2,
      communityCount: 1,
      isolatedCount: 0
    });
    assert.deepEqual(actionIds(selection), ["summarize_cluster", "find_knowledge_gaps", "create_topic_page"]);
  });

  it("selects one-hop neighbors and offers two-community bridge actions", () => {
    const selection = resolveSelection(multicommGraph(), { kind: "neighbors", id: "bridge" });

    assert.deepEqual(selection.nodeIds, ["a3", "bridge", "b1"]);
    assert.deepEqual(selection.communityIds, ["alpha", "beta"]);
    assert.deepEqual(selection.facts, {
      pageCount: 3,
      internalLinkCount: 2,
      communityCount: 2,
      isolatedCount: 0
    });
    assert.deepEqual(actionIds(selection), ["why_no_connection", "find_potential_bridges", "compare_communities"]);
  });

  it("selects shift-style manual nodes and avoids cluster summary for unlinked multi-select", () => {
    const selection = resolveSelection(multicommGraph(), { kind: "nodes", ids: ["a1", "b2"] });

    assert.deepEqual(selection.nodeIds, ["a1", "b2"]);
    assert.deepEqual(selection.communityIds, ["alpha", "beta"]);
    assert.deepEqual(selection.facts, {
      pageCount: 2,
      internalLinkCount: 0,
      communityCount: 2,
      isolatedCount: 0
    });
    assert.deepEqual(actionIds(selection), ["why_no_connection", "find_potential_bridges", "compare_communities"]);
    assert.equal(actionIds(selection).includes("summarize_cluster"), false);
  });

  it("maps linked manual multi-select to group actions", () => {
    const selection = resolveSelection(multicommGraph(), { kind: "nodes", ids: ["a1", "a2"] });

    assert.deepEqual(selection.nodeIds, ["a1", "a2"]);
    assert.deepEqual(selection.facts, {
      pageCount: 2,
      internalLinkCount: 1,
      communityCount: 1,
      isolatedCount: 0
    });
    assert.deepEqual(actionIds(selection), ["summarize_group", "explore_group_relationships"]);
    assert.equal(actionIds(selection).includes("summarize_cluster"), false);
  });

  it("maps unlinked multi-community selections beyond two communities to exploration actions", () => {
    const selection = resolveSelection(multicommGraph(), { kind: "nodes", ids: ["a1", "b2", "g1"] });

    assert.deepEqual(selection.nodeIds, ["a1", "b2", "g1"]);
    assert.deepEqual(selection.facts, {
      pageCount: 3,
      internalLinkCount: 0,
      communityCount: 3,
      isolatedCount: 0
    });
    assert.deepEqual(actionIds(selection), ["explore_potential_links", "compare_differences"]);
    assert.equal(actionIds(selection).includes("summarize_cluster"), false);
  });

  it("omits ask actions when onAsk capability is absent", () => {
    const selection = resolveSelectionForCapabilities(multicommGraph(), { kind: "community", id: "alpha" }, { canAsk: false });

    assert.deepEqual(selection.facts, {
      pageCount: 3,
      internalLinkCount: 2,
      communityCount: 1,
      isolatedCount: 0
    });
    assert.deepEqual(actionIds(selection), []);
  });
});

function actionIds(selection: { actions?: Array<{ id: SelectionActionId }> }): SelectionActionId[] {
  return (selection.actions ?? []).map((action) => action.id);
}

function multicommGraph(): GraphData {
  return {
    meta: {
      build_date: "2026-06-12T00:00:00.000Z",
      wiki_title: "Multicomm Fixture",
      total_nodes: 8,
      total_edges: 6
    },
    nodes: [
      { id: "a1", label: "Alpha 1", type: "topic", community: "alpha", source_path: "wiki/topics/a1.md" },
      { id: "a2", label: "Alpha 2", type: "entity", community: "alpha", source_path: "wiki/entities/a2.md" },
      { id: "a3", label: "Alpha 3", type: "entity", community: "alpha", source_path: "wiki/entities/a3.md" },
      { id: "bridge", label: "Bridge", type: "topic", community: "beta", source_path: "wiki/topics/bridge.md" },
      { id: "b1", label: "Beta 1", type: "entity", community: "beta", source_path: "wiki/entities/b1.md" },
      { id: "b2", label: "Beta 2", type: "entity", community: "beta", source_path: "wiki/entities/b2.md" },
      { id: "g1", label: "Gamma 1", type: "entity", community: "gamma", source_path: "wiki/entities/g1.md" },
      { id: "island", label: "Island", type: "source", community: "solo", source_path: "wiki/sources/island.md" }
    ],
    edges: [
      { id: "a1-a2", from: "a1", to: "a2", type: "EXTRACTED", weight: 1 },
      { id: "a2-a3", from: "a2", to: "a3", type: "EXTRACTED", weight: 1 },
      { id: "a3-bridge", from: "a3", to: "bridge", type: "INFERRED", weight: 0.7 },
      { id: "bridge-b1", from: "bridge", to: "b1", type: "EXTRACTED", weight: 1 },
      { id: "b1-b2", from: "b1", to: "b2", type: "EXTRACTED", weight: 1 },
      { id: "g1-a2", from: "g1", to: "a2", type: "AMBIGUOUS", weight: 0.4 }
    ],
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "a1", recommended_start_reason: "community_hub", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
        global: { enabled: true, node_ids: ["a1", "a2", "a3", "bridge", "b1", "b2", "g1", "island"], degraded: false }
      },
      communities: [
        { id: "alpha", label: "Alpha", node_count: 3, color_index: 0 },
        { id: "beta", label: "Beta", node_count: 3, color_index: 1 },
        { id: "gamma", label: "Gamma", node_count: 1, color_index: 2 },
        { id: "solo", label: "Solo", node_count: 1, color_index: 3 }
      ]
    }
  };
}

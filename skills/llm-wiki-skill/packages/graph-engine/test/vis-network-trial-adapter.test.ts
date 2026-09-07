import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCommunityAggregationMarkers } from "../src";
import type { GraphData, PinMap } from "../src/types";
import { buildVisNetworkTrialModel } from "./vis-network-trial-adapter";

describe("vis-network trial adapter", () => {
  it("preserves graph semantics for the isolated Canvas comparison route", () => {
    const data = graphFixture();
    const pins: PinMap = {
      "wiki/a.md": { x: 10, y: 20, coordinateSpace: "world" }
    };
    const aggregationMarkers = buildCommunityAggregationMarkers(data, {
      pins,
      searchResultIds: ["b"],
      selectedNodeIds: ["a"],
      minCommunitySize: 2
    });

    const model = buildVisNetworkTrialModel(data, {
      pins,
      searchResultIds: ["b"],
      selection: { kind: "node", id: "a" },
      aggregationMarkers
    });

    assert.equal(model.nodes.length, 3);
    assert.equal(model.edges.length, 2);
    assert.deepEqual(model.nodes.map((node) => node.id), ["a", "b", "c"]);
    assert.equal(model.nodes.find((node) => node.id === "a")?.selected, true);
    assert.equal(model.nodes.find((node) => node.id === "a")?.pinned, true);
    assert.equal(model.nodes.find((node) => node.id === "b")?.searchHit, true);
    assert.equal(model.nodes.find((node) => node.id === "b")?.communityId, "alpha");
    assert.deepEqual(model.communities.map((community) => community.id), ["alpha", "beta"]);
    assert.deepEqual(model.communities.find((community) => community.id === "alpha")?.searchResultIds, ["b"]);
    assert.equal(model.aggregations.length, 1);
    assert.deepEqual(model.aggregations[0]?.selectedNodeIds, ["a"]);
    assert.deepEqual(model.aggregations[0]?.searchResultIds, ["b"]);
    assert.deepEqual(model.aggregations[0]?.pinnedNodeIds, ["a"]);

    assert.equal(model.behavior.route, "candidate-global");
    assert.deepEqual(model.behavior.searchHighlight.map((item) => item.nodeId), ["b"]);
    assert.deepEqual(model.behavior.pinInsideAggregation[0]?.pinnedNodeIds, ["a"]);
    assert.deepEqual(model.behavior.selectedObjectInsideAggregation[0]?.selectedNodeIds, ["a"]);
    assert.ok(model.behavior.containerSelect.some((item) => item.containerId === "alpha"));
    assert.ok(model.behavior.enterCommunity.some((item) => item.communityId === "alpha"));
  });
});

function graphFixture(): GraphData {
  return {
    meta: {
      build_date: "2026-06-19T00:00:00.000Z",
      wiki_title: "vis-network trial adapter",
      total_nodes: 3,
      total_edges: 2
    },
    nodes: [
      { id: "a", label: "Alpha", type: "topic", community: "alpha", source_path: "wiki/a.md", x: 0, y: 0 },
      { id: "b", label: "Beta needle", type: "entity", community: "alpha", source_path: "wiki/b.md", x: 10, y: 0 },
      { id: "c", label: "Gamma", type: "source", community: "beta", source_path: "wiki/c.md", x: 20, y: 0 }
    ],
    edges: [
      { id: "a-b", from: "a", to: "b", type: "EXTRACTED", weight: 1 },
      { id: "b-c", from: "b", to: "c", type: "INFERRED", weight: 0.7 }
    ],
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "a", recommended_start_reason: "fixture", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: false },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: false },
        global: { enabled: true, node_ids: ["a", "b", "c"], degraded: false }
      },
      communities: [
        { id: "alpha", label: "Alpha", node_count: 2 },
        { id: "beta", label: "Beta", node_count: 1 }
      ]
    }
  };
}

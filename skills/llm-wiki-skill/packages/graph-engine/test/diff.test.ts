import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { diffGraphData } from "../src/diff";
import type { GraphData, GraphEdge, GraphNode } from "../src/types";

describe("graph diff with community alignment", () => {
  it("does not report recolors or new communities when community ids are shuffled", () => {
    const previous = graph([
      node("a", "old-alpha"),
      node("b", "old-alpha"),
      node("c", "old-beta"),
      node("d", "old-beta")
    ]);
    const next = graph([
      node("a", "new-1"),
      node("b", "new-1"),
      node("c", "new-2"),
      node("d", "new-2")
    ]);

    const diff = diffGraphData(previous, next);

    assert.deepEqual(diff.recoloredNodes, []);
    assert.deepEqual(diff.newCommunities, []);
  });

  it("reports added and removed nodes and edges", () => {
    const previous = graph(
      [node("a", "alpha"), node("b", "alpha"), node("removed", "alpha")],
      [edge("a-b", "a", "b"), edge("removed-edge", "b", "removed")]
    );
    const next = graph(
      [node("a", "alpha"), node("b", "alpha"), node("added", "alpha")],
      [edge("a-b", "a", "b"), edge("added-edge", "b", "added")]
    );

    const diff = diffGraphData(previous, next);

    assert.deepEqual(diff.addedNodes, ["added"]);
    assert.deepEqual(diff.removedNodes, ["removed"]);
    assert.deepEqual(diff.addedEdges, ["added-edge"]);
    assert.deepEqual(diff.removedEdges, ["removed-edge"]);
    assert.equal(diff.stats.nodeCount, 3);
    assert.equal(diff.stats.edgeCount, 2);
  });

  it("reports real recolors after aligned community matching", () => {
    const previous = graph([
      node("a", "alpha"),
      node("b", "alpha"),
      node("c", "beta"),
      node("d", "beta")
    ]);
    const next = graph([
      node("a", "alpha-renamed"),
      node("b", "alpha-renamed"),
      node("c", "beta-renamed"),
      node("d", "alpha-renamed")
    ]);

    const diff = diffGraphData(previous, next);

    assert.deepEqual(diff.recoloredNodes, [{ id: "d", from: "beta", to: "alpha-renamed" }]);
    assert.deepEqual(diff.newCommunities, []);
  });

  it("reports unmatched new communities", () => {
    const previous = graph([node("a", "alpha"), node("b", "alpha")]);
    const next = graph([
      node("a", "alpha"),
      node("b", "alpha"),
      node("c", "gamma"),
      node("d", "gamma")
    ]);

    const diff = diffGraphData(previous, next);

    assert.deepEqual(diff.addedNodes, ["c", "d"]);
    assert.deepEqual(diff.newCommunities, ["gamma"]);
    assert.equal(diff.stats.communityCount, 2);
  });

  it("treats a real community color change as recolored", () => {
    const previous = graph([node("a", "alpha"), node("b", "alpha"), node("c", "beta"), node("d", "beta")]);
    const next = graph([node("a", "alpha"), node("b", "alpha"), node("c", "beta"), node("d", "alpha")]);

    const diff = diffGraphData(previous, next);

    assert.deepEqual(diff.recoloredNodes, [{ id: "d", from: "beta", to: "alpha" }]);
  });

  it("handles a community split by preserving the larger overlap and marking the smaller half as new", () => {
    const previous = graph([
      node("a", "alpha"),
      node("b", "alpha"),
      node("c", "alpha"),
      node("d", "alpha")
    ]);
    const next = graph([
      node("a", "alpha-main"),
      node("b", "alpha-main"),
      node("c", "alpha-main"),
      node("d", "alpha-split")
    ]);

    const diff = diffGraphData(previous, next);

    assert.deepEqual(diff.recoloredNodes, []);
    assert.deepEqual(diff.newCommunities, ["alpha-split"]);
  });
});

function graph(nodes: GraphNode[], edges: GraphEdge[] = []): GraphData {
  return {
    meta: {
      build_date: "2026-06-12T00:00:00.000Z",
      wiki_title: "Diff Fixture",
      total_nodes: nodes.length,
      total_edges: edges.length
    },
    nodes,
    edges
  };
}

function node(id: string, community: string): GraphNode {
  return { id, label: id.toUpperCase(), type: "entity", community, source_path: `wiki/entities/${id}.md` };
}

function edge(id: string, from: string, to: string): GraphEdge {
  return { id, from, to, type: "EXTRACTED", weight: 1 };
}

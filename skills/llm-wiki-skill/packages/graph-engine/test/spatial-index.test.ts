import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GraphSpatialIndex, createGraphSpatialIndex } from "../src/layout";
import type { GraphSpatialNodeLike } from "../src/layout";

function baseNodes(): GraphSpatialNodeLike[] {
  return [
    { id: "a", label: "Alpha", type: "entity", point: { x: 100, y: 100 }, hitBounds: { x: 70, y: 80, width: 60, height: 40 } },
    { id: "b", label: "Beta", type: "entity", point: { x: 260, y: 100 }, hitBounds: { x: 230, y: 80, width: 60, height: 40 } }
  ];
}

describe("GraphSpatialIndex", () => {
  it("hits nodes through spatial bounds instead of DOM targets", () => {
    const index = createGraphSpatialIndex({ nodes: baseNodes() });

    assert.deepEqual(index.hitTest({ x: 126, y: 118 }), { kind: "node", id: "a" });
    assert.deepEqual(index.hitTest({ x: 131, y: 121 }), { kind: "graph-blank" });
  });

  it("hits edges with a world-space tolerance", () => {
    const index = createGraphSpatialIndex({
      nodes: baseNodes(),
      edges: [{ id: "a-b", source: "a", target: "b", curveOffset: 0 }]
    });

    assert.deepEqual(index.hitTest({ x: 180, y: 88 }), { kind: "edge", id: "a-b" });
    assert.deepEqual(index.hitTest({ x: 180, y: 125 }), { kind: "graph-blank" });
  });

  it("hits community washes with ellipse geometry", () => {
    const index = createGraphSpatialIndex({
      nodes: [],
      communities: [{ id: "c1", wash: { cx: 400, cy: 300, rx: 90, ry: 50 } }]
    });

    assert.deepEqual(index.hitTest({ x: 450, y: 315 }), { kind: "community-wash", id: "c1" });
    assert.deepEqual(index.hitTest({ x: 500, y: 315 }), { kind: "graph-blank" });
  });

  it("keeps node priority above edge and community overlap", () => {
    const index = createGraphSpatialIndex({
      nodes: [
        { id: "node", point: { x: 200, y: 200 }, hitBounds: { x: 190, y: 190, width: 20, height: 20 } },
        { id: "left", point: { x: 120, y: 200 }, hitBounds: { x: 110, y: 190, width: 20, height: 20 } },
        { id: "right", point: { x: 280, y: 200 }, hitBounds: { x: 270, y: 190, width: 20, height: 20 } }
      ],
      edges: [{ id: "left-right", source: "left", target: "right", curveOffset: 0 }],
      communities: [{ id: "community", wash: { cx: 200, cy: 200, rx: 120, ry: 80 } }]
    });

    assert.deepEqual(index.hitTest({ x: 200, y: 200 }), { kind: "node", id: "node" });
  });

  it("keeps edge priority above community overlap when no node is hit", () => {
    const index = createGraphSpatialIndex({
      nodes: [
        { id: "left", point: { x: 120, y: 200 }, hitBounds: { x: 110, y: 190, width: 20, height: 20 } },
        { id: "right", point: { x: 280, y: 200 }, hitBounds: { x: 270, y: 190, width: 20, height: 20 } }
      ],
      edges: [{ id: "left-right", source: "left", target: "right", curveOffset: 0 }],
      communities: [{ id: "community", wash: { cx: 200, cy: 200, rx: 120, ry: 80 } }]
    });

    assert.deepEqual(index.hitTest({ x: 200, y: 188 }), { kind: "edge", id: "left-right" });
  });

  it("orders node, edge, community wash, and blank hits through one spatial path", () => {
    const index = createGraphSpatialIndex({
      nodes: [
        { id: "node", point: { x: 200, y: 200 }, hitBounds: { x: 190, y: 190, width: 20, height: 20 } },
        { id: "left", point: { x: 120, y: 200 }, hitBounds: { x: 110, y: 190, width: 20, height: 20 } },
        { id: "right", point: { x: 280, y: 200 }, hitBounds: { x: 270, y: 190, width: 20, height: 20 } }
      ],
      edges: [{ id: "left-right", source: "left", target: "right", curveOffset: 0 }],
      communities: [{ id: "community", wash: { cx: 200, cy: 200, rx: 120, ry: 80 } }]
    });

    assert.deepEqual(index.hitTest({ x: 200, y: 200 }), { kind: "node", id: "node" });
    assert.deepEqual(index.hitTest({ x: 200, y: 188 }), { kind: "edge", id: "left-right" });
    assert.deepEqual(index.hitTest({ x: 200, y: 250 }), { kind: "community-wash", id: "community" });
    assert.deepEqual(index.hitTest({ x: 200, y: 330 }), { kind: "graph-blank" });
  });

  it("returns blank when no graph object owns the point", () => {
    const index = createGraphSpatialIndex({
      nodes: baseNodes(),
      edges: [{ id: "a-b", source: "a", target: "b" }],
      communities: [{ id: "c1", wash: { cx: 180, cy: 100, rx: 120, ry: 45 } }]
    });

    assert.deepEqual(index.hitTest({ x: -120, y: 900 }), { kind: "graph-blank" });
  });

  it("supports nodes outside the old 1000x680 world", () => {
    const index = createGraphSpatialIndex({
      nodes: [
        { id: "outlier", point: { x: 1320, y: -180 }, hitBounds: { x: 1280, y: -205, width: 80, height: 50 } }
      ],
      communities: [{ id: "far", wash: { cx: 1320, cy: -180, rx: 110, ry: 70 } }]
    });

    assert.deepEqual(index.hitTest({ x: 1335, y: -170 }), { kind: "node", id: "outlier" });
  });

  it("requires rebuild after drag or pin movement instead of mutating quadtree coordinates in place", () => {
    const nodes = baseNodes();
    const original = createGraphSpatialIndex({ nodes });

    nodes[0] = { ...nodes[0], point: { x: 500, y: 460 }, hitBounds: { x: 470, y: 440, width: 60, height: 40 } };
    assert.deepEqual(original.hitTest({ x: 100, y: 100 }), { kind: "node", id: "a" });
    assert.deepEqual(original.hitTest({ x: 500, y: 460 }), { kind: "graph-blank" });

    const rebuilt = original.rebuild({ nodes });
    assert.deepEqual(rebuilt.hitTest({ x: 500, y: 460 }), { kind: "node", id: "a" });
    assert.deepEqual(rebuilt.hitTest({ x: 100, y: 100 }), { kind: "graph-blank" });
  });

  it("keeps dense node lookup on the spatial index path", () => {
    const nodes = denseNodes(1000);
    const edges = nodes.slice(1).map((node, index) => ({
      id: `edge-${index}`,
      source: nodes[index].id,
      target: node.id
    }));
    const index = createGraphSpatialIndex({ nodes, edges });

    assert.deepEqual(index.hitTest({ x: 520, y: 328 }), { kind: "node", id: "node-500" });
    assert.deepEqual(index.hitTest({ x: 40, y: 40 }), { kind: "node", id: "node-0" });
  });

  it("prefilters dense edge lookups without losing edge hits", () => {
    const nodes = denseNodes(1000);
    const edges = nodes.slice(1).map((node, index) => ({
      id: `edge-${index}`,
      source: nodes[index].id,
      target: node.id
    }));
    const index = createGraphSpatialIndex({ nodes, edges });

    assert.deepEqual(index.hitTest({ x: 52, y: 29 }), { kind: "edge", id: "edge-0" });
    assert.deepEqual(index.hitTest({ x: 5000, y: 5000 }), { kind: "graph-blank" });
  });

  it("uses the edge spatial index before curved-edge distance checks", () => {
    const nodes = denseNodes(1200);
    const edges = nodes.slice(1).map((node, index) => ({
      id: `edge-${index}`,
      source: nodes[index].id,
      target: node.id
    }));
    const index = new GraphSpatialIndex({ nodes, edges });

    assert.equal(index.edgeCandidateCount({ x: 5000, y: 5000 }), 0);
    assert.deepEqual(index.hitTest({ x: 5000, y: 5000 }), { kind: "graph-blank" });

    const nearCandidateCount = index.edgeCandidateCount({ x: 52, y: 29 });
    assert.ok(
      nearCandidateCount > 0 && nearCandidateCount < edges.length / 5,
      `dense edge lookup should visit a bounded candidate set, visited ${nearCandidateCount} of ${edges.length}`
    );
    assert.deepEqual(index.hitTest({ x: 52, y: 29 }), { kind: "edge", id: "edge-0" });
  });

  it("keeps local edge candidates bounded when a long edge is present", () => {
    const localNodes = denseNodes(600);
    const farNodes = Array.from({ length: 600 }, (_, index) => {
      const x = 8000 + index % 30 * 36;
      const y = 8000 + Math.floor(index / 30) * 36;
      return {
        id: `far-${index}`,
        label: `Far ${index}`,
        type: "entity",
        point: { x, y },
        hitBounds: { x: x - 8, y: y - 8, width: 16, height: 16 }
      };
    });
    const nodes = [
      ...localNodes,
      ...farNodes,
      { id: "long-a", point: { x: -5000, y: -5000 }, hitBounds: { x: -5010, y: -5010, width: 20, height: 20 } },
      { id: "long-b", point: { x: 12000, y: 12000 }, hitBounds: { x: 11990, y: 11990, width: 20, height: 20 } }
    ];
    const localEdges = localNodes.slice(1).map((node, index) => ({
      id: `local-edge-${index}`,
      source: localNodes[index].id,
      target: node.id
    }));
    const farEdges = farNodes.slice(1).map((node, index) => ({
      id: `far-edge-${index}`,
      source: farNodes[index].id,
      target: node.id
    }));
    const edges = [
      ...localEdges,
      ...farEdges,
      { id: "long-edge", source: "long-a", target: "long-b" }
    ];
    const index = new GraphSpatialIndex({ nodes, edges });

    const candidateCount = index.edgeCandidateCount({ x: 52, y: 29 });
    assert.ok(
      candidateCount > 0 && candidateCount < 20,
      `long edge should not force unrelated edges into a local lookup, visited ${candidateCount} of ${edges.length}`
    );
    assert.deepEqual(index.hitTest({ x: 52, y: 29 }), { kind: "edge", id: "local-edge-0" });
  });
});

function denseNodes(count: number): GraphSpatialNodeLike[] {
  return Array.from({ length: count }, (_, index) => {
    const x = 40 + index % 40 * 24;
    const y = 40 + Math.floor(index / 40) * 24;
    return {
      id: `node-${index}`,
      label: `Node ${index}`,
      type: index % 5 === 0 ? "topic" : "entity",
      point: { x, y },
      hitBounds: { x: x - 12, y: y - 10, width: 24, height: 20 }
    };
  });
}

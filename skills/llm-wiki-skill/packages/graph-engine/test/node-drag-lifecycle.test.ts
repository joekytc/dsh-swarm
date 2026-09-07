import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createLiveGraphSimulation, PinState } from "../src/sim";
import { buildRenderableGraph } from "../src/render";
import { cancelGraphNodeDrag, commitGraphNodeDrag, type GraphNodeDragSession } from "../src/render/node-drag-lifecycle";
import type { GraphData, PinMap } from "../src/types";

describe("graph node drag lifecycle", () => {
  it("commits a real drag by pinning the final world position", () => {
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });
    const simulation = createLiveGraphSimulation(graph);
    const pinState = new PinState(graph);

    simulation.beginDrag("drag");
    simulation.dragTo("drag", { x: 460, y: 300 });

    const result = commitGraphNodeDrag({ nodeId: "drag", simulation, pinState });

    assert.deepEqual(result.pinPosition, { x: 460, y: 300 });
    assert.deepEqual(result.pins, {
      "wiki/drag.md": { x: 460, y: 300, coordinateSpace: "world" }
    });
    assert.deepEqual(result.pinnedNodeIds, ["drag"]);
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fx, 460);
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fy, 300);
    simulation.destroy();
  });

  it("commits a fast release by applying the final pointer target before pinning", () => {
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });
    const simulation = createLiveGraphSimulation(graph);
    const pinState = new PinState(graph);

    simulation.beginDrag("drag");
    simulation.dragTo("drag", { x: 460, y: 300 });

    const result = commitGraphNodeDrag({
      nodeId: "drag",
      simulation,
      pinState,
      finalWorldPoint: { x: 620, y: 410 }
    });

    assert.deepEqual(result.pinPosition, { x: 620, y: 410 });
    assert.deepEqual(result.pins, {
      "wiki/drag.md": { x: 620, y: 410, coordinateSpace: "world" }
    });
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fx, 620);
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fy, 410);
    simulation.destroy();
  });

  it("commits a drag outside the old default world instead of clamping it back", () => {
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });
    const simulation = createLiveGraphSimulation(graph);
    const pinState = new PinState(graph);

    simulation.beginDrag("drag");
    simulation.dragTo("drag", { x: 1240, y: 816 });

    const result = commitGraphNodeDrag({ nodeId: "drag", simulation, pinState });

    assert.deepEqual(result.pinPosition, { x: 1240, y: 816 });
    assert.deepEqual(result.pins, {
      "wiki/drag.md": { x: 1240, y: 816, coordinateSpace: "world" }
    });
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fx, 1240);
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fy, 816);
    simulation.destroy();
  });

  it("cancels an unpinned drag by restoring the start position without writing a pin", () => {
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui" });
    const simulation = createLiveGraphSimulation(graph);
    const pinState = new PinState(graph);
    const startWorldPoint = graph.nodes.find((node) => node.id === "drag")?.point;
    assert.ok(startWorldPoint);

    simulation.beginDrag("drag");
    simulation.dragTo("drag", { x: 540, y: 420 });
    const result = cancelGraphNodeDrag({
      simulation,
      pinState,
      session: session({ startWorldPoint, wasPinned: false })
    });

    assert.deepEqual(result.pins, {});
    assert.deepEqual(result.pinnedNodeIds, []);
    assert.deepEqual(result.restoredPosition, startWorldPoint);
    assert.equal(result.restoredFixed, false);
    assert.deepEqual(result.positions.drag, startWorldPoint);
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fx, null);
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fy, null);
    simulation.destroy();
  });

  it("cancels a pinned drag by restoring the previous pin and keeping it fixed", () => {
    const pins: PinMap = {
      "wiki/drag.md": { x: 320, y: 240, coordinateSpace: "world" }
    };
    const graph = buildRenderableGraph(sampleGraph(), { theme: "shan-shui", pins });
    const simulation = createLiveGraphSimulation(graph);
    const pinState = new PinState(graph, pins);
    const startWorldPoint = pins["wiki/drag.md"];
    assert.ok(startWorldPoint);
    assert.deepEqual(startWorldPoint, { x: 320, y: 240, coordinateSpace: "world" });

    simulation.beginDrag("drag");
    simulation.dragTo("drag", { x: 700, y: 500 });
    const result = cancelGraphNodeDrag({
      simulation,
      pinState,
      session: session({ startWorldPoint, wasPinned: true })
    });

    assert.deepEqual(result.pins, pins);
    assert.deepEqual(result.pinnedNodeIds, ["drag"]);
    assert.deepEqual(result.positions.drag, { x: 320, y: 240 });
    assert.equal(result.restoredFixed, true);
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fx, 320);
    assert.equal(simulation.nodes.find((node) => node.id === "drag")?.fy, 240);
    simulation.destroy();
  });
});

function session(options: { startWorldPoint: { x: number; y: number }; wasPinned: boolean }): GraphNodeDragSession {
  return {
    pointerId: 1,
    nodeId: "drag",
    startWorldPoint: options.startWorldPoint,
    wasPinned: options.wasPinned
  };
}

function sampleGraph(): GraphData {
  return {
    meta: {
      build_date: "2026-06-12T00:00:00.000Z",
      wiki_title: "Drag Lifecycle Fixture",
      total_nodes: 3,
      total_edges: 1
    },
    nodes: [
      { id: "drag", label: "Drag", type: "topic", community: "c1", source_path: "wiki/drag.md", weight: 80, x: 20, y: 50 },
      { id: "near", label: "Near", type: "entity", community: "c1", source_path: "wiki/near.md", weight: 50, x: 32, y: 50 },
      { id: "far", label: "Far", type: "entity", community: "c2", source_path: "wiki/far.md", weight: 20, x: 85, y: 50 }
    ],
    edges: [
      { id: "drag-near", from: "drag", to: "near", type: "EXTRACTED", weight: 1 }
    ],
    learning: {
      version: 1,
      entry: { recommended_start_node_id: "drag", recommended_start_reason: "community_hub", default_mode: "global" },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
        global: { enabled: true, node_ids: ["drag", "near", "far"], degraded: false }
      },
      communities: [
        { id: "c1", label: "Core", node_count: 2, color_index: 0, recommended_start_node_id: "drag" },
        { id: "c2", label: "Edge", node_count: 1, color_index: 1 }
      ]
    }
  };
}

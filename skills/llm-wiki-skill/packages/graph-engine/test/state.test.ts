import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createGraphRuntimeState, DEFAULT_RENDERER_VIEWPORT } from "../src/render";

describe("GraphRuntimeState", () => {
  it("starts with explicit graph-local state defaults", () => {
    const state = createGraphRuntimeState();

    assert.deepEqual(state.snapshot(), {
      viewport: DEFAULT_RENDERER_VIEWPORT,
      positions: {},
      pins: {},
      hover: null,
      selection: null,
      selectionSurface: null,
      focus: null,
      activeGesture: null
    });
  });

  it("updates viewport, hover, selection, focus, pins, positions, and active gesture through one owner", () => {
    const state = createGraphRuntimeState({
      positions: { a: { x: 100, y: 200 } },
      pins: { "wiki/a.md": { x: 100, y: 200 } }
    });

    state.setViewport({ x: -120, y: 64, scale: 1.75 });
    state.setHover({ kind: "node", id: "a" });
    state.setSelection({ kind: "node", id: "a" }, "reader");
    state.setFocus({ kind: "community", id: "c1" });
    state.commitPosition("a", { x: 130, y: 215 });
    state.setPins({ "wiki/a.md": { x: 130, y: 215 } });
    state.setActiveGesture({
      kind: "node-drag",
      pointerId: 7,
      nodeId: "a",
      grabOffset: { x: 12, y: -4 },
      startWorldPoint: { x: 100, y: 200 },
      wasPinned: true,
      locked: true
    });

    assert.deepEqual(state.snapshot(), {
      viewport: { x: -120, y: 64, scale: 1.75 },
      positions: { a: { x: 130, y: 215 } },
      pins: { "wiki/a.md": { x: 130, y: 215 } },
      hover: { kind: "node", id: "a" },
      selection: { kind: "node", id: "a" },
      selectionSurface: "reader",
      focus: { kind: "community", id: "c1" },
      activeGesture: {
        kind: "node-drag",
        pointerId: 7,
        nodeId: "a",
        grabOffset: { x: 12, y: -4 },
        startWorldPoint: { x: 100, y: 200 },
        wasPinned: true,
        locked: true
      }
    });
  });

  it("supports multi selection, community hover, viewport pan gesture, and subscribers", () => {
    const state = createGraphRuntimeState();
    const snapshots: unknown[] = [];
    const unsubscribe = state.subscribe((snapshot) => snapshots.push(snapshot));

    state.setSelection({ kind: "nodes", ids: ["a", "b"] });
    state.setHover({ kind: "community", id: "c1" });
    state.setActiveGesture({
      kind: "viewport-pan",
      pointerId: 12,
      lastScreenPoint: { x: 320, y: 240 },
      locked: false
    });
    unsubscribe();
    state.setHover({ kind: "edge", id: "edge-1" });

    assert.equal(snapshots.length, 3);
    assert.deepEqual(state.snapshot().selection, { kind: "nodes", ids: ["a", "b"] });
    assert.equal(state.snapshot().selectionSurface, "selection-panel");
    assert.deepEqual(state.snapshot().hover, { kind: "edge", id: "edge-1" });
    assert.deepEqual(state.snapshot().activeGesture, {
      kind: "viewport-pan",
      pointerId: 12,
      lastScreenPoint: { x: 320, y: 240 },
      locked: false
    });
  });

  it("keeps simulation proposals out of committed positions until explicitly committed", () => {
    const state = createGraphRuntimeState({
      positions: { a: { x: 100, y: 200 } }
    });
    const proposal = { a: { x: 300, y: 400 } };

    assert.deepEqual(state.snapshot().positions, { a: { x: 100, y: 200 } });
    state.setPositions(proposal);
    proposal.a.x = 999;

    assert.deepEqual(state.snapshot().positions, { a: { x: 300, y: 400 } });
    state.commitPosition("a", { x: 320, y: 420 });
    assert.deepEqual(state.snapshot().positions, { a: { x: 320, y: 420 } });
  });

  it("returns cloned snapshots so callers cannot mutate hidden state", () => {
    const state = createGraphRuntimeState({
      positions: { a: { x: 100, y: 200 } },
      pins: { "wiki/a.md": { x: 100, y: 200, coordinateSpace: "world" } },
      selection: { kind: "nodes", ids: ["a"] },
      activeGesture: {
        kind: "node-drag",
        pointerId: 1,
        nodeId: "a",
        grabOffset: { x: 4, y: 5 },
        startWorldPoint: { x: 100, y: 200 },
        wasPinned: true,
        locked: true
      }
    });
    const snapshot = state.snapshot();

    snapshot.positions.a.x = 999;
    snapshot.pins["wiki/a.md"].x = 999;
    if (snapshot.selection?.kind === "nodes") snapshot.selection.ids.push("b");
    if (snapshot.activeGesture?.kind === "node-drag") snapshot.activeGesture.grabOffset.x = 999;
    if (snapshot.activeGesture?.kind === "node-drag") snapshot.activeGesture.startWorldPoint.x = 999;

    assert.deepEqual(state.snapshot().positions, { a: { x: 100, y: 200 } });
    assert.deepEqual(state.snapshot().pins, { "wiki/a.md": { x: 100, y: 200, coordinateSpace: "world" } });
    assert.deepEqual(state.snapshot().selection, { kind: "nodes", ids: ["a"] });
    assert.equal(state.snapshot().selectionSurface, "selection-panel");
    assert.deepEqual(state.snapshot().activeGesture, {
      kind: "node-drag",
      pointerId: 1,
      nodeId: "a",
      grabOffset: { x: 4, y: 5 },
      startWorldPoint: { x: 100, y: 200 },
      wasPinned: true,
      locked: true
    });
  });

  it("clears graph interaction state without changing viewport, positions, or pins", () => {
    const state = createGraphRuntimeState({
      viewport: { x: -20, y: 10, scale: 1.5 },
      positions: { a: { x: 100, y: 200 } },
      pins: { "wiki/a.md": { x: 100, y: 200 } },
      hover: { kind: "node", id: "a" },
      selection: { kind: "node", id: "a" },
      selectionSurface: "reader",
      focus: { kind: "community", id: "c1" },
      activeGesture: { kind: "community-click", pointerId: 9, communityId: "c1", locked: false }
    });

    state.clearInteraction();

    assert.deepEqual(state.snapshot(), {
      viewport: { x: -20, y: 10, scale: 1.5 },
      positions: { a: { x: 100, y: 200 } },
      pins: { "wiki/a.md": { x: 100, y: 200 } },
      hover: null,
      selection: null,
      selectionSurface: null,
      focus: null,
      activeGesture: null
    });
  });

  it("preserves pin coordinate space markers across runtime snapshots", () => {
    const state = createGraphRuntimeState({
      pins: {
        "wiki/world.md": { x: 8, y: -12, coordinateSpace: "world" },
        "wiki/legacy.md": { x: 80, y: 50, coordinateSpace: "legacy-percent" }
      }
    });

    state.setPins({
      "wiki/world.md": { x: 9, y: -13, coordinateSpace: "world" },
      "wiki/old.md": { x: 75, y: 40 }
    });

    assert.deepEqual(state.snapshot().pins, {
      "wiki/world.md": { x: 9, y: -13, coordinateSpace: "world" },
      "wiki/old.md": { x: 75, y: 40 }
    });
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GRAPH_GESTURE_BLOCKER_TARGET_KINDS,
  GRAPH_GESTURE_SELECTORS,
  GRAPH_OWNED_TARGET_KINDS,
  GraphGestureController,
  GraphGestureStateMachine,
  classifyGraphEventTarget,
  classifyGraphPointerDownTarget,
  classifyGraphWheelTarget,
  graphGestureTargetOwnership,
  isGraphGestureBlockerTarget,
  isGraphOwnedGestureTarget,
  type GraphGestureIntent,
  type GraphGestureTarget,
  type GraphGestureTargetLike
} from "../src/render";

class FakeTarget implements GraphGestureTargetLike {
  readonly dataset: Record<string, string | undefined>;
  readonly tagName?: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
  private readonly matchesBySelector = new Map<string, FakeTarget | null>();

  constructor(options: {
    dataset?: Record<string, string | undefined>;
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
    closest?: Record<string, FakeTarget | null>;
  } = {}) {
    this.dataset = options.dataset || {};
    this.tagName = options.tagName;
    this.type = options.type;
    this.isContentEditable = options.isContentEditable;
    for (const [selector, target] of Object.entries(options.closest || {})) {
      this.matchesBySelector.set(selector, target);
    }
  }

  closest(selector: string): GraphGestureTargetLike | null {
    if (matchesSelf(this, selector)) return this;
    return this.matchesBySelector.get(selector) || null;
  }
}

describe("graph gesture target classifier", () => {
  it("declares graph-owned targets and gesture blockers as a stable contract", () => {
    assert.deepEqual([...GRAPH_OWNED_TARGET_KINDS], ["graph-blank", "node", "community-wash", "aggregation-container", "edge"]);
    assert.deepEqual([...GRAPH_GESTURE_BLOCKER_TARGET_KINDS], [
      "minimap",
      "toolbar",
      "search",
      "legend",
      "drawer",
      "text-control",
      "unknown"
    ]);
    assert.equal(GRAPH_GESTURE_SELECTORS.node, ".node");
    assert.equal(GRAPH_GESTURE_SELECTORS.communityWash, ".community-wash");
    assert.equal(GRAPH_GESTURE_SELECTORS.drawer, ".graph-reader, .graph-selection-panel, [data-graph-drawer=\"true\"]");
  });

  it("classifies graph-owned targets separately from gesture blockers", () => {
    const graphOwnedTargets: GraphGestureTarget[] = [
      { kind: "graph-blank" },
      { kind: "node", id: "node-a" },
      { kind: "community-wash", id: "community-a" },
      { kind: "edge", id: "edge-a" }
    ];
    const blockerTargets: GraphGestureTarget[] = [
      { kind: "minimap" },
      { kind: "toolbar" },
      { kind: "search" },
      { kind: "legend" },
      { kind: "drawer" },
      { kind: "text-control" },
      { kind: "unknown" }
    ];

    for (const target of graphOwnedTargets) {
      assert.equal(isGraphOwnedGestureTarget(target), true);
      assert.equal(isGraphGestureBlockerTarget(target), false);
      assert.equal(graphGestureTargetOwnership(target), "graph-owned");
    }
    for (const target of blockerTargets) {
      assert.equal(isGraphOwnedGestureTarget(target), false);
      assert.equal(isGraphGestureBlockerTarget(target), true);
      assert.equal(graphGestureTargetOwnership(target), "graph-blocker");
    }
  });

  it("classifies graph target kinds and ids without a DOM dependency", () => {
    assert.deepEqual(classifyGraphEventTarget(blankTarget()), { kind: "graph-blank" });
    assert.deepEqual(classifyGraphEventTarget(graphBlankTarget()), { kind: "graph-blank" });

    assert.deepEqual(classifyGraphEventTarget(nodeTarget("node-a")), { kind: "node", id: "node-a" });
    assert.deepEqual(classifyGraphEventTarget(communityWashTarget("community-a")), { kind: "community-wash", id: "community-a" });
    assert.deepEqual(classifyGraphEventTarget(edgeTarget("edge-a")), { kind: "edge", id: "edge-a" });

    assert.deepEqual(classifyGraphEventTarget(controlTarget(".mini-map")), { kind: "minimap" });
    assert.deepEqual(classifyGraphEventTarget(controlTarget(".graph-toolbar")), { kind: "toolbar" });
    assert.deepEqual(classifyGraphEventTarget(controlTarget(".graph-search")), { kind: "search" });
    assert.deepEqual(classifyGraphEventTarget(controlTarget(".community-legend")), { kind: "legend" });
    assert.deepEqual(classifyGraphEventTarget(controlTarget(".graph-reader, .graph-selection-panel, [data-graph-drawer=\"true\"]")), { kind: "drawer" });
    assert.deepEqual(classifyGraphEventTarget(new FakeTarget({ tagName: "input", type: "search" })), { kind: "text-control" });
  });

  it("lets wheel zoom over blank, node, community wash, and edge targets", () => {
    assert.equal(classifyGraphWheelTarget(blankTarget()).intent, "zoom");
    assert.equal(classifyGraphWheelTarget(nodeTarget("node-a")).intent, "zoom");
    assert.equal(classifyGraphWheelTarget(communityWashTarget("community-a")).intent, "zoom");
    assert.equal(classifyGraphWheelTarget(edgeTarget("edge-a")).intent, "zoom");
  });

  it("routes browser zoom shortcut wheels to graph zoom on graph-owned targets", () => {
    assert.deepEqual(classifyGraphWheelTarget(nodeTarget("node-a"), { metaKey: true }), {
      intent: "zoom",
      target: { kind: "node", id: "node-a" }
    });
    assert.deepEqual(classifyGraphWheelTarget(blankTarget(), { ctrlKey: true }), {
      intent: "zoom",
      target: { kind: "graph-blank" }
    });
    assert.deepEqual(classifyGraphWheelTarget(communityWashTarget("community-a"), { ctrlKey: true }), {
      intent: "zoom",
      target: { kind: "community-wash", id: "community-a" }
    });
    assert.deepEqual(classifyGraphWheelTarget(edgeTarget("edge-a"), { metaKey: true }), {
      intent: "zoom",
      target: { kind: "edge", id: "edge-a" }
    });
  });

  it("blocks wheel zoom over controls, drawers, minimap, and text editing targets", () => {
    for (const target of [
      controlTarget(".graph-search"),
      controlTarget(".graph-toolbar"),
      controlTarget(".community-legend"),
      controlTarget(".graph-reader, .graph-selection-panel, [data-graph-drawer=\"true\"]"),
      controlTarget(".mini-map"),
      new FakeTarget({ tagName: "textarea" }),
      new FakeTarget({ tagName: "input", type: "text" }),
      new FakeTarget({ isContentEditable: true })
    ]) {
      assert.equal(classifyGraphWheelTarget(target).intent, "blocked");
      assert.equal(classifyGraphWheelTarget(target, { ctrlKey: true }).intent, "blocked");
      assert.equal(classifyGraphWheelTarget(target, { metaKey: true }).intent, "blocked");
    }
  });

  it("classifies pointerdown candidates for node drag, community click, and graph pan", () => {
    assert.deepEqual(classifyGraphPointerDownTarget(nodeTarget("node-a")), {
      intent: "node-drag-candidate",
      target: { kind: "node", id: "node-a" }
    });
    assert.deepEqual(classifyGraphPointerDownTarget(communityWashTarget("community-a")), {
      intent: "community-click-candidate",
      target: { kind: "community-wash", id: "community-a" }
    });
    assert.deepEqual(classifyGraphPointerDownTarget(blankTarget()), {
      intent: "blank-pan-candidate",
      target: { kind: "graph-blank" }
    });
    assert.deepEqual(classifyGraphPointerDownTarget(edgeTarget("edge-a")), {
      intent: "blank-pan-candidate",
      target: { kind: "edge", id: "edge-a" }
    });
  });

  it("blocks pointerdown over non-gesture controls", () => {
    assert.deepEqual(classifyGraphPointerDownTarget(controlTarget(".mini-map")), {
      intent: "blocked",
      target: { kind: "minimap" }
    });
    assert.deepEqual(classifyGraphPointerDownTarget(controlTarget(".graph-toolbar")), {
      intent: "blocked",
      target: { kind: "toolbar" }
    });
    assert.deepEqual(classifyGraphPointerDownTarget(new FakeTarget({ tagName: "input", type: "text" })), {
      intent: "blocked",
      target: { kind: "text-control" }
    });
  });
});

describe("graph gesture state machine", () => {
  it("turns a low-movement node pointer sequence into a node click intent", () => {
    const machine = new GraphGestureStateMachine({ dragThreshold: 4 });
    machine.pointerDown(classifyGraphPointerDownTarget(nodeTarget("node-a")), pointer(7, 100, 100));

    assert.deepEqual(machine.pointerMove(pointer(7, 102, 102)), []);
    assert.deepEqual(machine.pointerUp(pointer(7, 102, 102)), [
      { kind: "node-click", nodeId: "node-a", additive: false, pointerId: 7 }
    ]);
    assert.equal(machine.snapshot(), null);
  });

  it("turns a high-movement node pointer sequence into drag start, move, and end intents without a click", () => {
    const machine = new GraphGestureStateMachine({ dragThreshold: 4 });
    machine.pointerDown(classifyGraphPointerDownTarget(nodeTarget("node-a")), pointer(8, 10, 10));

    assert.deepEqual(machine.pointerMove(pointer(8, 20, 18)), [
      { kind: "node-drag-start", nodeId: "node-a", pointerId: 8, screenPoint: { x: 20, y: 18 } },
      { kind: "node-drag-move", nodeId: "node-a", pointerId: 8, screenPoint: { x: 20, y: 18 }, delta: { x: 10, y: 8 } }
    ]);
    assert.deepEqual(machine.pointerMove(pointer(8, 25, 28)), [
      { kind: "node-drag-move", nodeId: "node-a", pointerId: 8, screenPoint: { x: 25, y: 28 }, delta: { x: 5, y: 10 } }
    ]);
    assert.deepEqual(machine.pointerUp(pointer(8, 25, 28)), [
      { kind: "node-drag-end", nodeId: "node-a", pointerId: 8, screenPoint: { x: 25, y: 28 } }
    ]);
    assert.equal(machine.snapshot(), null);
  });

  it("preserves shift additive state for node clicks", () => {
    const machine = new GraphGestureStateMachine({ dragThreshold: 4 });
    machine.pointerDown(classifyGraphPointerDownTarget(nodeTarget("node-a")), pointer(9, 40, 40, { shiftKey: true }));

    assert.deepEqual(machine.pointerUp(pointer(9, 40, 40)), [
      { kind: "node-click", nodeId: "node-a", additive: true, pointerId: 9 }
    ]);
  });

  it("turns a low-movement community wash sequence into a community click", () => {
    const machine = new GraphGestureStateMachine({ dragThreshold: 4 });
    machine.pointerDown(classifyGraphPointerDownTarget(communityWashTarget("community-a")), pointer(10, 120, 80));

    assert.deepEqual(machine.pointerMove(pointer(10, 121, 82)), []);
    assert.deepEqual(machine.pointerUp(pointer(10, 121, 82)), [
      { kind: "community-click", communityId: "community-a", pointerId: 10 }
    ]);
  });

  it("cancels a community click after movement above threshold", () => {
    const machine = new GraphGestureStateMachine({ dragThreshold: 4 });
    machine.pointerDown(classifyGraphPointerDownTarget(communityWashTarget("community-a")), pointer(11, 0, 0));

    assert.deepEqual(machine.pointerMove(pointer(11, 10, 0)), [
      { kind: "community-click-cancelled", communityId: "community-a", pointerId: 11, reason: "moved" }
    ]);
    assert.deepEqual(machine.pointerUp(pointer(11, 10, 0)), []);
  });

  it("turns blank canvas movement into pan intents and low movement into blank click", () => {
    const machine = new GraphGestureStateMachine({ dragThreshold: 4 });
    machine.pointerDown(classifyGraphPointerDownTarget(blankTarget()), pointer(12, 50, 50));
    assert.deepEqual(machine.pointerUp(pointer(12, 51, 51)), [{ kind: "blank-click", pointerId: 12 }]);

    machine.pointerDown(classifyGraphPointerDownTarget(blankTarget()), pointer(13, 50, 50));
    assert.deepEqual(machine.pointerMove(pointer(13, 58, 52)), [
      { kind: "blank-pan-start", pointerId: 13, screenPoint: { x: 58, y: 52 } },
      { kind: "blank-pan-move", pointerId: 13, screenPoint: { x: 58, y: 52 }, delta: { x: 8, y: 2 } }
    ]);
    assert.deepEqual(machine.pointerMove(pointer(13, 60, 57)), [
      { kind: "blank-pan-move", pointerId: 13, screenPoint: { x: 60, y: 57 }, delta: { x: 2, y: 5 } }
    ]);
    assert.deepEqual(machine.pointerUp(pointer(13, 60, 57)), [
      { kind: "blank-pan-end", pointerId: 13, screenPoint: { x: 60, y: 57 } }
    ]);
  });

  it("cleans up active gestures on pointercancel and lostpointercapture without false clicks or pins", () => {
    const nodeMachine = new GraphGestureStateMachine({ dragThreshold: 4 });
    nodeMachine.pointerDown(classifyGraphPointerDownTarget(nodeTarget("node-a")), pointer(14, 0, 0));
    nodeMachine.pointerMove(pointer(14, 10, 0));
    assert.deepEqual(nodeMachine.pointerCancel({ pointerId: 14 }), [
      { kind: "node-drag-cancel", nodeId: "node-a", pointerId: 14, reason: "pointercancel" }
    ]);
    assert.equal(nodeMachine.snapshot(), null);

    const lostNodeMachine = new GraphGestureStateMachine({ dragThreshold: 4 });
    lostNodeMachine.pointerDown(classifyGraphPointerDownTarget(nodeTarget("node-a")), pointer(20, 0, 0));
    lostNodeMachine.pointerMove(pointer(20, 10, 0));
    assert.deepEqual(lostNodeMachine.lostPointerCapture({ pointerId: 20 }), [
      { kind: "node-drag-cancel", nodeId: "node-a", pointerId: 20, reason: "lostpointercapture" }
    ]);
    assert.equal(lostNodeMachine.snapshot(), null);

    const clickMachine = new GraphGestureStateMachine({ dragThreshold: 4 });
    clickMachine.pointerDown(classifyGraphPointerDownTarget(nodeTarget("node-a")), pointer(15, 0, 0));
    assert.deepEqual(clickMachine.pointerCancel({ pointerId: 15 }), []);
    assert.deepEqual(clickMachine.pointerUp(pointer(15, 0, 0)), []);

    const panMachine = new GraphGestureStateMachine({ dragThreshold: 4 });
    panMachine.pointerDown(classifyGraphPointerDownTarget(blankTarget()), pointer(16, 0, 0));
    panMachine.pointerMove(pointer(16, 10, 0));
    assert.deepEqual(panMachine.lostPointerCapture({ pointerId: 16 }), [
      { kind: "blank-pan-cancel", pointerId: 16, reason: "lostpointercapture" }
    ]);
    assert.equal(panMachine.snapshot(), null);
  });

  it("lets Escape cancel active drag, community, and pan gestures", () => {
    const dragMachine = new GraphGestureStateMachine({ dragThreshold: 4 });
    dragMachine.pointerDown(classifyGraphPointerDownTarget(nodeTarget("node-a")), pointer(17, 0, 0));
    dragMachine.pointerMove(pointer(17, 10, 0));
    assert.deepEqual(dragMachine.escape(), [
      { kind: "node-drag-cancel", nodeId: "node-a", pointerId: 17, reason: "escape" }
    ]);

    const communityMachine = new GraphGestureStateMachine({ dragThreshold: 4 });
    communityMachine.pointerDown(classifyGraphPointerDownTarget(communityWashTarget("community-a")), pointer(18, 0, 0));
    assert.deepEqual(communityMachine.escape(), [
      { kind: "community-click-cancelled", communityId: "community-a", pointerId: 18, reason: "escape" }
    ]);

    const panMachine = new GraphGestureStateMachine({ dragThreshold: 4 });
    panMachine.pointerDown(classifyGraphPointerDownTarget(blankTarget()), pointer(19, 0, 0));
    panMachine.pointerMove(pointer(19, 10, 0));
    assert.deepEqual(panMachine.escape(), [
      { kind: "blank-pan-cancel", pointerId: 19, reason: "escape" }
    ]);
  });
});

describe("graph gesture controller", () => {
  it("owns root wheel and pointer event bindings and releases them on destroy", () => {
    const root = new FakeGestureRoot();
    const zoomed: Array<{ target: string; deltaY: number }> = [];
    const intents: GraphGestureIntent[] = [];
    const activeSnapshots: unknown[] = [];
    const controller = new GraphGestureController(root as unknown as HTMLElement, {
      targetFromEventTarget: (target) => target as GraphGestureTargetLike | null,
      onWheelZoom: (event, decision) => {
        event.preventDefault();
        zoomed.push({ target: decision.target.kind, deltaY: event.deltaY });
      },
      onGestureIntents: (nextIntents) => {
        intents.push(...nextIntents);
      },
      onActiveStateChange: (active) => {
        activeSnapshots.push(active);
      }
    });

    const wheel = wheelDomEvent(nodeTarget("node-a"), 24);
    root.dispatch("wheel", wheel);
    assert.equal(wheel.defaultPrevented, true);
    assert.deepEqual(zoomed, [{ target: "node", deltaY: 24 }]);

    const pointerDown = pointerDomEvent(nodeTarget("node-a"), 21, 10, 10);
    root.dispatch("pointerdown", pointerDown);
    assert.equal(pointerDown.defaultPrevented, true);
    assert.equal(root.hasPointerCapture(21), true);
    const pointerMove = pointerDomEvent(nodeTarget("node-a"), 21, 20, 18);
    root.dispatch("pointermove", pointerMove);
    assert.equal(pointerMove.defaultPrevented, true);
    const pointerUp = pointerDomEvent(nodeTarget("node-a"), 21, 20, 18);
    root.dispatch("pointerup", pointerUp);
    assert.equal(pointerUp.defaultPrevented, true);
    assert.equal(root.hasPointerCapture(21), false);
    assert.deepEqual(intents, [
      { kind: "node-drag-start", nodeId: "node-a", pointerId: 21, screenPoint: { x: 20, y: 18 } },
      { kind: "node-drag-move", nodeId: "node-a", pointerId: 21, screenPoint: { x: 20, y: 18 }, delta: { x: 10, y: 8 } },
      { kind: "node-drag-end", nodeId: "node-a", pointerId: 21, screenPoint: { x: 20, y: 18 } }
    ]);
    assert.ok(activeSnapshots.length >= 3);

    controller.destroy();
    root.dispatch("wheel", wheelDomEvent(nodeTarget("node-b"), 12));
    assert.deepEqual(zoomed, [{ target: "node", deltaY: 24 }]);
  });

  it("prevents browser default zoom for shortcut wheels over graph-owned targets", () => {
    const root = new FakeGestureRoot();
    const zoomed: Array<{ target: string; ctrlKey: boolean; metaKey: boolean }> = [];
    const controller = new GraphGestureController(root as unknown as HTMLElement, {
      targetFromEventTarget: (target) => target as GraphGestureTargetLike | null,
      onWheelZoom: (event, decision) => {
        event.preventDefault();
        zoomed.push({ target: decision.target.kind, ctrlKey: event.ctrlKey, metaKey: event.metaKey });
      },
      onGestureIntents: () => {}
    });

    const nodeWheel = wheelDomEvent(nodeTarget("node-a"), -18, { ctrlKey: true });
    root.dispatch("wheel", nodeWheel);
    assert.equal(nodeWheel.defaultPrevented, true);

    const blankWheel = wheelDomEvent(blankTarget(), -12, { metaKey: true });
    root.dispatch("wheel", blankWheel);
    assert.equal(blankWheel.defaultPrevented, true);

    const searchWheel = wheelDomEvent(controlTarget(".graph-search"), -8, { ctrlKey: true });
    root.dispatch("wheel", searchWheel);
    assert.equal(searchWheel.defaultPrevented, false);

    assert.deepEqual(zoomed, [
      { target: "node", ctrlKey: true, metaKey: false },
      { target: "graph-blank", ctrlKey: false, metaKey: true }
    ]);

    controller.destroy();
  });

  it("uses spatial graph targets for graph-owned DOM instead of DOM stacking order", () => {
    const root = new FakeGestureRoot();
    const zoomed: GraphGestureTarget[] = [];
    const pointerDecisions: GraphGestureTarget[] = [];
    const controller = new GraphGestureController(root as unknown as HTMLElement, {
      targetFromEventTarget: (target) => target as GraphGestureTargetLike | null,
      graphTargetFromScreenPoint: () => ({ kind: "node", id: "node-from-spatial-index" }),
      onWheelZoom: (_event, decision) => {
        zoomed.push(decision.target);
      },
      onPointerDown: (_event, decision) => {
        pointerDecisions.push(decision.target);
      },
      onGestureIntents: () => {}
    });

    const stackedCommunity = communityWashTarget("community-from-dom");
    const wheel = wheelDomEvent(stackedCommunity, -20);
    root.dispatch("wheel", wheel);
    assert.equal(wheel.defaultPrevented, true);

    const pointerDown = pointerDomEvent(stackedCommunity, 51, 260, 220);
    root.dispatch("pointerdown", pointerDown);
    assert.equal(pointerDown.defaultPrevented, true);
    assert.equal(root.hasPointerCapture(51), true);

    assert.deepEqual(zoomed, [{ kind: "node", id: "node-from-spatial-index" }]);
    assert.deepEqual(pointerDecisions, [{ kind: "node", id: "node-from-spatial-index" }]);

    controller.destroy();
  });

  it("keeps aggregation container DOM ownership above spatial hits", () => {
    const root = new FakeGestureRoot();
    const zoomed: GraphGestureTarget[] = [];
    const pointerDecisions: GraphGestureTarget[] = [];
    const controller = new GraphGestureController(root as unknown as HTMLElement, {
      targetFromEventTarget: (target) => target as GraphGestureTargetLike | null,
      graphTargetFromScreenPoint: () => ({ kind: "node", id: "node-behind-container" }),
      onWheelZoom: (_event, decision) => {
        zoomed.push(decision.target);
      },
      onPointerDown: (_event, decision) => {
        pointerDecisions.push(decision.target);
      },
      onGestureIntents: () => {}
    });

    const container = aggregationContainerTarget("agg-t1", "t1");
    const wheel = wheelDomEvent(container, -20);
    root.dispatch("wheel", wheel);
    assert.equal(wheel.defaultPrevented, true);

    const pointerDown = pointerDomEvent(container, 52, 260, 220);
    root.dispatch("pointerdown", pointerDown);
    assert.equal(pointerDown.defaultPrevented, true);
    assert.equal(root.hasPointerCapture(52), true);

    assert.deepEqual(zoomed, [{ kind: "aggregation-container", id: "agg-t1", communityId: "t1" }]);
    assert.deepEqual(pointerDecisions, [{ kind: "community-wash", id: "t1" }]);

    controller.destroy();
  });

  it("uses DOM blank ownership for return-global double-click while graph objects and blockers keep defaults", () => {
    const root = new FakeGestureRoot();
    let resetCount = 0;
    const controller = new GraphGestureController(root as unknown as HTMLElement, {
      targetFromEventTarget: (target) => target as GraphGestureTargetLike | null,
      graphTargetFromScreenPoint: () => ({ kind: "node", id: "node-from-spatial-index" }),
      onWheelZoom: () => {},
      onGestureIntents: () => {},
      onBlankDoubleClick: () => {
        resetCount += 1;
      }
    });

    const blankDoubleClick = mouseDomEvent(blankTarget(), 10, 40);
    root.dispatch("dblclick", blankDoubleClick);
    assert.equal(blankDoubleClick.defaultPrevented, true);
    assert.equal(resetCount, 1);

    const svgBlankDoubleClick = mouseDomEvent(graphBlankTarget(), 12, 42);
    root.dispatch("dblclick", svgBlankDoubleClick);
    assert.equal(svgBlankDoubleClick.defaultPrevented, true);
    assert.equal(resetCount, 2);

    const blankSecondClick = mouseDomEvent(graphBlankTarget(), 12, 42, { detail: 2, timeStamp: 2000 });
    root.dispatch("click", blankSecondClick);
    assert.equal(blankSecondClick.defaultPrevented, true);
    assert.equal(resetCount, 3);

    const duplicateDblClick = mouseDomEvent(graphBlankTarget(), 12, 42, { detail: 2, timeStamp: 2100 });
    root.dispatch("dblclick", duplicateDblClick);
    assert.equal(duplicateDblClick.defaultPrevented, false);
    assert.equal(resetCount, 3);

    const communityDoubleClick = mouseDomEvent(communityWashTarget("community-from-dom"), 10, 40);
    root.dispatch("dblclick", communityDoubleClick);
    assert.equal(communityDoubleClick.defaultPrevented, false);
    assert.equal(resetCount, 3);

    const edgeDoubleClick = mouseDomEvent(edgeTarget("edge-from-dom"), 20, 40);
    root.dispatch("dblclick", edgeDoubleClick);
    assert.equal(edgeDoubleClick.defaultPrevented, false);
    assert.equal(resetCount, 3);

    const edgeThenBlankPointerDown = pointerDomEvent(edgeTarget("edge-from-dom"), 61, 24, 44, { timeStamp: 3000 });
    root.dispatch("pointerdown", edgeThenBlankPointerDown);
    root.dispatch("pointerup", pointerDomEvent(graphBlankTarget(), 61, 24, 44, { timeStamp: 3020 }));
    const edgeThenBlankClick = mouseDomEvent(blankTarget(), 24, 44, { detail: 2, timeStamp: 3040 });
    root.dispatch("click", edgeThenBlankClick);
    const edgeThenBlankDoubleClick = mouseDomEvent(blankTarget(), 24, 44, { detail: 2, timeStamp: 3060 });
    root.dispatch("dblclick", edgeThenBlankDoubleClick);
    assert.equal(edgeThenBlankClick.defaultPrevented, false);
    assert.equal(edgeThenBlankDoubleClick.defaultPrevented, false);
    assert.equal(resetCount, 3);

    const nodeDoubleClick = mouseDomEvent(nodeTarget("node-from-dom"), 30, 40);
    root.dispatch("dblclick", nodeDoubleClick);
    assert.equal(nodeDoubleClick.defaultPrevented, false);
    assert.equal(resetCount, 3);

    const searchDoubleClick = mouseDomEvent(controlTarget(".graph-search"), 10, 40);
    root.dispatch("dblclick", searchDoubleClick);
    assert.equal(searchDoubleClick.defaultPrevented, false);
    assert.equal(resetCount, 3);

    controller.destroy();
  });

  it("does not prevent browser defaults over gesture blocker pointer targets", () => {
    const root = new FakeGestureRoot();
    const intents: GraphGestureIntent[] = [];
    const controller = new GraphGestureController(root as unknown as HTMLElement, {
      targetFromEventTarget: (target) => target as GraphGestureTargetLike | null,
      onWheelZoom: () => {},
      onGestureIntents: (nextIntents) => {
        intents.push(...nextIntents);
      }
    });

    const blockerCases: Array<[string, GraphGestureTargetLike]> = [
      ["search", controlTarget(".graph-search")],
      ["toolbar", controlTarget(".graph-toolbar")],
      ["drawer", controlTarget(".graph-reader, .graph-selection-panel, [data-graph-drawer=\"true\"]")],
      ["minimap", controlTarget(".mini-map")],
      ["text-control", new FakeTarget({ tagName: "input", type: "text" })]
    ];

    for (const [label, target] of blockerCases) {
      const pointerDown = pointerDomEvent(target, 31, 10, 10);
      root.dispatch("pointerdown", pointerDown);

      assert.equal(pointerDown.defaultPrevented, false, `${label} pointerdown should not be owned by graph gestures`);
      assert.equal(root.hasPointerCapture(31), false, `${label} pointerdown should not capture the pointer`);
      assert.equal(controller.snapshot(), null, `${label} pointerdown should not start an active graph gesture`);
    }

    assert.deepEqual(intents, []);

    controller.destroy();
  });

  it("cleans up controller-owned active gestures on pointercancel and lostpointercapture", () => {
    const root = new FakeGestureRoot();
    const intents: GraphGestureIntent[] = [];
    const controller = new GraphGestureController(root as unknown as HTMLElement, {
      targetFromEventTarget: (target) => target as GraphGestureTargetLike | null,
      onWheelZoom: () => {},
      onGestureIntents: (nextIntents) => {
        intents.push(...nextIntents);
      }
    });

    const nodePointerDown = pointerDomEvent(nodeTarget("node-a"), 41, 10, 10);
    root.dispatch("pointerdown", nodePointerDown);
    root.dispatch("pointermove", pointerDomEvent(nodeTarget("node-a"), 41, 20, 10));
    assert.equal(root.hasPointerCapture(41), true);

    const nodeCancel = pointerDomEvent(nodeTarget("node-a"), 41, 20, 10);
    root.dispatch("pointercancel", nodeCancel);

    assert.equal(nodeCancel.defaultPrevented, true);
    assert.equal(root.hasPointerCapture(41), false);
    assert.equal(controller.snapshot(), null);

    const blankPointerDown = pointerDomEvent(blankTarget(), 42, 100, 100);
    root.dispatch("pointerdown", blankPointerDown);
    root.dispatch("pointermove", pointerDomEvent(blankTarget(), 42, 116, 100));
    assert.equal(root.hasPointerCapture(42), true);
    root.releasePointerCapture(42);
    root.dispatch("lostpointercapture", pointerDomEvent(blankTarget(), 42, 116, 100));

    assert.equal(controller.snapshot(), null);
    assert.deepEqual(intents, [
      { kind: "node-drag-start", nodeId: "node-a", pointerId: 41, screenPoint: { x: 20, y: 10 } },
      { kind: "node-drag-move", nodeId: "node-a", pointerId: 41, screenPoint: { x: 20, y: 10 }, delta: { x: 10, y: 0 } },
      { kind: "node-drag-cancel", nodeId: "node-a", pointerId: 41, reason: "pointercancel" },
      { kind: "blank-pan-start", pointerId: 42, screenPoint: { x: 116, y: 100 } },
      { kind: "blank-pan-move", pointerId: 42, screenPoint: { x: 116, y: 100 }, delta: { x: 16, y: 0 } },
      { kind: "blank-pan-cancel", pointerId: 42, reason: "lostpointercapture" }
    ]);

    controller.destroy();
  });
});

function blankTarget(): FakeTarget {
  return new FakeTarget();
}

function graphBlankTarget(): FakeTarget {
  const blank = new FakeTarget({ dataset: { graphBlank: "true" } });
  return new FakeTarget({ closest: { "[data-graph-blank=\"true\"]": blank } });
}

function nodeTarget(id: string): FakeTarget {
  const node = new FakeTarget({ dataset: { id } });
  return new FakeTarget({ closest: { ".node": node } });
}

function communityWashTarget(id: string): FakeTarget {
  const wash = new FakeTarget({ dataset: { communityId: id } });
  return new FakeTarget({ closest: { ".community-wash": wash } });
}

function aggregationContainerTarget(id: string, communityId: string): FakeTarget {
  const container = new FakeTarget({ dataset: { aggregationId: id, communityId } });
  return new FakeTarget({ closest: { ".aggregation-container": container } });
}

function edgeTarget(id: string): FakeTarget {
  const edge = new FakeTarget({ dataset: { edgeId: id } });
  return new FakeTarget({ closest: { ".edge": edge } });
}

function controlTarget(selector: string): FakeTarget {
  const control = new FakeTarget();
  return new FakeTarget({ closest: { [selector]: control } });
}

function pointer(pointerId: number, x: number, y: number, options: { shiftKey?: boolean } = {}) {
  return {
    pointerId,
    screenPoint: { x, y },
    shiftKey: options.shiftKey
  };
}

class FakeGestureRoot {
  private readonly listeners = new Map<string, Set<(event: any) => void>>();
  private readonly pointerCaptures = new Set<number>();

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: any): void {
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }

  setPointerCapture(pointerId: number): void {
    this.pointerCaptures.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.pointerCaptures.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.pointerCaptures.delete(pointerId);
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
}

function wheelDomEvent(
  target: GraphGestureTargetLike,
  deltaY: number,
  options: { ctrlKey?: boolean; metaKey?: boolean } = {}
): WheelEvent & { defaultPrevented: boolean } {
  let defaultPrevented = false;
  return {
    target,
    deltaY,
    deltaMode: 0,
    ctrlKey: options.ctrlKey === true,
    metaKey: options.metaKey === true,
    preventDefault: () => {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    }
  } as WheelEvent & { defaultPrevented: boolean };
}

function pointerDomEvent(
  target: GraphGestureTargetLike,
  pointerId: number,
  clientX: number,
  clientY: number,
  options: { button?: number; shiftKey?: boolean; timeStamp?: number } = {}
): PointerEvent & { defaultPrevented: boolean } {
  let defaultPrevented = false;
  return {
    target,
    pointerId,
    clientX,
    clientY,
    timeStamp: options.timeStamp ?? 0,
    button: options.button ?? 0,
    shiftKey: options.shiftKey === true,
    preventDefault: () => {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    }
  } as PointerEvent & { defaultPrevented: boolean };
}

function mouseDomEvent(
  target: GraphGestureTargetLike,
  clientX: number,
  clientY: number,
  options: { detail?: number; timeStamp?: number } = {}
): MouseEvent & { defaultPrevented: boolean; propagationStopped: boolean } {
  let defaultPrevented = false;
  let propagationStopped = false;
  return {
    target,
    clientX,
    clientY,
    detail: options.detail ?? 1,
    timeStamp: options.timeStamp ?? 0,
    preventDefault: () => {
      defaultPrevented = true;
    },
    stopPropagation: () => {
      propagationStopped = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
    get propagationStopped() {
      return propagationStopped;
    }
  } as MouseEvent & { defaultPrevented: boolean; propagationStopped: boolean };
}

function matchesSelf(target: FakeTarget, selector: string): boolean {
  if (selector.includes("[contenteditable=\"true\"]") && target.isContentEditable) return true;
  if (selector.includes("textarea") && target.tagName?.toLowerCase() === "textarea") return true;
  if (selector.includes("select") && target.tagName?.toLowerCase() === "select") return true;
  if (selector.includes("[data-graph-text-control=\"true\"]") && target.dataset.graphTextControl === "true") return true;
  return false;
}

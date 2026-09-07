import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyGraphEventTarget,
  classifyGraphPointerDownTarget,
  classifyGraphPointerDownTargetFromGraphTarget,
  classifyGraphWheelTargetFromGraphTarget,
  createGraphSpatialIndex,
  graphSpatialHitToGestureTarget,
  type GraphGestureTargetLike
} from "../src";

class FakeTarget implements GraphGestureTargetLike {
  readonly dataset: Record<string, string | undefined>;
  private readonly matchesBySelector = new Map<string, FakeTarget | null>();

  constructor(options: { dataset?: Record<string, string | undefined>; closest?: Record<string, FakeTarget | null> } = {}) {
    this.dataset = options.dataset || {};
    for (const [selector, target] of Object.entries(options.closest || {})) {
      this.matchesBySelector.set(selector, target);
    }
  }

  closest(selector: string): GraphGestureTargetLike | null {
    return this.matchesBySelector.get(selector) || null;
  }
}

describe("graph interaction contract", () => {
  it("lets SpatialIndex, not DOM stacking order, choose the graph object intent", () => {
    const index = createGraphSpatialIndex({
      nodes: [
        { id: "node-a", point: { x: 200, y: 200 }, hitBounds: { x: 175, y: 180, width: 50, height: 40 } },
        { id: "left", point: { x: 120, y: 200 }, hitBounds: { x: 110, y: 190, width: 20, height: 20 } },
        { id: "right", point: { x: 280, y: 200 }, hitBounds: { x: 270, y: 190, width: 20, height: 20 } }
      ],
      edges: [{ id: "left-right", source: "left", target: "right", curveOffset: 0 }],
      communities: [{ id: "community-a", wash: { cx: 200, cy: 200, rx: 120, ry: 80 } }]
    });
    const stackedCommunityDomTarget = communityWashDomTarget("community-a");

    assert.deepEqual(classifyGraphEventTarget(stackedCommunityDomTarget), { kind: "community-wash", id: "community-a" });

    const spatialTarget = graphSpatialHitToGestureTarget(index.hitTest({ x: 200, y: 200 }));
    assert.deepEqual(spatialTarget, { kind: "node", id: "node-a" });
    assert.deepEqual(classifyGraphPointerDownTargetFromGraphTarget(spatialTarget), {
      intent: "node-drag-candidate",
      target: { kind: "node", id: "node-a" }
    });
    assert.deepEqual(classifyGraphWheelTargetFromGraphTarget(spatialTarget), {
      intent: "zoom",
      target: { kind: "node", id: "node-a" }
    });
  });

  it("keeps edge, community, and blank intents available through the same spatial target path", () => {
    const index = createGraphSpatialIndex({
      nodes: [
        { id: "node-a", point: { x: 100, y: 100 }, hitBounds: { x: 80, y: 80, width: 40, height: 40 } },
        { id: "node-b", point: { x: 220, y: 100 }, hitBounds: { x: 200, y: 80, width: 40, height: 40 } }
      ],
      edges: [{ id: "edge-a", source: "node-a", target: "node-b" }],
      communities: [{ id: "community-a", wash: { cx: 260, cy: 180, rx: 80, ry: 44 } }]
    });

    assert.deepEqual(
      classifyGraphPointerDownTargetFromGraphTarget(graphSpatialHitToGestureTarget(index.hitTest({ x: 160, y: 90 }))),
      {
        intent: "blank-pan-candidate",
        target: { kind: "edge", id: "edge-a" }
      }
    );
    assert.deepEqual(
      classifyGraphPointerDownTargetFromGraphTarget(graphSpatialHitToGestureTarget(index.hitTest({ x: 260, y: 180 }))),
      {
        intent: "community-click-candidate",
        target: { kind: "community-wash", id: "community-a" }
      }
    );
    assert.deepEqual(
      classifyGraphPointerDownTargetFromGraphTarget(graphSpatialHitToGestureTarget(index.hitTest({ x: 500, y: 500 }))),
      {
        intent: "blank-pan-candidate",
        target: { kind: "graph-blank" }
      }
    );
  });

  it("keeps UI blockers as the DOM boundary before graph-object hit testing", () => {
    assert.deepEqual(classifyGraphPointerDownTarget(toolbarDomTarget()), {
      intent: "blocked",
      target: { kind: "toolbar" }
    });
  });
});

function communityWashDomTarget(id: string): FakeTarget {
  const community = new FakeTarget({ dataset: { communityId: id } });
  return new FakeTarget({ closest: { ".community-wash": community } });
}

function toolbarDomTarget(): FakeTarget {
  const toolbar = new FakeTarget();
  return new FakeTarget({ closest: { ".graph-toolbar": toolbar } });
}

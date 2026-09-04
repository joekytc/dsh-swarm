import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  beginGraphNodeDrag,
  resolveGraphNodeDragTarget,
  screenPointToWorldPoint,
  worldPointToScreenPoint
} from "../src/render";
import type { GraphScreenPoint, GraphWorldPoint, RendererViewport, RendererViewportSize } from "../src/render";

const VIEWPORT_SIZE: RendererViewportSize = { width: 1000, height: 680 };

function assertNear(actual: number, expected: number, message?: string): void {
  assert.ok(Math.abs(actual - expected) < 0.01, `${message ?? "number"}: expected ${expected}, got ${actual}`);
}

function assertPointNear(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  assertNear(actual.x, expected.x, "x");
  assertNear(actual.y, expected.y, "y");
}

describe("graph node drag simulation bridge", () => {
  it("keeps the grabbed point under the pointer when the viewport is panned and zoomed", () => {
    const viewport: RendererViewport = { x: -180, y: 72, scale: 2.4 };
    const nodeWorldPoint: GraphWorldPoint = { x: 360, y: 240 };
    const nodeScreenPoint = worldPointToScreenPoint(nodeWorldPoint, viewport, VIEWPORT_SIZE);
    const pointerScreenPoint: GraphScreenPoint = {
      x: nodeScreenPoint.x + 30,
      y: nodeScreenPoint.y - 18
    };

    const drag = beginGraphNodeDrag({
      nodeWorldPoint,
      pointerScreenPoint,
      viewport,
      viewportSize: VIEWPORT_SIZE
    });
    const movedPointer: GraphScreenPoint = {
      x: pointerScreenPoint.x + 144,
      y: pointerScreenPoint.y + 96
    };
    const target = resolveGraphNodeDragTarget({
      pointerScreenPoint: movedPointer,
      viewport,
      viewportSize: VIEWPORT_SIZE,
      grabOffset: drag.grabOffset
    });

    const grabbedWorldPoint = {
      x: target.x + drag.grabOffset.x,
      y: target.y + drag.grabOffset.y
    };
    assertPointNear(worldPointToScreenPoint(grabbedWorldPoint, viewport, VIEWPORT_SIZE), movedPointer);
  });

  it("starts a drag at the current node point instead of jumping to the pointer center", () => {
    const viewport: RendererViewport = { x: -320, y: -140, scale: 1.75 };
    const nodeWorldPoint: GraphWorldPoint = { x: 700, y: 410 };
    const pointerScreenPoint: GraphScreenPoint = {
      x: worldPointToScreenPoint(nodeWorldPoint, viewport, VIEWPORT_SIZE).x - 48,
      y: worldPointToScreenPoint(nodeWorldPoint, viewport, VIEWPORT_SIZE).y + 22
    };

    const drag = beginGraphNodeDrag({
      nodeWorldPoint,
      pointerScreenPoint,
      viewport,
      viewportSize: VIEWPORT_SIZE
    });

    assertPointNear(drag.targetWorldPoint, nodeWorldPoint);
    assertPointNear(drag.pointerWorldPoint, screenPointToWorldPoint(pointerScreenPoint, viewport, VIEWPORT_SIZE));
  });

  it("does not clamp off-world drag targets inside projection or bridge helpers", () => {
    const viewport: RendererViewport = { x: -120, y: -80, scale: 1.2 };
    const nodeWorldPoint: GraphWorldPoint = { x: 980, y: 650 };
    const drag = beginGraphNodeDrag({
      nodeWorldPoint,
      pointerScreenPoint: worldPointToScreenPoint(nodeWorldPoint, viewport, VIEWPORT_SIZE),
      viewport,
      viewportSize: VIEWPORT_SIZE
    });

    const target = resolveGraphNodeDragTarget({
      pointerScreenPoint: { x: 1380, y: 930 },
      viewport,
      viewportSize: VIEWPORT_SIZE,
      grabOffset: drag.grabOffset
    });

    assert.ok(target.x > 1000, `x should remain outside layout bounds before simulation constraints, got ${target.x}`);
    assert.ok(target.y > 680, `y should remain outside layout bounds before simulation constraints, got ${target.y}`);
  });
});

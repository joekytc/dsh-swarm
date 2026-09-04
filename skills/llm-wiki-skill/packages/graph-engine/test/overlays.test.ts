import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  graphEdgeHoverAnchor,
  graphNodeHoverAnchor,
  resolveGraphHoverPreviewPosition,
  worldPointToScreenPoint
} from "../src/render";
import type { RendererViewport, RendererViewportSize } from "../src/render";

const VIEWPORT_SIZE: RendererViewportSize = { width: 1000, height: 680 };

function assertNear(actual: number, expected: number, message?: string): void {
  assert.ok(Math.abs(actual - expected) < 0.001, `${message ?? "number"} expected ${expected}, got ${actual}`);
}

function assertPointNear(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  assertNear(actual.x, expected.x, "x");
  assertNear(actual.y, expected.y, "y");
}

describe("graph overlay anchors", () => {
  it("positions node hover anchors from projected screen points", () => {
    const viewport: RendererViewport = { x: -140, y: 82, scale: 2.25 };
    const node = { point: { x: 620, y: 260 } };

    assertPointNear(
      graphNodeHoverAnchor(node, viewport, VIEWPORT_SIZE),
      worldPointToScreenPoint(node.point, viewport, VIEWPORT_SIZE)
    );
  });

  it("keeps node hover anchors tied to expanded world bounds", () => {
    const viewport: RendererViewport = { x: 84, y: -36, scale: 1.7 };
    const viewportSize: RendererViewportSize = { width: 760, height: 520 };
    const worldBounds = { minX: -240, minY: -120, maxX: 1260, maxY: 900, width: 1500, height: 1020 };
    const node = { point: { x: -80, y: 820 } };

    assertPointNear(
      graphNodeHoverAnchor(node, viewport, viewportSize, worldBounds),
      worldPointToScreenPoint(node.point, viewport, viewportSize, worldBounds)
    );
  });

  it("reprojects hover anchors when drawer resize changes the graph viewport", () => {
    const viewport: RendererViewport = { x: -320, y: -180, scale: 2.4 };
    const node = { point: { x: 460, y: 220 } };
    const wideSize: RendererViewportSize = { width: 1000, height: 680 };
    const drawerSize: RendererViewportSize = { width: 640, height: 680 };

    const wideAnchor = graphNodeHoverAnchor(node, viewport, wideSize);
    const drawerAnchor = graphNodeHoverAnchor(node, viewport, drawerSize);

    assert.notDeepEqual(drawerAnchor, wideAnchor);
    assertPointNear(
      drawerAnchor,
      worldPointToScreenPoint(node.point, viewport, drawerSize)
    );
  });

  it("positions edge hover anchors from the projected midpoint of both endpoints", () => {
    const viewport: RendererViewport = { x: 120, y: -64, scale: 1.8 };
    const source = { point: { x: 200, y: 190 } };
    const target = { point: { x: 760, y: 430 } };
    const sourceScreen = worldPointToScreenPoint(source.point, viewport, VIEWPORT_SIZE);
    const targetScreen = worldPointToScreenPoint(target.point, viewport, VIEWPORT_SIZE);

    assertPointNear(
      graphEdgeHoverAnchor({ source, target }, viewport, VIEWPORT_SIZE),
      {
        x: (sourceScreen.x + targetScreen.x) / 2,
        y: (sourceScreen.y + targetScreen.y) / 2
      }
    );
  });

  it("positions edge hover anchors through expanded bounds", () => {
    const viewport: RendererViewport = { x: 40, y: -88, scale: 1.25 };
    const viewportSize: RendererViewportSize = { width: 900, height: 620 };
    const worldBounds = { minX: -400, minY: -200, maxX: 1400, maxY: 1040, width: 1800, height: 1240 };
    const source = { point: { x: -200, y: 920 } };
    const target = { point: { x: 1180, y: -40 } };
    const sourceScreen = worldPointToScreenPoint(source.point, viewport, viewportSize, worldBounds);
    const targetScreen = worldPointToScreenPoint(target.point, viewport, viewportSize, worldBounds);

    assertPointNear(
      graphEdgeHoverAnchor({ source, target }, viewport, viewportSize, worldBounds),
      {
        x: (sourceScreen.x + targetScreen.x) / 2,
        y: (sourceScreen.y + targetScreen.y) / 2
      }
    );
  });

  it("uses the viewport center when an edge endpoint is unavailable", () => {
    assert.deepEqual(
      graphEdgeHoverAnchor({ source: null, target: { point: { x: 760, y: 430 } } }, { x: 0, y: 0, scale: 1 }, VIEWPORT_SIZE),
      { x: 500, y: 340 }
    );
  });

  it("keeps preview cards inside the graph viewport", () => {
    assert.deepEqual(
      resolveGraphHoverPreviewPosition({
        anchorScreenPoint: { x: 990, y: 12 },
        previewSize: { width: 240, height: 150 },
        viewportSize: VIEWPORT_SIZE,
        offset: { x: 18, y: -174 },
        margin: 12
      }),
      { x: 748, y: 12 }
    );
  });
});

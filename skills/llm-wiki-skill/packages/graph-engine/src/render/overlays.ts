import { worldPointToScreenPoint, type GraphScreenPoint, type GraphWorldBounds, type GraphWorldPoint } from "./geometry";
import type { RendererViewport, RendererViewportSize } from "./viewport";

export interface GraphOverlayNodeLike {
  point: GraphWorldPoint;
}

export interface GraphOverlayEdgeLike {
  source?: GraphOverlayNodeLike | null;
  target?: GraphOverlayNodeLike | null;
}

export interface GraphPreviewSize {
  width: number;
  height: number;
}

export interface GraphPreviewPositionInput {
  anchorScreenPoint: GraphScreenPoint;
  previewSize: GraphPreviewSize;
  viewportSize: RendererViewportSize;
  offset: { x: number; y: number };
  margin?: number;
}

export function graphNodeHoverAnchor(
  node: GraphOverlayNodeLike,
  viewport: RendererViewport,
  viewportSize: RendererViewportSize,
  worldBounds?: GraphWorldBounds
): GraphScreenPoint {
  return worldPointToScreenPoint(node.point, viewport, viewportSize, worldBounds);
}

export function graphEdgeHoverAnchor(
  edge: GraphOverlayEdgeLike,
  viewport: RendererViewport,
  viewportSize: RendererViewportSize,
  worldBounds?: GraphWorldBounds
): GraphScreenPoint {
  if (!edge.source || !edge.target) {
    return {
      x: viewportSize.width / 2,
      y: viewportSize.height / 2
    };
  }
  const source = worldPointToScreenPoint(edge.source.point, viewport, viewportSize, worldBounds);
  const target = worldPointToScreenPoint(edge.target.point, viewport, viewportSize, worldBounds);
  return {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2
  };
}

export function resolveGraphHoverPreviewPosition(input: GraphPreviewPositionInput): GraphScreenPoint {
  const margin = finiteNumber(input.margin, 12);
  const preferredLeft = input.anchorScreenPoint.x + finiteNumber(input.offset.x, 0);
  const preferredTop = input.anchorScreenPoint.y + finiteNumber(input.offset.y, 0);
  const maxLeft = Math.max(margin, input.viewportSize.width - finiteNumber(input.previewSize.width, 0) - margin);
  const maxTop = Math.max(margin, input.viewportSize.height - finiteNumber(input.previewSize.height, 0) - margin);
  return {
    x: clamp(preferredLeft, margin, maxLeft),
    y: clamp(preferredTop, margin, maxTop)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

import { clampAtlasViewport } from "../model";
import {
  GRAPH_WORLD_BOUNDS,
  GRAPH_WORLD_SIZE,
  screenPointToWorldPoint,
  visibleWorldRectForViewport,
  visibleWorldRectToMinimapRect,
  worldPointToLayerPoint,
  worldPointToScreenPoint,
  type GraphScreenPoint,
  type GraphWorldBounds,
  type GraphWorldPoint
} from "./geometry";

export interface RendererViewport {
  x: number;
  y: number;
  scale: number;
}

export interface RendererViewportSize {
  width: number;
  height: number;
}

export interface RendererPoint {
  x: number;
  y: number;
}

export interface WheelDeltaLike {
  deltaY: number;
  deltaMode?: number;
}

export interface RendererViewportOptions {
  minScale?: number;
  maxScale?: number;
  worldBounds?: GraphWorldBounds;
}

export interface RafScheduler {
  requestAnimationFrame(callback: () => void): number;
}

export interface ViewportFrameCommitOptions {
  lightweight?: boolean;
}

export const DEFAULT_RENDERER_VIEWPORT: RendererViewport = {
  x: 0,
  y: 0,
  scale: 1
};

const WHEEL_LINE_HEIGHT_PX = 18;
const WHEEL_PAGE_HEIGHT_PX = 720;
const WHEEL_ZOOM_SPEED = 0.0016;
const COMFORTABLE_ANCHOR_MIN_X = 0.18;
const COMFORTABLE_ANCHOR_MAX_X = 0.78;
const COMFORTABLE_ANCHOR_MIN_Y = 0.18;
const COMFORTABLE_ANCHOR_MAX_Y = 0.82;
const DEFAULT_VIEWPORT_OPTIONS: Required<RendererViewportOptions> = {
  minScale: 0.5,
  maxScale: 4,
  worldBounds: GRAPH_WORLD_BOUNDS
};

export interface RendererViewportResizeOptions extends RendererViewportOptions {
  anchorPoint?: RendererPoint | null;
}

export function normalizeRendererViewport(viewport: Partial<RendererViewport> | null | undefined): RendererViewport {
  return {
    x: finiteNumber(viewport?.x, DEFAULT_RENDERER_VIEWPORT.x),
    y: finiteNumber(viewport?.y, DEFAULT_RENDERER_VIEWPORT.y),
    scale: Math.max(0.01, finiteNumber(viewport?.scale, DEFAULT_RENDERER_VIEWPORT.scale))
  };
}

export function rendererViewportToTransform(viewport: Partial<RendererViewport> | null | undefined): string {
  const safe = normalizeRendererViewport(viewport);
  return `translate(${round(safe.x)}px, ${round(safe.y)}px) scale(${round(safe.scale)})`;
}

export function applyRendererViewportTransform(layer: HTMLElement, viewport: Partial<RendererViewport> | null | undefined): void {
  const safe = normalizeRendererViewport(viewport);
  layer.style.transformOrigin = "0 0";
  layer.style.transform = rendererViewportToTransform(safe);
  layer.dataset.viewportX = String(round(safe.x));
  layer.dataset.viewportY = String(round(safe.y));
  layer.dataset.viewportScale = String(round(safe.scale));
}

export function normalizeWheelDelta(delta: WheelDeltaLike): number {
  const value = finiteNumber(delta.deltaY, 0);
  if (delta.deltaMode === 1) return value * WHEEL_LINE_HEIGHT_PX;
  if (delta.deltaMode === 2) return value * WHEEL_PAGE_HEIGHT_PX;
  return value;
}

export function viewportAfterWheelZoom(
  viewport: Partial<RendererViewport> | null | undefined,
  delta: WheelDeltaLike,
  screenPoint: RendererPoint,
  viewportSize: RendererViewportSize,
  options: RendererViewportOptions = {}
): RendererViewport {
  const normalizedDelta = normalizeWheelDelta(delta);
  const zoomFactor = clamp(Math.exp(-normalizedDelta * WHEEL_ZOOM_SPEED), 0.2, 5);
  const safe = normalizeRendererViewport(viewport);
  const size = normalizeViewportSize(viewportSize);
  const point = clampScreenPointToViewport(screenPoint, size);
  const opts = viewportOptions(options);
  const nextScale = clamp(safe.scale * zoomFactor, opts.minScale, opts.maxScale);
  const anchorWorld = screenPointToWorldPoint(point, safe, size, opts.worldBounds);
  const anchorLayer = worldPointToLayerPoint(anchorWorld, size, opts.worldBounds);

  return clampAtlasViewport({
    x: point.x - nextScale * anchorLayer.x,
    y: point.y - nextScale * anchorLayer.y,
    scale: nextScale
  }, size, opts) as RendererViewport;
}

export function panRendererViewport(
  viewport: Partial<RendererViewport> | null | undefined,
  delta: RendererPoint,
  viewportSize: RendererViewportSize,
  options: RendererViewportOptions = {}
): RendererViewport {
  const safe = normalizeRendererViewport(viewport);
  return clampAtlasViewport(
    {
      x: safe.x + finiteNumber(delta.x, 0),
      y: safe.y + finiteNumber(delta.y, 0),
      scale: safe.scale
    },
    viewportSize,
    viewportOptions(options)
  ) as RendererViewport;
}

export function fitRendererViewportToPoints(
  points: RendererPoint[],
  viewportSize: RendererViewportSize,
  options: RendererViewportOptions = {}
): RendererViewport {
  const bounds = boundsForPoints(points);
  const size = normalizeViewportSize(viewportSize);
  const opts = viewportOptions(options);
  const scale = clamp(
    Math.min(
      opts.worldBounds.width * 0.82 / Math.max(1, bounds.width || 1),
      opts.worldBounds.height * 0.82 / Math.max(1, bounds.height || 1)
    ),
    opts.minScale,
    opts.maxScale
  );
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
  const centerLayer = worldPointToLayerPoint(center, size, opts.worldBounds);

  return clampAtlasViewport({
    x: size.width / 2 - scale * centerLayer.x,
    y: size.height / 2 - scale * centerLayer.y,
    scale
  }, size, opts) as RendererViewport;
}

export function centerRendererViewportOnPoint(
  point: RendererPoint,
  viewport: Partial<RendererViewport> | null | undefined,
  viewportSize: RendererViewportSize,
  options: RendererViewportOptions = {}
): RendererViewport {
  const safe = normalizeRendererViewport(viewport);
  const size = normalizeViewportSize(viewportSize);
  const opts = viewportOptions(options);
  const scale = clamp(safe.scale, opts.minScale, opts.maxScale);
  const layerPoint = worldPointToLayerPoint(point, size, opts.worldBounds);

  return clampAtlasViewport({
    x: size.width / 2 - scale * layerPoint.x,
    y: size.height / 2 - scale * layerPoint.y,
    scale
  }, size, opts) as RendererViewport;
}

export function viewportAfterResize(
  viewport: Partial<RendererViewport> | null | undefined,
  previousSize: RendererViewportSize,
  nextSize: RendererViewportSize,
  options: RendererViewportResizeOptions = {}
): RendererViewport {
  const safe = normalizeRendererViewport(viewport);
  const previous = normalizeViewportSize(previousSize);
  const next = normalizeViewportSize(nextSize);
  const opts = viewportOptions(options);
  const anchorPoint = options.anchorPoint || viewportCenterPoint(safe, previous, opts.worldBounds);
  const previousScreen = worldPointToScreenPoint(anchorPoint, safe, previous, opts.worldBounds);
  const desiredXRatio = clamp(previousScreen.x / previous.width, COMFORTABLE_ANCHOR_MIN_X, COMFORTABLE_ANCHOR_MAX_X);
  const desiredYRatio = clamp(previousScreen.y / previous.height, COMFORTABLE_ANCHOR_MIN_Y, COMFORTABLE_ANCHOR_MAX_Y);
  const nextAnchorLayer = worldPointToLayerPoint(anchorPoint, next, opts.worldBounds);

  return clampAtlasViewport({
    x: next.width * desiredXRatio - safe.scale * nextAnchorLayer.x,
    y: next.height * desiredYRatio - safe.scale * nextAnchorLayer.y,
    scale: safe.scale
  }, next, opts) as RendererViewport;
}

export function rendererViewportToMinimapRect(
  viewport: Partial<RendererViewport> | null | undefined,
  viewportSize: RendererViewportSize,
  options: RendererViewportOptions = {}
): { x: number; y: number; width: number; height: number } {
  const opts = viewportOptions(options);
  const worldRect = visibleWorldRectForViewport(normalizeRendererViewport(viewport), normalizeViewportSize(viewportSize), opts.worldBounds);
  const minimapRect = visibleWorldRectToMinimapRect(worldRect, undefined, opts.worldBounds);
  return {
    x: minimapRect.x,
    y: minimapRect.y,
    width: Math.max(2, minimapRect.width),
    height: Math.max(2, minimapRect.height)
  };
}

export function createViewportFrameCommitter(
  commit: (viewport: RendererViewport, options?: ViewportFrameCommitOptions) => void,
  scheduler: RafScheduler = defaultScheduler()
): { schedule(viewport: Partial<RendererViewport>, options?: ViewportFrameCommitOptions): void } {
  let queued = false;
  let pending: RendererViewport | null = null;
  let pendingOptions: ViewportFrameCommitOptions | null = null;
  return {
    schedule(viewport, options = {}): void {
      pending = normalizeRendererViewport(viewport);
      pendingOptions = {
        lightweight: pendingOptions === null
          ? Boolean(options.lightweight)
          : Boolean(pendingOptions.lightweight && options.lightweight)
      };
      if (queued) return;
      queued = true;
      scheduler.requestAnimationFrame(() => {
        queued = false;
        const next = pending;
        const nextOptions = pendingOptions || {};
        pending = null;
        pendingOptions = null;
        if (next) commit(next, nextOptions);
      });
    }
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeViewportSize(size: RendererViewportSize): RendererViewportSize {
  return {
    width: Math.max(1, finiteNumber(size.width, GRAPH_WORLD_SIZE.width)),
    height: Math.max(1, finiteNumber(size.height, GRAPH_WORLD_SIZE.height))
  };
}

function viewportCenterPoint(viewport: RendererViewport, size: RendererViewportSize, worldBounds: GraphWorldBounds): GraphWorldPoint {
  const center = screenPointToWorldPoint({ x: size.width / 2, y: size.height / 2 }, viewport, size, worldBounds);
  return {
    x: clamp(center.x, worldBounds.minX, worldBounds.maxX),
    y: clamp(center.y, worldBounds.minY, worldBounds.maxY)
  };
}

function clampScreenPointToViewport(point: RendererPoint, size: RendererViewportSize): GraphScreenPoint {
  return {
    x: clamp(finiteNumber(point.x, size.width / 2), 0, size.width),
    y: clamp(finiteNumber(point.y, size.height / 2), 0, size.height)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function viewportOptions(options: RendererViewportOptions): Required<RendererViewportOptions> {
  return {
    minScale: finiteNumber(options.minScale, DEFAULT_VIEWPORT_OPTIONS.minScale),
    maxScale: finiteNumber(options.maxScale, DEFAULT_VIEWPORT_OPTIONS.maxScale),
    worldBounds: options.worldBounds || DEFAULT_VIEWPORT_OPTIONS.worldBounds
  };
}

function boundsForPoints(points: RendererPoint[]): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } {
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: GRAPH_WORLD_SIZE.width, maxY: GRAPH_WORLD_SIZE.height, width: GRAPH_WORLD_SIZE.width, height: GRAPH_WORLD_SIZE.height };
  }
  let minX: number = GRAPH_WORLD_SIZE.width;
  let minY: number = GRAPH_WORLD_SIZE.height;
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    const x = finiteNumber(point.x, 0);
    const y = finiteNumber(point.y, 0);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function defaultScheduler(): RafScheduler {
  const runtime = globalThis as unknown as { requestAnimationFrame?: (callback: () => void) => number };
  return {
    requestAnimationFrame(callback): number {
      if (typeof runtime.requestAnimationFrame === "function") return runtime.requestAnimationFrame(callback);
      return setTimeout(callback, 16) as unknown as number;
    }
  };
}

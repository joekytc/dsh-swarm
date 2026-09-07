import { quadtree } from "d3-quadtree";
import { cardDims } from "../model/labels";
import type { Quadtree, QuadtreeLeaf, QuadtreeNode } from "d3-quadtree";
import { graphEdgeControlPoint } from "./edge-geometry";

export type GraphSpatialHitKind = "node" | "edge" | "community-wash" | "aggregation-container" | "graph-blank";

export interface GraphSpatialPoint {
  x: number;
  y: number;
}

export interface GraphSpatialRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphSpatialNodeLike {
  id: string;
  label?: string;
  type?: string;
  displayMode?: string;
  visualRole?: string;
  point?: GraphSpatialPoint;
  x?: number;
  y?: number;
  hitBounds?: GraphSpatialRect;
}

export interface GraphSpatialEdgeLike {
  id: string;
  source: string;
  target: string;
  curveOffset?: number;
}

export interface GraphSpatialCommunityLike {
  id: string;
  wash?: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  } | null;
}

export interface GraphSpatialAggregationContainerLike {
  id: string;
  communityId?: string | null;
  point?: GraphSpatialPoint;
  radius?: number;
}

export type GraphSpatialHitTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "community-wash"; id: string }
  | { kind: "aggregation-container"; id: string; communityId: string | null }
  | { kind: "graph-blank" };

export interface GraphSpatialIndexInput {
  nodes?: readonly GraphSpatialNodeLike[];
  edges?: readonly GraphSpatialEdgeLike[];
  communities?: readonly GraphSpatialCommunityLike[];
  aggregationContainers?: readonly GraphSpatialAggregationContainerLike[];
  edgeHitTolerance?: number;
  nodeFallbackRadius?: number;
}

interface SpatialNodeEntry {
  id: string;
  point: GraphSpatialPoint;
  bounds: GraphSpatialRect;
  radius: number;
  order: number;
}

interface SpatialEdgeEntry {
  id: string;
  source: GraphSpatialPoint;
  target: GraphSpatialPoint;
  curveOffset: number;
  bounds: GraphSpatialRect;
  order: number;
}

interface SpatialCommunityEntry {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  order: number;
}

interface SpatialAggregationContainerEntry {
  id: string;
  communityId: string | null;
  point: GraphSpatialPoint;
  radius: number;
  order: number;
}

export const DEFAULT_GRAPH_EDGE_HIT_TOLERANCE = 10;
export const DEFAULT_GRAPH_NODE_FALLBACK_RADIUS = 32;

export class GraphSpatialIndex {
  private readonly nodes: SpatialNodeEntry[];
  private readonly edges: SpatialEdgeEntry[];
  private readonly communities: SpatialCommunityEntry[];
  private readonly aggregationContainers: SpatialAggregationContainerEntry[];
  private readonly nodeTree: Quadtree<SpatialNodeEntry>;
  private readonly edgeGrid: SpatialEdgeGrid;
  private readonly maxNodeRadius: number;
  private readonly edgeHitTolerance: number;
  private readonly nodeFallbackRadius: number;

  constructor(input: GraphSpatialIndexInput = {}) {
    this.edgeHitTolerance = finitePositiveNumber(input.edgeHitTolerance, DEFAULT_GRAPH_EDGE_HIT_TOLERANCE);
    this.nodeFallbackRadius = finitePositiveNumber(input.nodeFallbackRadius, DEFAULT_GRAPH_NODE_FALLBACK_RADIUS);
    this.nodes = normalizeNodes(input.nodes || [], this.nodeFallbackRadius);
    this.maxNodeRadius = this.nodes.reduce((max, node) => Math.max(max, node.radius), this.nodeFallbackRadius);
    this.nodeTree = quadtree<SpatialNodeEntry>(
      this.nodes,
      (node) => node.point.x,
      (node) => node.point.y
    );

    const nodeById = new Map(this.nodes.map((node) => [node.id, node]));
    this.edges = normalizeEdges(input.edges || [], nodeById, this.edgeHitTolerance);
    this.edgeGrid = new SpatialEdgeGrid(this.edges, this.edgeHitTolerance);
    this.communities = normalizeCommunities(input.communities || []);
    this.aggregationContainers = normalizeAggregationContainers(input.aggregationContainers || []);
  }

  rebuild(input: GraphSpatialIndexInput): GraphSpatialIndex {
    return new GraphSpatialIndex(input);
  }

  hitTest(point: GraphSpatialPoint): GraphSpatialHitTarget {
    const safePoint = normalizePoint(point);
    const node = this.findNode(safePoint);
    if (node) return { kind: "node", id: node.id };

    const edge = this.findEdge(safePoint);
    if (edge) return { kind: "edge", id: edge.id };

    const aggregationContainer = this.findAggregationContainer(safePoint);
    if (aggregationContainer) return {
      kind: "aggregation-container",
      id: aggregationContainer.id,
      communityId: aggregationContainer.communityId
    };

    const community = this.findCommunity(safePoint);
    if (community) return { kind: "community-wash", id: community.id };

    return { kind: "graph-blank" };
  }

  findNode(point: GraphSpatialPoint): SpatialNodeEntry | null {
    const safePoint = normalizePoint(point);
    const candidates = this.collectNodeCandidates(safePoint);
    if (!candidates.length) return null;
    return candidates
      .sort((left, right) => {
        const distanceDelta = pointToRectDistance(safePoint, left.bounds) - pointToRectDistance(safePoint, right.bounds);
        if (distanceDelta !== 0) return distanceDelta;
        return left.order - right.order;
      })[0] || null;
  }

  findEdge(point: GraphSpatialPoint): SpatialEdgeEntry | null {
    const safePoint = normalizePoint(point);
    let bestEdge: SpatialEdgeEntry | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.visitEdgeCandidates(safePoint, (edge) => {
      const distance = distanceToCurvedEdge(safePoint, edge.source, edge.target, edge.curveOffset);
      if (distance > this.edgeHitTolerance) return;
      if (!bestEdge || distance < bestDistance || (distance === bestDistance && edge.order < bestEdge.order)) {
        bestEdge = edge;
        bestDistance = distance;
      }
    });
    return bestEdge;
  }

  findCommunity(point: GraphSpatialPoint): SpatialCommunityEntry | null {
    const safePoint = normalizePoint(point);
    const candidates = this.communities
      .map((community) => ({
        community,
        score: ellipseContainmentScore(safePoint, community)
      }))
      .filter((candidate) => candidate.score <= 1)
      .sort((left, right) => left.score - right.score || left.community.order - right.community.order);
    return candidates[0]?.community || null;
  }

  findAggregationContainer(point: GraphSpatialPoint): SpatialAggregationContainerEntry | null {
    const safePoint = normalizePoint(point);
    const candidates = this.aggregationContainers
      .filter((container) => distanceBetweenPoints(safePoint, container.point) <= container.radius)
      .sort((left, right) => distanceBetweenPoints(safePoint, left.point) - distanceBetweenPoints(safePoint, right.point) || left.order - right.order);
    return candidates[0] || null;
  }

  nearestNode(point: GraphSpatialPoint, radius = this.maxNodeRadius): SpatialNodeEntry | null {
    return this.nodeTree.find(finiteNumber(point.x, 0), finiteNumber(point.y, 0), finitePositiveNumber(radius, this.maxNodeRadius)) || null;
  }

  edgeCandidateCount(point: GraphSpatialPoint): number {
    const safePoint = normalizePoint(point);
    let count = 0;
    this.visitEdgeCandidates(safePoint, () => {
      count += 1;
    });
    return count;
  }

  private collectNodeCandidates(point: GraphSpatialPoint): SpatialNodeEntry[] {
    const candidates: SpatialNodeEntry[] = [];
    const radius = this.maxNodeRadius;
    this.nodeTree.visit((quad, x0, y0, x1, y1) => {
      if (x0 > point.x + radius || x1 < point.x - radius || y0 > point.y + radius || y1 < point.y - radius) {
        return true;
      }
      const leaf = asQuadtreeLeaf(quad);
      if (!leaf) return false;
      let current: QuadtreeLeaf<SpatialNodeEntry> | undefined = leaf;
      while (current) {
        if (rectContainsPoint(current.data.bounds, point)) candidates.push(current.data);
        current = current.next;
      }
      return false;
    });
    return candidates;
  }

  private visitEdgeCandidates(point: GraphSpatialPoint, visitor: (edge: SpatialEdgeEntry) => void): void {
    this.edgeGrid.visit(point, visitor);
  }
}

export function createGraphSpatialIndex(input: GraphSpatialIndexInput = {}): GraphSpatialIndex {
  return new GraphSpatialIndex(input);
}

function normalizeNodes(nodes: readonly GraphSpatialNodeLike[], fallbackRadius: number): SpatialNodeEntry[] {
  return nodes.flatMap((node, index) => {
    const point = pointForNode(node);
    if (!point) return [];
    const bounds = node.hitBounds ? normalizeRect(node.hitBounds, point, fallbackRadius) : nodeBounds(node, point, fallbackRadius);
    return [{
      id: String(node.id),
      point,
      bounds,
      radius: rectRadius(bounds, point),
      order: index
    }];
  });
}

function normalizeEdges(edges: readonly GraphSpatialEdgeLike[], nodeById: Map<string, SpatialNodeEntry>, edgeHitTolerance: number): SpatialEdgeEntry[] {
  return edges.flatMap((edge, index) => {
    const source = nodeById.get(String(edge.source));
    const target = nodeById.get(String(edge.target));
    if (!source || !target) return [];
    const sourcePoint = clonePoint(source.point);
    const targetPoint = clonePoint(target.point);
    const curveOffset = finiteNumber(edge.curveOffset, 0);
    const bounds = edgeSearchBounds(sourcePoint, targetPoint, curveOffset, edgeHitTolerance);
    return [{
      id: String(edge.id),
      source: sourcePoint,
      target: targetPoint,
      curveOffset,
      bounds,
      order: index
    }];
  });
}

function normalizeCommunities(communities: readonly GraphSpatialCommunityLike[]): SpatialCommunityEntry[] {
  return communities.flatMap((community, index) => {
    const wash = community.wash;
    if (!wash) return [];
    const rx = finitePositiveNumber(wash.rx, 0);
    const ry = finitePositiveNumber(wash.ry, 0);
    if (rx <= 0 || ry <= 0) return [];
    return [{
      id: String(community.id),
      cx: finiteNumber(wash.cx, 0),
      cy: finiteNumber(wash.cy, 0),
      rx,
      ry,
      order: index
    }];
  });
}

function normalizeAggregationContainers(containers: readonly GraphSpatialAggregationContainerLike[]): SpatialAggregationContainerEntry[] {
  return containers.flatMap((container, index) => {
    if (!container.point) return [];
    return [{
      id: String(container.id),
      communityId: container.communityId ? String(container.communityId) : null,
      point: normalizePoint(container.point),
      radius: finitePositiveNumber(container.radius, DEFAULT_GRAPH_NODE_FALLBACK_RADIUS),
      order: index
    }];
  });
}

function pointForNode(node: GraphSpatialNodeLike): GraphSpatialPoint | null {
  if (node.point) return normalizePoint(node.point);
  if (typeof node.x === "number" && typeof node.y === "number") return normalizePoint({ x: node.x, y: node.y });
  return null;
}

function nodeBounds(node: GraphSpatialNodeLike, point: GraphSpatialPoint, fallbackRadius: number): GraphSpatialRect {
  if (node.displayMode === "point" || node.displayMode === "overview" || node.visualRole === "map-pin") {
    return centeredRect(point, 28, 28);
  }
  if (node.displayMode === "compact-card" || node.visualRole === "landmark") {
    return centeredRect(point, 130, 42);
  }
  if (node.label || node.type || node.id) {
    const dims = cardDims({ id: node.id, label: node.label || node.id, type: node.type || "entity" });
    return centeredRect(point, Math.max(72, Math.min(182, dims.w)), Math.max(46, dims.h));
  }
  return centeredRect(point, fallbackRadius * 2, fallbackRadius * 2);
}

function normalizeRect(rect: GraphSpatialRect, fallbackCenter: GraphSpatialPoint, fallbackRadius: number): GraphSpatialRect {
  const width = finitePositiveNumber(rect.width, fallbackRadius * 2);
  const height = finitePositiveNumber(rect.height, fallbackRadius * 2);
  return {
    x: finiteNumber(rect.x, fallbackCenter.x - width / 2),
    y: finiteNumber(rect.y, fallbackCenter.y - height / 2),
    width,
    height
  };
}

function centeredRect(point: GraphSpatialPoint, width: number, height: number): GraphSpatialRect {
  return {
    x: point.x - width / 2,
    y: point.y - height / 2,
    width,
    height
  };
}

function rectContainsPoint(rect: GraphSpatialRect, point: GraphSpatialPoint): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function pointToRectDistance(point: GraphSpatialPoint, rect: GraphSpatialRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function rectRadius(rect: GraphSpatialRect, point: GraphSpatialPoint): number {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height }
  ];
  return Math.max(...corners.map((corner) => distance(point, corner)));
}

function distanceToCurvedEdge(point: GraphSpatialPoint, source: GraphSpatialPoint, target: GraphSpatialPoint, curveOffset: number): number {
  const control = graphEdgeControlPoint(source, target, curveOffset);
  let previous = source;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let step = 1; step <= 24; step += 1) {
    const t = step / 24;
    const current = quadraticBezierPoint(source, control, target, t);
    minDistance = Math.min(minDistance, distanceToSegment(point, previous, current));
    previous = current;
  }
  return minDistance;
}

function edgeSearchBounds(source: GraphSpatialPoint, target: GraphSpatialPoint, curveOffset: number, edgeHitTolerance: number): GraphSpatialRect {
  const control = graphEdgeControlPoint(source, target, curveOffset);
  const padding = edgeHitTolerance + Math.abs(curveOffset) + 24;
  const minX = Math.min(source.x, target.x, control.x) - padding;
  const maxX = Math.max(source.x, target.x, control.x) + padding;
  const minY = Math.min(source.y, target.y, control.y) - padding;
  const maxY = Math.max(source.y, target.y, control.y) + padding;
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function quadraticBezierPoint(start: GraphSpatialPoint, control: GraphSpatialPoint, end: GraphSpatialPoint, t: number): GraphSpatialPoint {
  const inv = 1 - t;
  return {
    x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y
  };
}

function distanceToSegment(point: GraphSpatialPoint, start: GraphSpatialPoint, end: GraphSpatialPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy
  });
}

function ellipseContainmentScore(point: GraphSpatialPoint, community: SpatialCommunityEntry): number {
  const dx = (point.x - community.cx) / community.rx;
  const dy = (point.y - community.cy) / community.ry;
  return dx * dx + dy * dy;
}

function asQuadtreeLeaf<T>(node: QuadtreeNode<T>): QuadtreeLeaf<T> | null {
  return Array.isArray(node) ? null : node;
}

function clonePoint(point: GraphSpatialPoint): GraphSpatialPoint {
  return { x: point.x, y: point.y };
}

function normalizePoint(point: GraphSpatialPoint): GraphSpatialPoint {
  return {
    x: finiteNumber(point.x, 0),
    y: finiteNumber(point.y, 0)
  };
}

function finitePositiveNumber(value: unknown, fallback: number): number {
  const numeric = finiteNumber(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function distance(left: GraphSpatialPoint, right: GraphSpatialPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function distanceBetweenPoints(left: GraphSpatialPoint, right: GraphSpatialPoint): number {
  return distance(left, right);
}

const DEFAULT_EDGE_GRID_CELL_SIZE = 96;

class SpatialEdgeGrid {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, SpatialEdgeEntry[]>();

  constructor(edges: readonly SpatialEdgeEntry[], edgeHitTolerance: number) {
    this.cellSize = Math.max(DEFAULT_EDGE_GRID_CELL_SIZE, finitePositiveNumber(edgeHitTolerance, DEFAULT_GRAPH_EDGE_HIT_TOLERANCE) * 8);
    for (const edge of edges) {
      this.add(edge);
    }
  }

  visit(point: GraphSpatialPoint, visitor: (edge: SpatialEdgeEntry) => void): void {
    const bucket = this.buckets.get(this.key(this.cellCoord(point.x), this.cellCoord(point.y)));
    if (!bucket?.length) return;
    const seen = new Set<string>();
    for (const edge of bucket) {
      if (seen.has(edge.id)) continue;
      seen.add(edge.id);
      if (rectContainsPoint(edge.bounds, point)) visitor(edge);
    }
  }

  private add(edge: SpatialEdgeEntry): void {
    const minCellX = this.cellCoord(edge.bounds.x);
    const maxCellX = this.cellCoord(edge.bounds.x + edge.bounds.width);
    const minCellY = this.cellCoord(edge.bounds.y);
    const maxCellY = this.cellCoord(edge.bounds.y + edge.bounds.height);
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const key = this.key(cellX, cellY);
        const bucket = this.buckets.get(key);
        if (bucket) bucket.push(edge);
        else this.buckets.set(key, [edge]);
      }
    }
  }

  private cellCoord(value: number): number {
    return Math.floor(finiteNumber(value, 0) / this.cellSize);
  }

  private key(x: number, y: number): string {
    return `${x}:${y}`;
  }
}

import {
  buildGraphRendererAdapterData,
  buildGraphRendererBehaviorContract,
  type GraphRendererBehaviorContract
} from "../src/render";
import type {
  GraphAggregationMarker,
  GraphData,
  GraphFocusInput,
  GraphTypeFilters,
  NodeId,
  PinMap,
  SelectionInput
} from "../src/types";

export interface AggregationFallbackTrialOptions {
  pins?: PinMap;
  selection?: SelectionInput | null;
  searchResultIds?: NodeId[];
  aggregationMarkers?: GraphAggregationMarker[];
  focus?: GraphFocusInput;
  typeFilters?: GraphTypeFilters;
}

export interface AggregationFallbackTrialModel {
  nodes: AggregationFallbackTrialNode[];
  edges: AggregationFallbackTrialEdge[];
  communities: AggregationFallbackTrialCommunity[];
  containers: AggregationFallbackTrialContainer[];
  budget: {
    visibleNodes: number;
    visibleEdges: number;
    visibleLabels: number;
    visibleCards: number;
    overflowNodes: number;
    overflowEdges: number;
    overflowLabels: number;
    overflowCards: number;
    maxInteractionUpdates: number;
    interactionUpdatedObjects: number;
    interactionHiddenObjects: number;
    preservedNodeIds: string[];
  };
  behavior: GraphRendererBehaviorContract;
}

export interface AggregationFallbackTrialNode {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
  radius: number;
  communityId: string | null;
  selected: boolean;
  searchHit: boolean;
  pinned: boolean;
  labelVisible: boolean;
  cardVisible: boolean;
  aggregationIds: string[];
}

export interface AggregationFallbackTrialEdge {
  id: string;
  source: string;
  target: string;
  strokeWidth: number;
  opacity: number;
  skeleton: boolean;
}

export interface AggregationFallbackTrialCommunity {
  id: string;
  label: string;
  nodeIds: string[];
  selected: boolean;
  searchResultIds: string[];
  pinnedNodeIds: string[];
}

export interface AggregationFallbackTrialContainer {
  id: string;
  label: string;
  communityId: string | null;
  x: number;
  y: number;
  radius: number;
  color: string;
  nodeIds: string[];
  selectedNodeIds: string[];
  searchResultIds: string[];
  pinnedNodeIds: string[];
  totalCount: number;
}

const COMMUNITY_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#4f46e5",
  "#65a30d"
];

export function buildAggregationFallbackTrialModel(
  data: GraphData,
  options: AggregationFallbackTrialOptions = {}
): AggregationFallbackTrialModel {
  const adapter = buildGraphRendererAdapterData(data, {
    ...options,
    focus: options.focus ?? { kind: "global" }
  });
  const renderable = adapter.renderable;
  const searchSet = new Set(options.searchResultIds ?? []);
  const nodeById = new Map(adapter.nodes.map((node) => [node.id, node]));

  const nodes = renderable.nodes.map((node): AggregationFallbackTrialNode => {
    const adapterNode = nodeById.get(node.id);
    return {
      id: node.id,
      label: node.label,
      x: node.point.x,
      y: node.point.y,
      color: colorForCommunity(adapterNode?.communityId ?? node.community),
      radius: node.displayMode === "card" ? 7 : node.labelVisible ? 5 : 3,
      communityId: adapterNode?.communityId ?? node.community ?? null,
      selected: adapterNode?.selected ?? node.selected,
      searchHit: adapterNode?.searchHit ?? searchSet.has(node.id),
      pinned: adapterNode?.pinHint.pinned ?? false,
      labelVisible: node.labelVisible,
      cardVisible: node.displayMode === "card" || node.displayMode === "compact-card",
      aggregationIds: adapterNode?.aggregationIds ?? []
    };
  });

  const edges = renderable.edges.map((edge): AggregationFallbackTrialEdge => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    strokeWidth: edge.strokeWidth,
    opacity: edge.opacity,
    skeleton: edge.skeleton
  }));

  const communities = adapter.communities.map((community): AggregationFallbackTrialCommunity => ({
    id: community.id,
    label: community.label,
    nodeIds: community.nodeIds,
    selected: community.selected,
    searchResultIds: community.searchResultIds,
    pinnedNodeIds: community.pinHints.map((hint) => hint.nodeId)
  }));

  const containers = adapter.aggregations.map((aggregation): AggregationFallbackTrialContainer => {
    const points = aggregation.nodeIds
      .map((id) => nodeById.get(id)?.point)
      .filter((point): point is { x: number; y: number } => Boolean(point));
    const point = averagePoint(points);
    return {
      id: aggregation.id,
      label: aggregation.label,
      communityId: aggregation.communityId,
      x: point.x,
      y: point.y,
      radius: aggregationRadius(aggregation.totalCount),
      color: colorForCommunity(aggregation.communityId),
      nodeIds: aggregation.nodeIds,
      selectedNodeIds: aggregation.selectedNodeIds,
      searchResultIds: aggregation.searchResultIds,
      pinnedNodeIds: aggregation.pinnedNodeIds,
      totalCount: aggregation.totalCount
    };
  });

  return {
    nodes,
    edges,
    communities,
    containers,
    budget: {
      visibleNodes: renderable.budget.usage.maxVisibleNodes,
      visibleEdges: renderable.budget.usage.maxVisibleEdges,
      visibleLabels: renderable.budget.usage.maxLabels,
      visibleCards: renderable.budget.usage.maxCards,
      overflowNodes: renderable.overflow.nodes.hidden,
      overflowEdges: renderable.overflow.edges.hidden,
      overflowLabels: renderable.overflow.labels.hidden,
      overflowCards: renderable.overflow.cards.hidden,
      maxInteractionUpdates: renderable.interaction.maxUpdatedObjects,
      interactionUpdatedObjects: renderable.interaction.updatedObjects,
      interactionHiddenObjects: renderable.interaction.hiddenObjects,
      preservedNodeIds: renderable.interaction.preservedNodeIds
    },
    behavior: buildGraphRendererBehaviorContract(adapter, "aggregation-fallback")
  };
}

function colorForCommunity(communityId: string | null): string {
  if (!communityId) return "#64748b";
  const index = Math.abs(hashString(communityId)) % COMMUNITY_COLORS.length;
  return COMMUNITY_COLORS[index];
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return hash;
}

function averagePoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (!points.length) return { x: 0, y: 0 };
  const sum = points.reduce((memo, point) => ({ x: memo.x + point.x, y: memo.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function aggregationRadius(count: number): number {
  return Math.max(10, Math.min(42, 8 + Math.sqrt(Math.max(1, count)) * 1.4));
}

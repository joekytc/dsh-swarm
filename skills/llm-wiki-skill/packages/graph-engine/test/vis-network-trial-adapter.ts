import {
  buildGraphRendererAdapterData,
  buildGraphRendererBehaviorContract,
  type GraphRendererBehaviorContract
} from "../src/render";
import type {
  GraphAggregationMarker,
  GraphData,
  GraphFocusInput,
  GraphPinHint,
  GraphTypeFilters,
  NodeId,
  PinMap,
  SelectionInput
} from "../src/types";

export interface VisNetworkTrialOptions {
  pins?: PinMap;
  selection?: SelectionInput | null;
  searchResultIds?: NodeId[];
  aggregationMarkers?: GraphAggregationMarker[];
  focus?: GraphFocusInput;
  typeFilters?: GraphTypeFilters;
}

export interface VisNetworkTrialModel {
  nodes: VisNetworkTrialNode[];
  edges: VisNetworkTrialEdge[];
  communities: VisNetworkTrialCommunity[];
  aggregations: VisNetworkTrialAggregation[];
  behavior: GraphRendererBehaviorContract;
}

export interface VisNetworkTrialNode {
  id: string;
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  communityId: string | null;
  sourcePath: string;
  selected: boolean;
  searchHit: boolean;
  pinned: boolean;
  pinHint: GraphPinHint;
  aggregationIds: string[];
}

export interface VisNetworkTrialEdge {
  id: string;
  from: string;
  to: string;
  color: string;
  width: number;
  relationType: string | null;
}

export interface VisNetworkTrialCommunity {
  id: string;
  label: string;
  nodeIds: string[];
  selected: boolean;
  searchResultIds: string[];
  pinnedNodeIds: string[];
}

export interface VisNetworkTrialAggregation {
  id: string;
  communityId: string | null;
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

export function buildVisNetworkTrialModel(data: GraphData, options: VisNetworkTrialOptions = {}): VisNetworkTrialModel {
  const adapter = buildGraphRendererAdapterData(data, options);
  const adapterNodeById = new Map(adapter.nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(data.nodes.map((node) => node.id));
  const communityNodeIds = new Map<string, string[]>();
  for (const node of data.nodes) {
    const communityId = String(node.community ?? "_none");
    const list = communityNodeIds.get(communityId) ?? [];
    list.push(node.id);
    communityNodeIds.set(communityId, list);
  }

  const nodes = data.nodes.map((node, index): VisNetworkTrialNode => {
    const adapterNode = adapterNodeById.get(node.id);
    const communityId = node.community == null ? null : String(node.community);
    const pinHint = adapterNode?.pinHint ?? {
      nodeId: node.id,
      wikiPath: node.source_path ?? node.id,
      pinned: false,
      position: null
    };
    return {
      id: node.id,
      label: node.label,
      x: finiteNumber(adapterNode?.point.x, finiteNumber(node.x, index % 100)),
      y: finiteNumber(adapterNode?.point.y, finiteNumber(node.y, Math.floor(index / 100))),
      size: pinHint.pinned ? 8 : adapterNode?.selected ? 8 : adapterNode?.searchHit ? 7 : 4,
      color: adapterNode?.selected
        ? "#ef4444"
        : adapterNode?.searchHit
          ? "#f59e0b"
          : colorForCommunity(communityId),
      communityId,
      sourcePath: adapterNode?.sourcePath ?? node.source_path ?? node.id,
      selected: adapterNode?.selected ?? false,
      searchHit: adapterNode?.searchHit ?? false,
      pinned: pinHint.pinned,
      pinHint,
      aggregationIds: adapterNode?.aggregationIds ?? []
    };
  });

  const edges = data.edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .map((edge): VisNetworkTrialEdge => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      color: "#94a3b8",
      width: Math.max(0.25, Math.min(1.5, Number(edge.weight ?? 0.6))),
      relationType: edge.relation_type ?? edge.type ?? null
    }));

  const communities = adapter.communities.map((community): VisNetworkTrialCommunity => ({
    id: community.id,
    label: community.label,
    nodeIds: communityNodeIds.get(community.id) ?? community.nodeIds,
    selected: community.selected,
    searchResultIds: community.searchResultIds,
    pinnedNodeIds: community.pinHints.map((hint) => hint.nodeId)
  }));

  const aggregations = adapter.aggregations.map((aggregation): VisNetworkTrialAggregation => ({
    id: aggregation.id,
    communityId: aggregation.communityId,
    nodeIds: aggregation.nodeIds,
    selectedNodeIds: aggregation.selectedNodeIds,
    searchResultIds: aggregation.searchResultIds,
    pinnedNodeIds: aggregation.pinnedNodeIds,
    totalCount: aggregation.totalCount
  }));

  return {
    nodes,
    edges,
    communities,
    aggregations,
    behavior: buildGraphRendererBehaviorContract(adapter, "candidate-global")
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

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

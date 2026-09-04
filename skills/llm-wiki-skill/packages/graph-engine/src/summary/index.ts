import { wikiPathForGraphNode } from "../graph-node";
import { resolveSelectionForCapabilities } from "../select";
import type {
  CommunityId,
  EdgeId,
  GraphAggregationMarker,
  GraphCommunitySummaryPayload,
  GraphData,
  GraphEdge,
  GraphExcludedObjectPayload,
  GraphGlobalOverviewPayload,
  GraphNode,
  GraphNodeSummaryPayload,
  GraphPinHint,
  GraphRelationSummary,
  GraphSearchResultsPayload,
  GraphSummaryCommand,
  GraphSummaryObjectRef,
  GraphSummaryOptions,
  GraphSummarySelectionState,
  GraphUnavailableObjectPayload,
  NodeId,
  PinMap,
  SelectionInput,
  WikiPath
} from "../types";

const DEFAULT_LIMIT = 5;

interface SummaryIndex {
  nodeById: Map<NodeId, GraphNode>;
  edgesByNodeId: Map<NodeId, GraphEdge[]>;
}

export function summarizeGraphNode(
  data: GraphData,
  nodeId: NodeId,
  options: GraphSummaryOptions = {}
): GraphNodeSummaryPayload | GraphUnavailableObjectPayload {
  const index = buildSummaryIndex(data);
  const node = index.nodeById.get(nodeId);
  if (!node) {
    return summarizeUnavailableGraphObject(data, { kind: "node", nodeId }, "missing-node", options);
  }
  const pinHint = pinHintForNode(node, options.pins);
  const selection = selectionStateForObject(data, { kind: "node", nodeId }, options.selection);
  const relations = relationSummariesForNode(data, index, nodeId);
  const commands = nodeSummaryCommands(node, pinHint);
  if (isTemporaryObject(options.temporaryObject, { kind: "node", nodeId })) {
    commands.push({ kind: "clear-temporary-object-display", label: "清除临时显示" });
  }
  return {
    kind: "node-summary",
    object: { kind: "node", nodeId },
    nodeId,
    label: node.label || node.id,
    type: node.type,
    communityId: node.community ?? null,
    sourcePath: wikiPathForGraphNode(node),
    summary: textValue(node.summary) ?? textValue(node.content),
    connectionCount: index.edgesByNodeId.get(nodeId)?.length ?? 0,
    searchHit: searchSet(options).has(nodeId),
    pinHint,
    selection,
    strongestRelations: topRelations(relations, DEFAULT_LIMIT),
    bridgeRelations: topRelations(relations.filter((relation) => relation.bridge), DEFAULT_LIMIT),
    aggregationMarkers: markersContainingNode(options.aggregationMarkers, nodeId),
    commands
  };
}

export function summarizeGraphCommunity(
  data: GraphData,
  communityId: CommunityId,
  options: GraphSummaryOptions = {}
): GraphCommunitySummaryPayload | GraphUnavailableObjectPayload {
  const nodes = nodesForCommunity(data, communityId);
  const community = data.learning?.communities.find((item) => item.id === communityId) ?? null;
  if (nodes.length === 0 && !community) {
    return summarizeUnavailableGraphObject(data, { kind: "community", communityId }, "missing-community", options);
  }
  const index = buildSummaryIndex(data);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const relations = relationSummariesForEdges(
    data,
    data.edges.filter((edge) => nodeIds.has(endpointId(edge.from) || "") || nodeIds.has(endpointId(edge.to) || "")),
    index
  );
  const resultIds = options.searchResultIds ?? [];
  const searchHits = resultIds.filter((id) => nodeIds.has(id));
  const pinHints = nodes.map((node) => pinHintForNode(node, options.pins)).filter((hint) => hint.pinned);
  return {
    kind: "community-summary",
    object: { kind: "community", communityId },
    communityId,
    label: community?.label || communityId,
    nodeCount: Number(community?.node_count ?? nodes.length),
    coreNodeIds: coreNodeIds(data, nodes),
    searchResultIds: searchHits,
    pinHints,
    selection: selectionStateForObject(data, { kind: "community", communityId }, options.selection),
    strongestRelations: topRelations(relations, DEFAULT_LIMIT),
    bridgeRelations: topRelations(relations.filter((relation) => relation.bridge), DEFAULT_LIMIT),
    aggregationMarkers: markersContainingCommunity(options.aggregationMarkers, communityId),
    commands: [
      { kind: "enter-community", communityId, label: "进入社区" }
    ]
  };
}

export function summarizeGraphGlobal(data: GraphData, options: GraphSummaryOptions = {}): GraphGlobalOverviewPayload {
  const searchHits = stableExistingNodeIds(data, options.searchResultIds ?? []);
  const pinnedHints = data.nodes.map((node) => pinHintForNode(node, options.pins)).filter((hint) => hint.pinned);
  return {
    kind: "global-overview",
    nodeCount: data.nodes.length,
    edgeCount: data.edges.length,
    communityCount: communityIds(data).length,
    coreNodeIds: coreNodeIds(data, data.nodes),
    searchResultIds: searchHits,
    pinHints: pinnedHints,
    selection: selectionStateForObject(data, null, options.selection),
    aggregationMarkers: options.aggregationMarkers ?? [],
    commands: []
  };
}

export function summarizeGraphSearchResults(
  data: GraphData,
  query: string,
  resultIds: NodeId[],
  options: GraphSummaryOptions = {}
): GraphSearchResultsPayload {
  const visibleResultIds = stableExistingNodeIds(data, resultIds);
  const visibleSet = new Set(visibleResultIds);
  const unavailableResultIds = resultIds.filter((id) => !visibleSet.has(id));
  const pinHints = data.nodes
    .filter((node) => visibleSet.has(node.id))
    .map((node) => pinHintForNode(node, options.pins))
    .filter((hint) => hint.pinned);
  return {
    kind: "search-results",
    query,
    searchResultIds: [...resultIds],
    visibleResultIds,
    unavailableResultIds,
    selection: selectionStateForObject(data, null, options.selection),
    pinHints,
    aggregationMarkers: markersContainingAnyNode(options.aggregationMarkers, resultIds),
    commands: visibleResultIds.slice(0, DEFAULT_LIMIT).map((nodeId) => ({
      kind: "show-this-object",
      object: { kind: "node", nodeId },
      label: "显示这个对象"
    }))
  };
}

export function summarizeExcludedGraphObject(
  data: GraphData,
  object: GraphSummaryObjectRef,
  reason: GraphExcludedObjectPayload["reason"],
  options: GraphSummaryOptions = {}
): GraphExcludedObjectPayload {
  const nodeIds = nodeIdsForObject(data, object);
  return {
    kind: "excluded-object",
    object,
    reason,
    selection: selectionStateForObject(data, object, options.selection),
    searchResultIds: nodeIds.filter((id) => searchSet(options).has(id)),
    pinHints: pinHintsForNodeIds(data, nodeIds, options.pins),
    aggregationMarkers: markersContainingObject(options.aggregationMarkers, object),
    commands: [
      { kind: "show-this-object", object, label: "显示这个对象" },
      { kind: "clear-temporary-object-display", label: "清除临时显示" }
    ]
  };
}

export function summarizeUnavailableGraphObject(
  data: GraphData,
  object: GraphSummaryObjectRef,
  reason: GraphUnavailableObjectPayload["reason"],
  options: GraphSummaryOptions = {}
): GraphUnavailableObjectPayload {
  return {
    kind: "unavailable-object",
    object,
    reason,
    selection: selectionStateForObject(data, object, options.selection),
    searchResultIds: options.searchResultIds ?? [],
    pinHints: pinHintsForNodeIds(data, nodeIdsForObject(data, object), options.pins),
    aggregationMarkers: markersContainingObject(options.aggregationMarkers, object),
    commands: []
  };
}

export function buildCommunityAggregationMarkers(
  data: GraphData,
  options: { pins?: PinMap; minCommunitySize?: number } = {}
): GraphAggregationMarker[] {
  const minCommunitySize = Math.max(1, Math.floor(Number(options.minCommunitySize) || 6));
  const nodesByCommunity = new Map<CommunityId, NodeId[]>();
  for (const node of data.nodes) {
    if (!node.community) continue;
    const ids = nodesByCommunity.get(node.community) ?? [];
    ids.push(node.id);
    nodesByCommunity.set(node.community, ids);
  }
  const communityById = new Map((data.learning?.communities ?? []).map((community) => [community.id, community]));
  const pinnedWikiPaths = new Set(Object.keys(options.pins ?? {}));
  return [...nodesByCommunity.entries()]
    .filter(([, nodeIds]) => nodeIds.length >= minCommunitySize)
    .map(([communityId, nodeIds]) => {
      const community = communityById.get(communityId) ?? null;
      const pinnedNodeIds = data.nodes
        .filter((node) => node.community === communityId && pinnedWikiPaths.has(wikiPathForGraphNode(node)))
        .map((node) => node.id);
      return {
        id: `community-container:${communityId}`,
        label: community?.label ?? communityId,
        communityId,
        nodeIds,
        pinnedNodeIds,
        totalCount: Number(community?.node_count ?? nodeIds.length)
      };
    });
}

function buildSummaryIndex(data: GraphData): SummaryIndex {
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const edgesByNodeId = new Map<NodeId, GraphEdge[]>(data.nodes.map((node) => [node.id, []]));
  for (const edge of data.edges) {
    const from = endpointId(edge.from);
    const to = endpointId(edge.to);
    if (!from || !to || !nodeById.has(from) || !nodeById.has(to)) continue;
    edgesByNodeId.get(from)?.push(edge);
    edgesByNodeId.get(to)?.push(edge);
  }
  return { nodeById, edgesByNodeId };
}

function relationSummariesForNode(data: GraphData, index: SummaryIndex, nodeId: NodeId): GraphRelationSummary[] {
  return relationSummariesForEdges(data, index.edgesByNodeId.get(nodeId) ?? [], index);
}

function relationSummariesForEdges(data: GraphData, edges: GraphEdge[], index: SummaryIndex): GraphRelationSummary[] {
  return edges.flatMap((edge) => {
    const fromNodeId = endpointId(edge.from);
    const toNodeId = endpointId(edge.to);
    const from = fromNodeId ? index.nodeById.get(fromNodeId) : null;
    const to = toNodeId ? index.nodeById.get(toNodeId) : null;
    if (!from || !to) return [];
    return [{
      edgeId: edge.id || edgeIdForEndpoints(from.id, to.id),
      fromNodeId: from.id,
      toNodeId: to.id,
      relationType: edge.relation_type ?? null,
      confidence: edge.confidence ?? edge.type ?? null,
      weight: numericWeight(edge.weight),
      bridge: (from.community ?? null) !== (to.community ?? null)
    }];
  });
}

function topRelations(relations: GraphRelationSummary[], limit: number): GraphRelationSummary[] {
  return [...relations]
    .sort((left, right) => right.weight - left.weight || left.edgeId.localeCompare(right.edgeId))
    .slice(0, limit);
}

function coreNodeIds(data: GraphData, nodes: GraphNode[], limit = DEFAULT_LIMIT): NodeId[] {
  const index = buildSummaryIndex(data);
  return [...nodes]
    .sort((left, right) => nodeRank(data, index, right) - nodeRank(data, index, left) || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map((node) => node.id);
}

function nodeRank(data: GraphData, index: SummaryIndex, node: GraphNode): number {
  const recommended = data.learning?.entry.recommended_start_node_id === node.id ? 10000 : 0;
  const bridge = data.insights?.bridge_nodes.some((item) => item.id === node.id) ? 1000 : 0;
  return recommended + bridge + numericWeight(node.score) * 100 + numericWeight(node.weight) * 10 + (index.edgesByNodeId.get(node.id)?.length ?? 0);
}

function selectionStateForObject(
  data: GraphData,
  object: GraphSummaryObjectRef | null,
  input?: SelectionInput | null
): GraphSummarySelectionState {
  if (!input) {
    return {
      input: null,
      selectionId: null,
      selectedNodeIds: [],
      selectedCommunityIds: [],
      containsCurrentObject: false
    };
  }
  const selection = resolveSelectionForCapabilities(data, input, { canAsk: false });
  return {
    input,
    selectionId: selection.id,
    selectedNodeIds: selection.nodeIds,
    selectedCommunityIds: selection.communityIds,
    containsCurrentObject: object ? objectContainedInSelection(data, object, selection.nodeIds, selection.communityIds) : selection.nodeIds.length > 0
  };
}

function objectContainedInSelection(
  data: GraphData,
  object: GraphSummaryObjectRef,
  selectedNodeIds: NodeId[],
  selectedCommunityIds: CommunityId[]
): boolean {
  const nodeSet = new Set(selectedNodeIds);
  const communitySet = new Set(selectedCommunityIds);
  if (object.kind === "node") return nodeSet.has(object.nodeId);
  if (object.kind === "community") return communitySet.has(object.communityId);
  return object.nodeIds.some((nodeId) => nodeSet.has(nodeId)) || Boolean(object.communityId && communitySet.has(object.communityId));
}

function nodeSummaryCommands(node: GraphNode, pinHint: GraphPinHint): GraphSummaryCommand[] {
  const commands: GraphSummaryCommand[] = [
    {
      kind: "open-detail-read",
      nodeId: node.id,
      path: wikiPathForGraphNode(node),
      label: "打开详情"
    },
    {
      kind: "set-fixed-position",
      mode: pinHint.pinned ? "unfix" : "fix",
      nodeId: node.id,
      wikiPath: wikiPathForGraphNode(node),
      label: pinHint.pinned ? "取消固定位置" : "固定位置"
    }
  ];
  if (node.community) {
    commands.push({
      kind: "enter-community",
      communityId: node.community,
      label: "进入社区"
    });
  }
  return commands;
}

function pinHintForNode(node: GraphNode, pins?: PinMap): GraphPinHint {
  const wikiPath = wikiPathForGraphNode(node);
  const position = pins?.[wikiPath] ?? null;
  return {
    nodeId: node.id,
    wikiPath,
    pinned: Boolean(position),
    position
  };
}

function pinHintsForNodeIds(data: GraphData, nodeIds: NodeId[], pins?: PinMap): GraphPinHint[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  return nodeIds
    .map((id) => nodes.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .map((node) => pinHintForNode(node, pins))
    .filter((hint) => hint.pinned);
}

function nodesForCommunity(data: GraphData, communityId: CommunityId): GraphNode[] {
  return data.nodes.filter((node) => node.community === communityId);
}

function stableExistingNodeIds(data: GraphData, ids: NodeId[]): NodeId[] {
  const requested = new Set(ids);
  return data.nodes.map((node) => node.id).filter((id) => requested.has(id));
}

function communityIds(data: GraphData): CommunityId[] {
  const ids = new Set<CommunityId>();
  for (const community of data.learning?.communities ?? []) ids.add(community.id);
  for (const node of data.nodes) {
    if (node.community) ids.add(node.community);
  }
  return [...ids];
}

function nodeIdsForObject(data: GraphData, object: GraphSummaryObjectRef): NodeId[] {
  if (object.kind === "node") return [object.nodeId];
  if (object.kind === "aggregation") return [...object.nodeIds];
  return nodesForCommunity(data, object.communityId).map((node) => node.id);
}

function markersContainingObject(
  markers: GraphAggregationMarker[] | undefined,
  object: GraphSummaryObjectRef
): GraphAggregationMarker[] {
  if (!markers) return [];
  if (object.kind === "community") return markersContainingCommunity(markers, object.communityId);
  if (object.kind === "node") return markersContainingNode(markers, object.nodeId);
  const ids = new Set(object.nodeIds);
  return markers.filter((marker) => marker.id === object.aggregationId || marker.nodeIds.some((nodeId) => ids.has(nodeId)));
}

function markersContainingNode(markers: GraphAggregationMarker[] | undefined, nodeId: NodeId): GraphAggregationMarker[] {
  return (markers ?? []).filter((marker) => marker.nodeIds.includes(nodeId));
}

function markersContainingCommunity(
  markers: GraphAggregationMarker[] | undefined,
  communityId: CommunityId
): GraphAggregationMarker[] {
  return (markers ?? []).filter((marker) => marker.communityId === communityId);
}

function markersContainingAnyNode(markers: GraphAggregationMarker[] | undefined, nodeIds: NodeId[]): GraphAggregationMarker[] {
  const ids = new Set(nodeIds);
  return (markers ?? []).filter((marker) => marker.nodeIds.some((nodeId) => ids.has(nodeId)));
}

function searchSet(options: GraphSummaryOptions): Set<NodeId> {
  return new Set(options.searchResultIds ?? []);
}

function isTemporaryObject(left: GraphSummaryObjectRef | null | undefined, right: GraphSummaryObjectRef): boolean {
  if (!left || left.kind !== right.kind) return false;
  if (left.kind === "node" && right.kind === "node") return left.nodeId === right.nodeId;
  if (left.kind === "community" && right.kind === "community") return left.communityId === right.communityId;
  if (left.kind === "aggregation" && right.kind === "aggregation") return left.aggregationId === right.aggregationId;
  return false;
}

function numericWeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function endpointId(value: unknown): NodeId | null {
  if (value == null || value === "") return null;
  return String(value);
}

function edgeIdForEndpoints(from: NodeId, to: NodeId): EdgeId {
  return `${from}->${to}`;
}

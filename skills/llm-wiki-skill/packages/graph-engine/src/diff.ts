import type { CommunityId, GraphData, GraphDiff, GraphNode, NodeId } from "./types";

const MIN_COMMUNITY_MATCH_JACCARD = 0.5;

interface CommunityGroup {
	id: CommunityId;
	members: Set<NodeId>;
}

export function diffGraphData(previous: GraphData, next: GraphData): GraphDiff {
	const previousNodeIds = new Set(previous.nodes.map((node) => node.id));
	const nextNodeIds = new Set(next.nodes.map((node) => node.id));
	const previousEdgeIds = new Set(previous.edges.map((edge) => edge.id));
	const nextEdgeIds = new Set(next.edges.map((edge) => edge.id));
	const alignedCommunities = alignCommunities(previous, next);

	const addedNodes = stableDifference(nextNodeIds, previousNodeIds, next.nodes.map((node) => node.id));
	const removedNodes = stableDifference(previousNodeIds, nextNodeIds, previous.nodes.map((node) => node.id));
	const addedEdges = stableDifference(nextEdgeIds, previousEdgeIds, next.edges.map((edge) => edge.id));
	const removedEdges = stableDifference(previousEdgeIds, nextEdgeIds, previous.edges.map((edge) => edge.id));
	const recoloredNodes = recoloredExistingNodes(previous, next, alignedCommunities);

	return {
		addedNodes,
		removedNodes,
		recoloredNodes,
		addedEdges,
		removedEdges,
		newCommunities: alignedCommunities.newCommunities,
		stats: {
			nodeCount: next.nodes.length,
			edgeCount: next.edges.length,
			communityCount: communityGroups(next).length
		}
	};
}

function recoloredExistingNodes(
	previous: GraphData,
	next: GraphData,
	alignment: { nextToPrevious: Map<CommunityId, CommunityId> }
): GraphDiff["recoloredNodes"] {
	const previousById = new Map(previous.nodes.map((node) => [node.id, node]));
	const result: GraphDiff["recoloredNodes"] = [];
	for (const nextNode of next.nodes) {
		const previousNode = previousById.get(nextNode.id);
		if (!previousNode) continue;
		const previousCommunity = communityForNode(previousNode);
		const nextCommunity = communityForNode(nextNode);
		if (!previousCommunity || !nextCommunity) continue;
		const alignedNextCommunity = alignment.nextToPrevious.get(nextCommunity);
		if (!alignedNextCommunity) continue;
		if (previousCommunity === alignedNextCommunity) continue;
		result.push({ id: nextNode.id, from: previousCommunity, to: nextCommunity });
	}
	return result;
}

function alignCommunities(previous: GraphData, next: GraphData): {
	nextToPrevious: Map<CommunityId, CommunityId>;
	newCommunities: CommunityId[];
} {
	const previousGroups = communityGroups(previous);
	const nextGroups = communityGroups(next);
	const pairs: Array<{ previous: CommunityId; next: CommunityId; score: number }> = [];
	for (const previousGroup of previousGroups) {
		for (const nextGroup of nextGroups) {
			const score = jaccard(previousGroup.members, nextGroup.members);
			if (score >= MIN_COMMUNITY_MATCH_JACCARD) {
				pairs.push({ previous: previousGroup.id, next: nextGroup.id, score });
			}
		}
	}
	pairs.sort((a, b) => b.score - a.score || a.previous.localeCompare(b.previous) || a.next.localeCompare(b.next));

	const usedPrevious = new Set<CommunityId>();
	const usedNext = new Set<CommunityId>();
	const nextToPrevious = new Map<CommunityId, CommunityId>();
	for (const pair of pairs) {
		if (usedPrevious.has(pair.previous) || usedNext.has(pair.next)) continue;
		usedPrevious.add(pair.previous);
		usedNext.add(pair.next);
		nextToPrevious.set(pair.next, pair.previous);
	}

	const newCommunities = nextGroups
		.map((group) => group.id)
		.filter((id) => !nextToPrevious.has(id));
	return { nextToPrevious, newCommunities };
}

function communityGroups(data: GraphData): CommunityGroup[] {
	const groups = new Map<CommunityId, Set<NodeId>>();
	for (const node of data.nodes) {
		const community = communityForNode(node);
		if (!community) continue;
		const members = groups.get(community) ?? new Set<NodeId>();
		members.add(node.id);
		groups.set(community, members);
	}
	return Array.from(groups.entries()).map(([id, members]) => ({ id, members }));
}

function communityForNode(node: GraphNode): CommunityId | null {
	if (node.community == null || node.community === "") return null;
	return String(node.community);
}

function jaccard(left: Set<NodeId>, right: Set<NodeId>): number {
	if (left.size === 0 && right.size === 0) return 1;
	let intersection = 0;
	for (const id of left) {
		if (right.has(id)) intersection++;
	}
	const union = new Set([...left, ...right]).size;
	return union === 0 ? 0 : intersection / union;
}

function stableDifference<T>(left: Set<T>, right: Set<T>, order: T[]): T[] {
	return order.filter((item) => left.has(item) && !right.has(item));
}

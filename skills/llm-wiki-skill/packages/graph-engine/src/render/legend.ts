import type { NodeId } from "../types";
import type { RenderableCommunity, RenderableNode } from "./model";

export interface CommunityLegendRow {
  id: string;
  label: string;
  color: string;
  pageCount: number;
  nodeIds: NodeId[];
}

export function buildCommunityLegend(
  communities: Array<Pick<RenderableCommunity, "id" | "label" | "color" | "nodeCount" | "wash">>,
  nodes: Array<Pick<RenderableNode, "id" | "community">>
): CommunityLegendRow[] {
  return communities
    .filter((community) => community.nodeCount > 0)
    .map((community) => ({
      id: community.id,
      label: community.label || community.id,
      color: community.color,
      pageCount: community.nodeCount,
      nodeIds: nodes.filter((node) => node.community === community.id).map((node) => node.id)
    }));
}

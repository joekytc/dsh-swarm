import type { GraphData, GraphEdge, GraphNode, PinMap } from "../src/types";

export type LargeGraphFixtureId =
  | "real-snapshot-proxy"
  | "nodes-1000-sparse"
  | "nodes-1000-dense"
  | "nodes-5000-sparse"
  | "nodes-5000-dense"
  | "nodes-10000-aggregation"
  | "nodes-10000-high-edge"
  | "oversized-community"
  | "many-small-communities"
  | "many-search-hits"
  | "many-pin-nodes";

export interface LargeGraphFixtureSpec {
  id: LargeGraphFixtureId;
  nodes: number;
  edges: number;
  communities: number;
  largestCommunity: number;
  searchHits: number;
  pinCount: number;
  oversizedCommunity: boolean;
  seed: number;
  communitySizes?: number[];
}

export interface LargeGraphFixtureMetadata {
  id: LargeGraphFixtureId;
  nodes: number;
  edges: number;
  communities: number;
  largest_community: number;
  largest_connected_density: number;
  search_hits: number;
  pin_count: number;
  oversized_community: boolean;
}

export interface LargeGraphFixture {
  id: LargeGraphFixtureId;
  data: GraphData;
  pins: PinMap;
  metadata: LargeGraphFixtureMetadata;
}

export const LARGE_GRAPH_FIXTURE_SPECS: LargeGraphFixtureSpec[] = [
  {
    id: "real-snapshot-proxy",
    nodes: 1000,
    edges: 1600,
    communities: 16,
    largestCommunity: 63,
    searchHits: 40,
    pinCount: 20,
    oversizedCommunity: false,
    seed: 11
  },
  {
    id: "nodes-1000-sparse",
    nodes: 1000,
    edges: 1400,
    communities: 20,
    largestCommunity: 50,
    searchHits: 25,
    pinCount: 25,
    oversizedCommunity: false,
    seed: 101
  },
  {
    id: "nodes-1000-dense",
    nodes: 1000,
    edges: 12000,
    communities: 20,
    largestCommunity: 50,
    searchHits: 100,
    pinCount: 50,
    oversizedCommunity: false,
    seed: 102
  },
  {
    id: "nodes-5000-sparse",
    nodes: 5000,
    edges: 6500,
    communities: 50,
    largestCommunity: 100,
    searchHits: 100,
    pinCount: 100,
    oversizedCommunity: false,
    seed: 501
  },
  {
    id: "nodes-5000-dense",
    nodes: 5000,
    edges: 60000,
    communities: 50,
    largestCommunity: 100,
    searchHits: 250,
    pinCount: 250,
    oversizedCommunity: false,
    seed: 502
  },
  {
    id: "nodes-10000-aggregation",
    nodes: 10000,
    edges: 14000,
    communities: 100,
    largestCommunity: 100,
    searchHits: 200,
    pinCount: 200,
    oversizedCommunity: false,
    seed: 1001
  },
  {
    id: "nodes-10000-high-edge",
    nodes: 10000,
    edges: 90000,
    communities: 100,
    largestCommunity: 100,
    searchHits: 300,
    pinCount: 300,
    oversizedCommunity: false,
    seed: 1002
  },
  {
    id: "oversized-community",
    nodes: 3000,
    edges: 7000,
    communities: 15,
    largestCommunity: 1800,
    searchHits: 120,
    pinCount: 120,
    oversizedCommunity: true,
    seed: 3001,
    communitySizes: [1800, 86, 86, 86, 86, 86, 86, 86, 86, 86, 85, 85, 85, 85, 86]
  },
  {
    id: "many-small-communities",
    nodes: 5000,
    edges: 6000,
    communities: 1000,
    largestCommunity: 5,
    searchHits: 100,
    pinCount: 100,
    oversizedCommunity: false,
    seed: 4001
  },
  {
    id: "many-search-hits",
    nodes: 5000,
    edges: 7000,
    communities: 50,
    largestCommunity: 100,
    searchHits: 1200,
    pinCount: 100,
    oversizedCommunity: false,
    seed: 5001
  },
  {
    id: "many-pin-nodes",
    nodes: 5000,
    edges: 7000,
    communities: 50,
    largestCommunity: 100,
    searchHits: 100,
    pinCount: 1200,
    oversizedCommunity: false,
    seed: 5002
  }
];

export function generateLargeGraphFixture(id: LargeGraphFixtureId): LargeGraphFixture {
  const spec = LARGE_GRAPH_FIXTURE_SPECS.find((item) => item.id === id);
  if (!spec) throw new Error(`Unknown large graph fixture: ${id}`);
  const communitySizes = spec.communitySizes || evenCommunitySizes(spec.nodes, spec.communities);
  const nodeCommunity = new Map<string, string>();
  const nodes: GraphNode[] = [];
  let nodeIndex = 0;
  for (let communityIndex = 0; communityIndex < communitySizes.length; communityIndex += 1) {
    const community = `c${communityIndex}`;
    for (let localIndex = 0; localIndex < communitySizes[communityIndex]; localIndex += 1) {
      const id = `n${nodeIndex}`;
      const searchHit = nodeIndex < spec.searchHits;
      const labelPrefix = searchHit ? "needle" : "node";
      const type = nodeIndex % 11 === 0 ? "source" : nodeIndex % 7 === 0 ? "topic" : "entity";
      nodes.push({
        id,
        label: `${labelPrefix} ${nodeIndex} community ${communityIndex}`,
        type,
        community,
        source_path: `wiki/generated/${spec.id}/${id}.md`,
        weight: 100 - (nodeIndex % 83),
        x: coordinate(nodeIndex, 997),
        y: coordinate(nodeIndex, 463)
      });
      nodeCommunity.set(id, community);
      nodeIndex += 1;
    }
  }

  const edges = generateEdges(spec, nodes, nodeCommunity);
  const pins = generatePins(spec, nodes);
  const metadata = summarizeLargeGraphFixture(spec.id, {
    meta: {
      build_date: "2026-06-18T00:00:00.000Z",
      wiki_title: `Large graph fixture ${spec.id}`,
      total_nodes: nodes.length,
      total_edges: edges.length,
      initial_view: nodes.slice(0, Math.min(250, nodes.length)).map((node) => node.id),
      degraded: spec.nodes >= 5000
    },
    nodes,
    edges,
    learning: {
      version: 1,
      entry: {
        recommended_start_node_id: nodes[0]?.id ?? null,
        recommended_start_reason: "fixture_hub",
        default_mode: "global"
      },
      views: {
        path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
        community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
        global: { enabled: true, node_ids: nodes.map((node) => node.id), degraded: spec.nodes >= 5000 }
      },
      communities: communitySizes.map((size, index) => ({
        id: `c${index}`,
        label: `Community ${index}`,
        node_count: size,
        color_index: index,
        recommended_start_node_id: firstNodeIdForCommunity(communitySizes, index)
      }))
    }
  }, pins);

  return {
    id: spec.id,
    data: {
      meta: {
        build_date: "2026-06-18T00:00:00.000Z",
        wiki_title: `Large graph fixture ${spec.id}`,
        total_nodes: nodes.length,
        total_edges: edges.length,
        initial_view: nodes.slice(0, Math.min(250, nodes.length)).map((node) => node.id),
        degraded: spec.nodes >= 5000
      },
      nodes,
      edges,
      learning: {
        version: 1,
        entry: {
          recommended_start_node_id: nodes[0]?.id ?? null,
          recommended_start_reason: "fixture_hub",
          default_mode: "global"
        },
        views: {
          path: { enabled: false, start_node_id: null, node_ids: [], degraded: true },
          community: { enabled: false, community_id: null, label: null, node_ids: [], is_weak: false, degraded: true },
          global: { enabled: true, node_ids: nodes.map((node) => node.id), degraded: spec.nodes >= 5000 }
        },
        communities: communitySizes.map((size, index) => ({
          id: `c${index}`,
          label: `Community ${index}`,
          node_count: size,
          color_index: index,
          recommended_start_node_id: firstNodeIdForCommunity(communitySizes, index)
        }))
      }
    },
    pins,
    metadata
  };
}

export function summarizeLargeGraphFixture(id: LargeGraphFixtureId, data: GraphData, pins: PinMap): LargeGraphFixtureMetadata {
  const communityCounts = new Map<string, number>();
  for (const node of data.nodes) {
    const community = String(node.community ?? "_none");
    communityCounts.set(community, (communityCounts.get(community) || 0) + 1);
  }
  const nodeCommunity = new Map(data.nodes.map((node) => [node.id, String(node.community ?? "_none")]));
  const internalEdgesByCommunity = new Map<string, number>();
  for (const edge of data.edges) {
    const fromCommunity = nodeCommunity.get(edge.from);
    const toCommunity = nodeCommunity.get(edge.to);
    if (!fromCommunity || fromCommunity !== toCommunity) continue;
    internalEdgesByCommunity.set(fromCommunity, (internalEdgesByCommunity.get(fromCommunity) || 0) + 1);
  }
  const largestCommunity = Math.max(...communityCounts.values());
  let largestConnectedDensity = 0;
  for (const [community, count] of communityCounts) {
    const possible = count > 1 ? (count * (count - 1)) / 2 : 0;
    const density = possible ? (internalEdgesByCommunity.get(community) || 0) / possible : 0;
    largestConnectedDensity = Math.max(largestConnectedDensity, density);
  }
  return {
    id,
    nodes: data.nodes.length,
    edges: data.edges.length,
    communities: communityCounts.size,
    largest_community: largestCommunity,
    largest_connected_density: Number(largestConnectedDensity.toFixed(4)),
    search_hits: data.nodes.filter((node) => node.label.includes("needle")).length,
    pin_count: Object.keys(pins).length,
    oversized_community: largestCommunity >= 1000
  };
}

function evenCommunitySizes(nodes: number, communities: number): number[] {
  const base = Math.floor(nodes / communities);
  const remainder = nodes % communities;
  return Array.from({ length: communities }, (_, index) => base + (index < remainder ? 1 : 0));
}

function generateEdges(
  spec: LargeGraphFixtureSpec,
  nodes: GraphNode[],
  nodeCommunity: Map<string, string>
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const byCommunity = new Map<string, string[]>();
  for (const node of nodes) {
    const community = String(node.community ?? "_none");
    const list = byCommunity.get(community) || [];
    list.push(node.id);
    byCommunity.set(community, list);
  }

  for (const members of byCommunity.values()) {
    for (let index = 1; index < members.length && edges.length < spec.edges; index += 1) {
      addEdge(edges, seen, members[index - 1], members[index], "EXTRACTED");
    }
  }

  let cursor = 0;
  const orderedCommunities = [...byCommunity.values()];
  while (edges.length < spec.edges && cursor < orderedCommunities.length * 3) {
    const fromMembers = orderedCommunities[cursor % orderedCommunities.length];
    const toMembers = orderedCommunities[(cursor + 1) % orderedCommunities.length];
    addEdge(
      edges,
      seen,
      fromMembers[cursor % fromMembers.length],
      toMembers[(cursor * 7) % toMembers.length],
      "INFERRED"
    );
    cursor += 1;
  }

  const random = mulberry32(spec.seed);
  let attempts = 0;
  const maxAttempts = spec.edges * 20;
  while (edges.length < spec.edges && attempts < maxAttempts) {
    const from = nodes[Math.floor(random() * nodes.length)];
    const sameCommunity = random() < 0.74;
    let to: GraphNode;
    if (sameCommunity) {
      const members = byCommunity.get(nodeCommunity.get(from.id) || "") || nodes.map((node) => node.id);
      to = nodes[Number(members[Math.floor(random() * members.length)].slice(1))] || nodes[Math.floor(random() * nodes.length)];
    } else {
      to = nodes[Math.floor(random() * nodes.length)];
    }
    addEdge(edges, seen, from.id, to.id, random() < 0.15 ? "INFERRED" : "EXTRACTED");
    attempts += 1;
  }
  if (edges.length !== spec.edges) throw new Error(`Could not generate ${spec.edges} unique edges for ${spec.id}`);
  return edges;
}

function addEdge(edges: GraphEdge[], seen: Set<string>, from: string, to: string, type: "EXTRACTED" | "INFERRED"): void {
  if (from === to) return;
  const key = from < to ? `${from}:${to}` : `${to}:${from}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({
    id: `e${edges.length}`,
    from,
    to,
    type,
    confidence: type,
    relation_type: type === "EXTRACTED" ? "实现" : "衍生",
    weight: type === "EXTRACTED" ? 1 : 0.55
  });
}

function generatePins(spec: LargeGraphFixtureSpec, nodes: GraphNode[]): PinMap {
  const pins: PinMap = {};
  for (const node of nodes.slice(0, spec.pinCount)) {
    if (!node.source_path) continue;
    pins[node.source_path] = {
      x: Number(node.x) * 10,
      y: Number(node.y) * 6.8,
      coordinateSpace: "world"
    };
  }
  return pins;
}

function firstNodeIdForCommunity(communitySizes: number[], communityIndex: number): string {
  let offset = 0;
  for (let index = 0; index < communityIndex; index += 1) offset += communitySizes[index];
  return `n${offset}`;
}

function coordinate(index: number, salt: number): number {
  return Math.round((((index * salt) % 1000) / 10) * 100) / 100;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

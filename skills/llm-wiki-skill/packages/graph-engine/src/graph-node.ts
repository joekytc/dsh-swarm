import type { GraphNodeType, WikiPath } from "./types";

interface GraphNodePathInput {
  id: string;
  type?: unknown;
  source_path?: unknown;
  path?: unknown;
  source?: unknown;
}

export function wikiPathForGraphNode(node: GraphNodePathInput): WikiPath {
  const existing = node.source_path || node.path || node.source;
  if (existing) return String(existing);
  const id = node.id.endsWith(".md") ? node.id.slice(0, -3) : node.id;
  return `wiki/${wikiDirectoryForGraphNodeType(node.type)}/${id}.md`;
}

export function wikiDirectoryForGraphNodeType(type: unknown): string {
  const key = String(type || "");
  if (key === "topic") return "topics";
  if (key === "source") return "sources";
  if (key === "comparison") return "comparisons";
  if (key === "synthesis") return "synthesis";
  if (key === "query") return "queries";
  return "entities";
}

export function graphNodeTypeLabel(type: GraphNodeType | unknown): string {
  const key = String(type || "");
  if (key === "topic") return "主题";
  if (key === "source") return "来源";
  if (key === "comparison") return "对比";
  if (key === "synthesis") return "综合";
  if (key === "query") return "查询";
  if (key === "entity") return "实体";
  return key || "实体";
}

import type { GraphNode, GraphNodeType } from "../types";
import { atlasTypeLabel, stripAtlasMarkdown } from "../model/labels";

export interface GraphHoverPreview {
  id: string;
  title: string;
  typeLabel: string;
  summary: string;
}

const SUMMARY_LIMIT = 140;

export function buildHoverPreview(node: Pick<GraphNode, "id" | "label" | "type" | "content" | "summary">): GraphHoverPreview {
  const title = String(node.label || node.id || "");
  return {
    id: String(node.id || title),
    title,
    typeLabel: atlasTypeLabel(node.type as GraphNodeType),
    summary: previewSummary(node)
  };
}

export function previewSummary(node: Pick<GraphNode, "content" | "summary">): string {
  const explicit = cleanPreviewParagraph(String(node.summary || ""));
  if (explicit) return truncatePreviewSummary(explicit);
  const paragraph = firstUsefulParagraph(String(node.content || ""));
  return paragraph ? truncatePreviewSummary(cleanPreviewParagraph(paragraph)) : "";
}

export function firstUsefulParagraph(markdown: string): string {
  const withoutFrontmatter = String(markdown || "").replace(/^---[\s\S]*?---\s*/, "");
  const lines = withoutFrontmatter.split(/\r?\n/);
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^#{1,6}\s+/.test(line)) continue;
    if (!line) {
      if (current.length) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(rawLine);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks.map(cleanPreviewParagraph).find(Boolean) || "";
}

function cleanPreviewParagraph(value: string): string {
  return stripAtlasMarkdown(value)
    .replace(/\s+/g, " ")
    .trim();
}

function truncatePreviewSummary(value: string): string {
  if (value.length <= SUMMARY_LIMIT) return value;
  return `${value.slice(0, SUMMARY_LIMIT).trim()}...`;
}

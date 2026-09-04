import type { GraphHoverPreview } from "./preview";
import { edgeConfidenceLabel } from "./edges";

export function createHoverPreviewContent(ownerDocument: Document, preview: GraphHoverPreview): HTMLElement {
  const article = ownerDocument.createElement("article");
  article.className = "graph-hover-preview-card";
  const type = ownerDocument.createElement("div");
  type.className = "graph-hover-preview-type";
  type.textContent = preview.typeLabel;
  const title = ownerDocument.createElement("div");
  title.className = "graph-hover-preview-title";
  title.textContent = preview.title;
  article.append(type, title);
  if (preview.summary) {
    const summary = ownerDocument.createElement("p");
    summary.className = "graph-hover-preview-summary";
    summary.textContent = preview.summary;
    article.appendChild(summary);
  }
  return article;
}

export function createEdgeHoverPreviewContent(ownerDocument: Document, relationType: string, confidence: string): HTMLElement {
  const article = ownerDocument.createElement("article");
  article.className = "graph-hover-preview-card graph-edge-hover-card";
  const type = ownerDocument.createElement("div");
  type.className = "graph-hover-preview-type";
  type.textContent = "关系";
  const title = ownerDocument.createElement("div");
  title.className = "graph-hover-preview-title";
  title.textContent = relationType;
  const summary = ownerDocument.createElement("p");
  summary.className = "graph-hover-preview-summary";
  summary.textContent = `置信度：${edgeConfidenceLabel(confidence)}`;
  article.append(type, title, summary);
  return article;
}

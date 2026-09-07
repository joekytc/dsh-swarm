import type { GraphNode, SelectionInput } from "../types";
import { graphNodeTypeLabel, wikiPathForGraphNode } from "../graph-node";

export interface OfflineReaderNode {
  id: string;
  label: string;
  type: string;
  content?: string;
  summary?: string;
}

interface GraphReaderNodeMeta {
  type: string;
  typeLabel: string;
  sourcePath: string;
  date: string | null;
  source: string | null;
}

export interface OfflineSelectionPanelInput {
  selection: SelectionInput | null;
  selectedNodes: GraphNode[];
  facts: {
    pageCount: number;
    internalLinkCount: number;
    communityCount: number;
    isolatedCount: number;
  } | null;
}

export function renderOfflineReader(
  ownerDocument: Document,
  reader: HTMLElement,
  input: {
    selected: OfflineReaderNode | null;
    rawNode: GraphNode | null;
    onClose: () => void;
  }
): void {
  const { selected, rawNode } = input;
  reader.dataset.state = selected ? "open" : "closed";
  reader.replaceChildren();
  if (!selected || !rawNode) {
    const empty = ownerDocument.createElement("p");
    empty.className = "graph-reader-empty";
    empty.textContent = "选择一个节点查看内容";
    reader.appendChild(empty);
    return;
  }

  const header = ownerDocument.createElement("div");
  header.className = "graph-reader-header";
  const title = ownerDocument.createElement("div");
  title.className = "graph-reader-title";
  title.textContent = selected.label;
  const readerNode = graphReaderNode(rawNode);
  const meta = ownerDocument.createElement("div");
  meta.className = "graph-reader-meta";
  for (const item of graphReaderMetaItems(readerNode)) {
    const tag = ownerDocument.createElement("span");
    tag.textContent = item;
    meta.appendChild(tag);
  }
  const close = ownerDocument.createElement("button");
  close.type = "button";
  close.className = "graph-reader-close";
  close.setAttribute("aria-label", "关闭阅读面板");
  close.textContent = "×";
  close.addEventListener("click", input.onClose);
  header.append(title, meta, close);

  const body = ownerDocument.createElement("div");
  body.className = "graph-reader-body";
  if (readerNode.type === "source" && readerNode.sourcePath) {
    const sourceLink = ownerDocument.createElement("a");
    sourceLink.className = "graph-reader-source";
    sourceLink.href = readerNode.sourcePath;
    sourceLink.textContent = readerNode.sourcePath;
    body.appendChild(sourceLink);
  }
  const content = String(rawNode.content || rawNode.summary || selected.label);
  const rendered = renderMarkdown(content);
  if (rendered) {
    const article = ownerDocument.createElement("article");
    article.className = "graph-reader-markdown";
    article.innerHTML = rendered;
    body.appendChild(article);
  } else {
    const pre = ownerDocument.createElement("pre");
    pre.textContent = content;
    body.appendChild(pre);
  }
  reader.append(header, body);
}

export function renderOfflineSelectionPanel(
  ownerDocument: Document,
  panel: HTMLElement,
  input: OfflineSelectionPanelInput & { onClose: () => void }
): void {
  panel.replaceChildren();
  panel.dataset.state = input.selection ? "open" : "closed";
  if (!input.selection || !input.facts) {
    const empty = ownerDocument.createElement("p");
    empty.className = "graph-selection-empty";
    empty.textContent = "Shift+点击 可选择多个节点";
    panel.appendChild(empty);
    return;
  }

  const header = ownerDocument.createElement("div");
  header.className = "graph-selection-header";
  const title = ownerDocument.createElement("div");
  title.className = "graph-selection-title";
  title.textContent = offlineSelectionTitle(input.selection, input.selectedNodes.length);
  const close = ownerDocument.createElement("button");
  close.type = "button";
  close.className = "graph-selection-close";
  close.setAttribute("aria-label", "关闭选区面板");
  close.textContent = "×";
  close.addEventListener("click", input.onClose);
  header.append(title, close);

  const hint = ownerDocument.createElement("div");
  hint.className = "graph-selection-hint";
  hint.textContent = "Shift+点击 增删节点";

  const facts = ownerDocument.createElement("div");
  facts.className = "graph-selection-facts";
  facts.append(
    createSelectionFact(ownerDocument, "页面", input.facts.pageCount),
    createSelectionFact(ownerDocument, "内部关联", input.facts.internalLinkCount),
    createSelectionFact(ownerDocument, "社区", input.facts.communityCount),
    createSelectionFact(ownerDocument, "孤立页", input.facts.isolatedCount)
  );

  const list = ownerDocument.createElement("ol");
  list.className = "graph-selection-pages";
  for (const node of input.selectedNodes) {
    const item = ownerDocument.createElement("li");
    item.className = "graph-selection-page";
    const name = ownerDocument.createElement("span");
    name.className = "graph-selection-page-title";
    name.textContent = node.label || node.id;
    const path = ownerDocument.createElement("span");
    path.className = "graph-selection-page-path";
    path.textContent = wikiPathForGraphNode(node);
    item.append(name, path);
    list.appendChild(item);
  }

  panel.append(header, hint, facts, list);
}

function createSelectionFact(ownerDocument: Document, label: string, value: number): HTMLElement {
  const item = ownerDocument.createElement("div");
  item.className = "graph-selection-fact";
  const number = ownerDocument.createElement("strong");
  number.textContent = String(value);
  const text = ownerDocument.createElement("span");
  text.textContent = label;
  item.append(number, text);
  return item;
}

function offlineSelectionTitle(selection: SelectionInput, count: number): string {
  if (selection.kind === "community") return `社区选区 · ${count} 页`;
  if (selection.kind === "neighbors") return `相邻节点 · ${count} 页`;
  if (selection.kind === "node") return "选中页面";
  return `手动选区 · ${count} 页`;
}

function graphReaderNode(node: GraphNode): GraphReaderNodeMeta {
  const sourcePath = wikiPathForGraphNode(node);
  return {
    type: node.type,
    typeLabel: graphNodeTypeLabel(node.type),
    sourcePath,
    date: dateForNode(node),
    source: sourceForNode(node)
  };
}

function dateForNode(node: GraphNode): string | null {
  const value = node.date || node.updated_at || node.updatedAt || node.created_at || node.createdAt;
  return value == null || value === "" ? null : String(value);
}

function sourceForNode(node: GraphNode): string | null {
  const value = node.source_title || node.source_url || node.url || node.author || node.source_name;
  return value == null || value === "" ? null : String(value);
}

function graphReaderMetaItems(node: GraphReaderNodeMeta): string[] {
  const items = [node.typeLabel];
  if (node.date) items.push(node.date);
  if (node.source) items.push(node.source);
  return items;
}

function renderMarkdown(markdown: string): string | null {
  const runtime = globalThis as unknown as {
    marked?: { parse?: (input: string, options?: Record<string, unknown>) => string };
    DOMPurify?: { sanitize?: (input: string, options?: Record<string, unknown>) => string };
  };
  if (typeof runtime.marked?.parse !== "function" || typeof runtime.DOMPurify?.sanitize !== "function") return null;
  const html = runtime.marked.parse(markdown, { breaks: false, gfm: true });
  return runtime.DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-target", "tabindex"] });
}

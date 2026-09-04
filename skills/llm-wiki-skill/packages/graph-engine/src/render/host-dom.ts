export function createGraphRootElement(container: HTMLElement): HTMLElement {
  const ownerDocument = container.ownerDocument || document;
  const root = ownerDocument.createElement("div");
  root.className = "llm-wiki-graph-engine";
  root.dataset.llmWikiGraphRoot = "true";
  root.tabIndex = 0;
  container.replaceChildren(root);
  return root;
}

export function resetGraphRootScroll(root: HTMLElement): void {
  if (root.scrollLeft !== 0) root.scrollLeft = 0;
  if (root.scrollTop !== 0) root.scrollTop = 0;
}

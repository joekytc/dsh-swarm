import type { RenderableAggregationContainer } from "./model";

export interface GraphAggregationContainerElementHandlers {
  onAggregationContainerClick: (container: RenderableAggregationContainer) => void;
}

export function createGraphAggregationContainerElement(
  ownerDocument: Document,
  container: RenderableAggregationContainer,
  handlers: GraphAggregationContainerElementHandlers
): HTMLButtonElement {
  const button = ownerDocument.createElement("button");
  button.type = "button";
  button.className = "aggregation-container";
  button.dataset.aggregationId = container.id;
  button.dataset.communityId = container.communityId ?? "";
  button.dataset.role = container.role;
  button.dataset.nodeCount = String(container.nodeCount);
  button.dataset.searchHitCount = String(container.searchHitCount);
  button.dataset.pinnedCount = String(container.pinnedCount);
  button.dataset.selectedCount = String(container.selectedCount);
  button.dataset.selected = container.selected ? "true" : "false";
  button.dataset.searchInside = container.searchHitCount > 0 ? "true" : "false";
  button.dataset.pinnedInside = container.pinnedCount > 0 ? "true" : "false";
  button.dataset.worldX = String(container.point.x);
  button.dataset.worldY = String(container.point.y);
  button.style.left = `${container.x}%`;
  button.style.top = `${container.y}%`;
  button.style.setProperty("--aggregation-color", container.color);
  button.style.setProperty("--aggregation-radius", `${container.radius}px`);
  button.title = container.label;
  button.setAttribute("aria-pressed", container.selected ? "true" : "false");
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handlers.onAggregationContainerClick(container);
  });

  const count = ownerDocument.createElement("span");
  count.className = "aggregation-container-count";
  count.textContent = String(container.nodeCount);
  button.appendChild(count);

  const label = ownerDocument.createElement("span");
  label.className = "aggregation-container-label";
  label.textContent = container.label;
  button.appendChild(label);

  const markers = ownerDocument.createElement("span");
  markers.className = "aggregation-container-markers";
  appendMarker(ownerDocument, markers, "命中", container.searchHitCount);
  appendMarker(ownerDocument, markers, "固定", container.pinnedCount);
  appendMarker(ownerDocument, markers, "选中", container.selectedCount);
  button.appendChild(markers);

  return button;
}

function appendMarker(ownerDocument: Document, parent: HTMLElement, label: string, count: number): void {
  if (count <= 0) return;
  const marker = ownerDocument.createElement("span");
  marker.className = "aggregation-container-marker";
  marker.textContent = `${label} ${count}`;
  parent.appendChild(marker);
}

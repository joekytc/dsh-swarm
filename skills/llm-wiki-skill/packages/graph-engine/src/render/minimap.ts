import type { RenderableMinimap } from "./model";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface GraphMinimapDom {
  element: HTMLElement;
  nodeElements: Map<string, SVGCircleElement>;
  viewportElement: SVGRectElement;
}

export function createGraphMinimap(ownerDocument: Document, minimap: RenderableMinimap): GraphMinimapDom {
  const element = ownerDocument.createElement("div");
  element.className = "mini-map";
  const miniSvg = ownerDocument.createElementNS(SVG_NS, "svg");
  miniSvg.setAttribute("viewBox", "0 0 160 54");
  miniSvg.setAttribute("aria-hidden", "true");
  const miniPath = ownerDocument.createElementNS(SVG_NS, "path");
  miniPath.setAttribute("d", minimap.path);
  miniPath.setAttribute("fill", "none");
  miniPath.setAttribute("stroke", "var(--line)");
  miniPath.setAttribute("stroke-width", "1.4");
  miniSvg.appendChild(miniPath);
  const viewportElement = ownerDocument.createElementNS(SVG_NS, "rect");
  viewportElement.setAttribute("class", "mini-map-viewport");
  viewportElement.setAttribute("data-mini-map-viewport", "true");
  viewportElement.setAttribute("x", "0");
  viewportElement.setAttribute("y", "0");
  viewportElement.setAttribute("width", "160");
  viewportElement.setAttribute("height", "54");
  miniSvg.appendChild(viewportElement);

  const nodeElements = new Map<string, SVGCircleElement>();
  for (const miniNode of minimap.nodes) {
    const circle = ownerDocument.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(miniNode.x));
    circle.setAttribute("cy", String(miniNode.y));
    circle.setAttribute("r", String(miniNode.r));
    circle.setAttribute("fill", miniNode.fill);
    if (miniNode.selected) circle.classList.add("is-selected");
    miniSvg.appendChild(circle);
    nodeElements.set(miniNode.id, circle);
  }
  element.appendChild(miniSvg);
  return { element, nodeElements, viewportElement };
}

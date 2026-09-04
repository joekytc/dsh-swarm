import type { RenderableCommunity } from "./model";

const SVG_NS = "http://www.w3.org/2000/svg";

export function createCommunityWashElement(ownerDocument: Document, community: RenderableCommunity): SVGEllipseElement | null {
  if (!community.wash) return null;
  const ellipse = ownerDocument.createElementNS(SVG_NS, "ellipse");
  ellipse.setAttribute("class", "community-wash");
  ellipse.setAttribute("cx", String(community.wash.cx));
  ellipse.setAttribute("cy", String(community.wash.cy));
  ellipse.setAttribute("rx", String(community.wash.rx));
  ellipse.setAttribute("ry", String(community.wash.ry));
  ellipse.setAttribute("fill", community.color);
  ellipse.setAttribute("opacity", String(community.wash.opacity));
  ellipse.dataset.communityId = community.id;
  ellipse.dataset.boundaryCertainty = community.boundaryCertainty;
  ellipse.style.cursor = "pointer";
  return ellipse;
}

export interface GraphEdgeGeometryPoint {
  x: number;
  y: number;
}

const GRAPH_EDGE_CONTROL_Y_OFFSET = 22;

export function graphEdgeControlPoint(
  source: GraphEdgeGeometryPoint,
  target: GraphEdgeGeometryPoint,
  curveOffset: number
): GraphEdgeGeometryPoint {
  return {
    x: (source.x + target.x) / 2 + curveOffset,
    y: (source.y + target.y) / 2 - GRAPH_EDGE_CONTROL_Y_OFFSET
  };
}

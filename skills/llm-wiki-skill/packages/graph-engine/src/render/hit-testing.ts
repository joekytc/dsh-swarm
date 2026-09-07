import { createGraphSpatialIndex, type GraphSpatialIndex, type GraphSpatialIndexInput } from "../layout";
import { screenPointToWorldPoint, type GraphScreenPoint } from "./geometry";
import { graphSpatialHitToGestureTarget, type GraphGestureTarget } from "./gestures";
import type { RenderableGraph } from "./model";
import type { RendererViewport, RendererViewportSize } from "./viewport";

export interface GraphHitTargetResolverInput {
  graph(): RenderableGraph;
  viewport(): RendererViewport;
  viewportSize(): RendererViewportSize;
}

export interface GraphHitTargetResolver {
  targetFromScreenPoint(screenPoint: GraphScreenPoint): GraphGestureTarget;
  index(): GraphSpatialIndex;
  refresh(): GraphSpatialIndex;
}

export function createGraphHitTargetResolver(input: GraphHitTargetResolverInput): GraphHitTargetResolver {
  let cachedGraph: RenderableGraph | null = null;
  let cachedIndex: GraphSpatialIndex | null = null;

  function index(): GraphSpatialIndex {
    const graph = input.graph();
    if (cachedGraph !== graph || !cachedIndex) {
      return rebuild(graph);
    }
    return cachedIndex;
  }

  function rebuild(graph = input.graph()): GraphSpatialIndex {
    const nextIndex = createGraphSpatialIndex(spatialInputFromRenderableGraph(graph));
    cachedGraph = graph;
    cachedIndex = nextIndex;
    return nextIndex;
  }

  return {
    targetFromScreenPoint(screenPoint) {
      const graph = input.graph();
      const worldPoint = screenPointToWorldPoint(screenPoint, input.viewport(), input.viewportSize(), graph.worldBounds);
      return graphSpatialHitToGestureTarget(index().hitTest(worldPoint));
    },
    index,
    refresh: rebuild
  };
}

function spatialInputFromRenderableGraph(graph: RenderableGraph): GraphSpatialIndexInput {
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    communities: graph.communities,
    aggregationContainers: graph.aggregationContainers
  };
}

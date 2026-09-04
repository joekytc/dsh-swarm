export type GraphArchitectureLayerId =
  | "data"
  | "layout"
  | "viewport"
  | "controller"
  | "renderer"
  | "gestures"
  | "facade";

export interface GraphArchitectureLayer {
  id: GraphArchitectureLayerId;
  name: string;
  owns: readonly string[];
  entrypoints: readonly string[];
  mustNotOwn: readonly string[];
}

export const GRAPH_ARCHITECTURE_LAYERS = [
  {
    id: "data",
    name: "GraphData",
    owns: ["graph schema", "node and edge facts", "selection data inputs"],
    entrypoints: ["src/types.ts", "src/model/", "src/graph-node.ts", "src/select/"],
    mustNotOwn: ["DOM", "screen projection", "host callbacks", "pointer or wheel events"]
  },
  {
    id: "layout",
    name: "GraphLayout",
    owns: ["world positions", "layout bounds", "community wash geometry", "spatial hit testing"],
    entrypoints: ["src/layout/", "src/render/model.ts", "src/render/community-wash.ts", "src/sim/"],
    mustNotOwn: ["host callbacks", "browser default policy", "screen projection"]
  },
  {
    id: "viewport",
    name: "GraphViewport",
    owns: ["camera", "world/screen projection", "fit, pan, zoom, minimap projection", "resize anchoring"],
    entrypoints: ["src/render/viewport.ts", "src/render/geometry.ts"],
    mustNotOwn: ["graph data mutation", "DOM event classification", "host callbacks"]
  },
  {
    id: "controller",
    name: "GraphController",
    owns: ["semantic graph commands", "keyboard routing", "node drag coordination"],
    entrypoints: ["src/render/controller.ts"],
    mustNotOwn: ["host callbacks", "graph drawing", "render-model computation"]
  },
  {
    id: "renderer",
    name: "GraphRenderer",
    owns: ["DOM/SVG drawing", "node, edge, wash, toolbar, overlay, reader painting", "render-only CSS state"],
    entrypoints: [
      "src/render/graph-renderer-root.ts",
      "src/render/render-pipeline.ts",
      "src/render/overlays-presenter.ts",
      "src/render/nodes.ts",
      "src/render/edges.ts",
      "src/render/community-washes.ts",
      "src/render/minimap.ts",
      "src/render/controls.ts",
      "src/render/hover-card.ts",
      "src/render/offline-reader.ts"
    ],
    mustNotOwn: ["host callbacks", "selection semantics", "browser default policy"]
  },
  {
    id: "gestures",
    name: "GraphGestures",
    owns: ["raw wheel, pointer, and keyboard ownership", "gesture blockers", "graph-owned intent classification"],
    entrypoints: ["src/render/gestures.ts"],
    mustNotOwn: ["host callbacks", "graph drawing", "data persistence"]
  },
  {
    id: "facade",
    name: "GraphFacade",
    owns: ["public graph engine API", "host capability callbacks", "selection resolution", "renderer lifecycle"],
    entrypoints: ["src/facade.ts", "src/index.ts"],
    mustNotOwn: ["raw DOM event policy", "node layout physics", "drawing internals"]
  }
] as const satisfies readonly GraphArchitectureLayer[];

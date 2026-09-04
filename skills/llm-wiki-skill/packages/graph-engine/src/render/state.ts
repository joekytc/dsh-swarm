import type { CommunityId, NodeId, PinMap, SelectionInput } from "../types";
import type { RenderPositionMap } from "./model";
import { DEFAULT_RENDERER_VIEWPORT, normalizeRendererViewport, type RendererViewport } from "./viewport";

export type GraphRuntimeHoverTarget =
  | { kind: "node"; id: NodeId }
  | { kind: "edge"; id: string }
  | { kind: "community"; id: CommunityId }
  | null;

export type GraphRuntimeFocusTarget =
  | { kind: "community"; id: CommunityId }
  | null;

export type GraphRuntimeSelectionSurface =
  | "reader"
  | "selection-panel"
  | null;

export type GraphRuntimeGestureState =
  | {
      kind: "node-drag";
      pointerId: number;
      nodeId: NodeId;
      grabOffset: { x: number; y: number };
      startWorldPoint: { x: number; y: number };
      wasPinned: boolean;
      locked: boolean;
    }
  | {
      kind: "viewport-pan";
      pointerId: number;
      lastScreenPoint: { x: number; y: number };
      locked: boolean;
    }
  | {
      kind: "community-click";
      pointerId: number;
      communityId: CommunityId;
      locked: boolean;
    }
  | null;

export interface GraphRuntimeStateSnapshot {
  viewport: RendererViewport;
  positions: RenderPositionMap;
  pins: PinMap;
  hover: GraphRuntimeHoverTarget;
  selection: SelectionInput | null;
  selectionSurface: GraphRuntimeSelectionSurface;
  focus: GraphRuntimeFocusTarget;
  activeGesture: GraphRuntimeGestureState;
}

export interface GraphRuntimeStateOptions {
  viewport?: Partial<RendererViewport> | null;
  positions?: RenderPositionMap;
  pins?: PinMap;
  hover?: GraphRuntimeHoverTarget;
  selection?: SelectionInput | null;
  selectionSurface?: GraphRuntimeSelectionSurface;
  focus?: GraphRuntimeFocusTarget;
  activeGesture?: GraphRuntimeGestureState;
}

export type GraphRuntimeStateListener = (snapshot: GraphRuntimeStateSnapshot) => void;

export class GraphRuntimeState {
  private snapshotValue: GraphRuntimeStateSnapshot;
  private readonly listeners = new Set<GraphRuntimeStateListener>();

  constructor(options: GraphRuntimeStateOptions = {}) {
    this.snapshotValue = normalizeSnapshot(options);
  }

  snapshot(): GraphRuntimeStateSnapshot {
    return cloneSnapshot(this.snapshotValue);
  }

  subscribe(listener: GraphRuntimeStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setViewport(viewport: Partial<RendererViewport> | null | undefined): GraphRuntimeStateSnapshot {
    return this.update({ viewport: normalizeRendererViewport(viewport) });
  }

  setPositions(positions: RenderPositionMap): GraphRuntimeStateSnapshot {
    return this.update({ positions: clonePositions(positions) });
  }

  commitPosition(nodeId: NodeId, position: { x: number; y: number }): GraphRuntimeStateSnapshot {
    return this.update({
      positions: {
        ...this.snapshotValue.positions,
        [nodeId]: { x: finiteNumber(position.x, 0), y: finiteNumber(position.y, 0) }
      }
    });
  }

  setPins(pins: PinMap): GraphRuntimeStateSnapshot {
    return this.update({ pins: clonePins(pins) });
  }

  setHover(hover: GraphRuntimeHoverTarget): GraphRuntimeStateSnapshot {
    return this.update({ hover: cloneHoverTarget(hover) });
  }

  setSelection(selection: SelectionInput | null, selectionSurface?: GraphRuntimeSelectionSurface): GraphRuntimeStateSnapshot {
    const nextSelection = cloneSelection(selection);
    return this.update({
      selection: nextSelection,
      selectionSurface: normalizeSelectionSurface(nextSelection, selectionSurface)
    });
  }

  setFocus(focus: GraphRuntimeFocusTarget): GraphRuntimeStateSnapshot {
    return this.update({ focus: cloneFocusTarget(focus) });
  }

  setActiveGesture(activeGesture: GraphRuntimeGestureState): GraphRuntimeStateSnapshot {
    return this.update({ activeGesture: cloneGestureState(activeGesture) });
  }

  clearInteraction(): GraphRuntimeStateSnapshot {
    return this.update({
      hover: null,
      selection: null,
      selectionSurface: null,
      focus: null,
      activeGesture: null
    });
  }

  private update(next: Partial<GraphRuntimeStateSnapshot>): GraphRuntimeStateSnapshot {
    this.snapshotValue = {
      ...this.snapshotValue,
      ...next
    };
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }
}

export function createGraphRuntimeState(options: GraphRuntimeStateOptions = {}): GraphRuntimeState {
  return new GraphRuntimeState(options);
}

function normalizeSnapshot(options: GraphRuntimeStateOptions): GraphRuntimeStateSnapshot {
  return {
    viewport: normalizeRendererViewport(options.viewport || DEFAULT_RENDERER_VIEWPORT),
    positions: clonePositions(options.positions || {}),
    pins: clonePins(options.pins || {}),
    hover: cloneHoverTarget(options.hover ?? null),
    selection: cloneSelection(options.selection ?? null),
    selectionSurface: normalizeSelectionSurface(options.selection ?? null, options.selectionSurface),
    focus: cloneFocusTarget(options.focus ?? null),
    activeGesture: cloneGestureState(options.activeGesture ?? null)
  };
}

function cloneSnapshot(snapshot: GraphRuntimeStateSnapshot): GraphRuntimeStateSnapshot {
  return {
    viewport: { ...snapshot.viewport },
    positions: clonePositions(snapshot.positions),
    pins: clonePins(snapshot.pins),
    hover: cloneHoverTarget(snapshot.hover),
    selection: cloneSelection(snapshot.selection),
    selectionSurface: snapshot.selectionSurface,
    focus: cloneFocusTarget(snapshot.focus),
    activeGesture: cloneGestureState(snapshot.activeGesture)
  };
}

function clonePositions(positions: RenderPositionMap): RenderPositionMap {
  return Object.fromEntries(Object.entries(positions).map(([id, position]) => [
    id,
    {
      x: finiteNumber(position.x, 0),
      y: finiteNumber(position.y, 0)
    }
  ]));
}

function clonePins(pins: PinMap): PinMap {
  return Object.fromEntries(Object.entries(pins).map(([key, position]) => [
    key,
    {
      x: finiteNumber(position.x, 0),
      y: finiteNumber(position.y, 0),
      ...(position.coordinateSpace ? { coordinateSpace: position.coordinateSpace } : {})
    }
  ]));
}

function cloneHoverTarget(hover: GraphRuntimeHoverTarget): GraphRuntimeHoverTarget {
  return hover ? { ...hover } : null;
}

function cloneFocusTarget(focus: GraphRuntimeFocusTarget): GraphRuntimeFocusTarget {
  return focus ? { ...focus } : null;
}

function cloneSelection(selection: SelectionInput | null): SelectionInput | null {
  if (!selection) return null;
  if (selection.kind === "nodes") return { kind: "nodes", ids: [...selection.ids] };
  return { ...selection };
}

function cloneGestureState(activeGesture: GraphRuntimeGestureState): GraphRuntimeGestureState {
  if (!activeGesture) return null;
  if (activeGesture.kind === "node-drag") {
    return {
      kind: "node-drag",
      pointerId: finiteNumber(activeGesture.pointerId, 0),
      nodeId: activeGesture.nodeId,
      grabOffset: {
        x: finiteNumber(activeGesture.grabOffset.x, 0),
        y: finiteNumber(activeGesture.grabOffset.y, 0)
      },
      startWorldPoint: {
        x: finiteNumber(activeGesture.startWorldPoint.x, 0),
        y: finiteNumber(activeGesture.startWorldPoint.y, 0)
      },
      wasPinned: Boolean(activeGesture.wasPinned),
      locked: Boolean(activeGesture.locked)
    };
  }
  if (activeGesture.kind === "viewport-pan") {
    return {
      kind: "viewport-pan",
      pointerId: finiteNumber(activeGesture.pointerId, 0),
      lastScreenPoint: {
        x: finiteNumber(activeGesture.lastScreenPoint.x, 0),
        y: finiteNumber(activeGesture.lastScreenPoint.y, 0)
      },
      locked: Boolean(activeGesture.locked)
    };
  }
  return {
    kind: "community-click",
    pointerId: finiteNumber(activeGesture.pointerId, 0),
    communityId: activeGesture.communityId,
    locked: Boolean(activeGesture.locked)
  };
}

function normalizeSelectionSurface(
  selection: SelectionInput | null,
  selectionSurface: GraphRuntimeSelectionSurface | undefined
): GraphRuntimeSelectionSurface {
  if (!selection) return null;
  return selectionSurface ?? "selection-panel";
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

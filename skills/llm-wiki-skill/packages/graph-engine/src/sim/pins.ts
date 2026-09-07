import type { NodeId, PinMap, PinPosition, WikiPath } from "../types";
import type { RenderPositionMap, RenderableGraph } from "../render";
import { normalizeStoredPinPosition, normalizeWorldPinPosition, pinPositionToWorldPoint } from "../render/pin-position";

export interface PinStateSnapshot {
  pins: PinMap;
  pinnedNodeIds: NodeId[];
}

export class PinState {
  private readonly nodePathById = new Map<NodeId, WikiPath>();
  private readonly nodeIdByPath = new Map<WikiPath, NodeId>();
  private pins: PinMap;

  constructor(graph: RenderableGraph, pins: PinMap = {}) {
    for (const node of graph.nodes) {
      const key = pinKeyForNode(node);
      this.nodePathById.set(node.id, key);
      this.nodeIdByPath.set(key, node.id);
    }
    this.pins = normalizePinMap(pins, this.nodeIdByPath);
  }

  isPinned(id: NodeId): boolean {
    const key = this.nodePathById.get(id);
    return Boolean(key && this.pins[key]);
  }

  pin(id: NodeId, position: PinPosition): PinStateSnapshot {
    const key = this.nodePathById.get(id);
    if (!key) throw new Error(`Cannot pin unknown graph node: ${id}`);
    this.pins = {
      ...this.pins,
      [key]: normalizeWorldPinPosition(position)
    };
    return this.snapshot();
  }

  unpin(id: NodeId): PinStateSnapshot {
    const key = this.nodePathById.get(id);
    if (!key || !this.pins[key]) return this.snapshot();
    const next = { ...this.pins };
    delete next[key];
    this.pins = next;
    return this.snapshot();
  }

  reset(): PinStateSnapshot {
    this.pins = {};
    return this.snapshot();
  }

  snapshot(): PinStateSnapshot {
    return {
      pins: { ...this.pins },
      pinnedNodeIds: Object.keys(this.pins)
        .map((key) => this.nodeIdByPath.get(key))
        .filter((id): id is NodeId => Boolean(id))
    };
  }
}

export function pinsToPositions(graph: RenderableGraph, pins: PinMap): RenderPositionMap {
  const positions: RenderPositionMap = {};
  for (const node of graph.nodes) {
    const key = pinKeyForNode(node);
    const pin = pins[key];
    if (pin) positions[node.id] = pinPositionToWorldPoint(pin);
  }
  return positions;
}

function normalizePinMap(pins: PinMap, knownPaths: Map<WikiPath, NodeId>): PinMap {
  const normalized: PinMap = {};
  for (const [key, value] of Object.entries(pins)) {
    if (!knownPaths.has(key)) continue;
    normalized[key] = normalizeStoredPinPosition(value);
  }
  return normalized;
}

function pinKeyForNode(node: { sourcePath?: string; id: string }): WikiPath {
  return node.sourcePath || node.id;
}

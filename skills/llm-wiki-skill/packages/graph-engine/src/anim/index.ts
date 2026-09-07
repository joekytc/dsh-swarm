import type { CommunityId, EdgeId, GraphDiff, NodeId } from "../types";

export type DiffQueueVisibility = "visible" | "hidden";
export type DiffQueueDragState = "idle" | "dragging";
export type DiffQueueReason = "visible" | "hidden" | "dragging";

export interface DiffQueueSnapshot {
  pending: GraphDiff | null;
  isAnimating: boolean;
  visibility: DiffQueueVisibility;
  dragState: DiffQueueDragState;
}

export interface DiffQueueDecision {
  action: "consume" | "queue";
  diff: GraphDiff | null;
  reason: DiffQueueReason;
  snapshot: DiffQueueSnapshot;
}

export class GraphDiffQueue {
  private pending: GraphDiff | null = null;
  private visibility: DiffQueueVisibility;
  private dragState: DiffQueueDragState = "idle";
  private isAnimating = false;

  constructor(options: { visible?: boolean } = {}) {
    this.visibility = options.visible === false ? "hidden" : "visible";
  }

  get snapshot(): DiffQueueSnapshot {
    return {
      pending: this.pending,
      isAnimating: this.isAnimating,
      visibility: this.visibility,
      dragState: this.dragState
    };
  }

  push(diff: GraphDiff | null): DiffQueueDecision {
    if (!diff || isEmptyDiff(diff)) return this.decision("queue", null, this.blockedReason());
    if (this.canConsume()) {
      this.isAnimating = true;
      return this.decision("consume", diff, "visible");
    }
    this.pending = mergeGraphDiffs(this.pending, diff);
    return this.decision("queue", this.pending, this.blockedReason());
  }

  setVisible(visible: boolean): DiffQueueDecision {
    this.visibility = visible ? "visible" : "hidden";
    return this.flushIfReady(visible ? "visible" : "hidden");
  }

  setDragging(dragging: boolean): DiffQueueDecision {
    this.dragState = dragging ? "dragging" : "idle";
    return this.flushIfReady(dragging ? "dragging" : "visible");
  }

  finishAnimation(): DiffQueueDecision {
    this.isAnimating = false;
    return this.flushIfReady("visible");
  }

  clear(): void {
    this.pending = null;
    this.isAnimating = false;
  }

  private flushIfReady(fallbackReason: DiffQueueReason): DiffQueueDecision {
    if (!this.pending || !this.canConsume()) {
      return this.decision("queue", this.pending, this.blockedReason(fallbackReason));
    }
    const diff = this.pending;
    this.pending = null;
    this.isAnimating = true;
    return this.decision("consume", diff, "visible");
  }

  private canConsume(): boolean {
    return this.visibility === "visible" && this.dragState === "idle" && !this.isAnimating;
  }

  private blockedReason(fallback: DiffQueueReason = "visible"): DiffQueueReason {
    if (this.visibility === "hidden") return "hidden";
    if (this.dragState === "dragging") return "dragging";
    return fallback;
  }

  private decision(action: DiffQueueDecision["action"], diff: GraphDiff | null, reason: DiffQueueReason): DiffQueueDecision {
    return {
      action,
      diff,
      reason,
      snapshot: this.snapshot
    };
  }
}

export function mergeGraphDiffs(previous: GraphDiff | null, next: GraphDiff): GraphDiff {
  if (!previous) return cloneDiff(next);

  const addedNodes = new Set(previous.addedNodes);
  const removedNodes = new Set(previous.removedNodes);
  for (const id of next.addedNodes) {
    if (removedNodes.has(id)) removedNodes.delete(id);
    else addedNodes.add(id);
  }
  for (const id of next.removedNodes) {
    if (addedNodes.has(id)) addedNodes.delete(id);
    else removedNodes.add(id);
  }

  const addedEdges = new Set(previous.addedEdges);
  const removedEdges = new Set(previous.removedEdges);
  for (const id of next.addedEdges) {
    if (removedEdges.has(id)) removedEdges.delete(id);
    else addedEdges.add(id);
  }
  for (const id of next.removedEdges) {
    if (addedEdges.has(id)) addedEdges.delete(id);
    else removedEdges.add(id);
  }

  return {
    addedNodes: orderedSet(addedNodes),
    removedNodes: orderedSet(removedNodes),
    recoloredNodes: mergeRecolors(previous.recoloredNodes, next.recoloredNodes, addedNodes, removedNodes),
    addedEdges: orderedSet(addedEdges),
    removedEdges: orderedSet(removedEdges),
    newCommunities: orderedSet(new Set([...previous.newCommunities, ...next.newCommunities])),
    stats: next.stats
  };
}

export function isEmptyDiff(diff: GraphDiff): boolean {
  return diff.addedNodes.length === 0
    && diff.removedNodes.length === 0
    && diff.recoloredNodes.length === 0
    && diff.addedEdges.length === 0
    && diff.removedEdges.length === 0
    && diff.newCommunities.length === 0;
}

function mergeRecolors(
  previous: GraphDiff["recoloredNodes"],
  next: GraphDiff["recoloredNodes"],
  addedNodes: Set<NodeId>,
  removedNodes: Set<NodeId>
): GraphDiff["recoloredNodes"] {
  const byId = new Map<NodeId, { id: NodeId; from: CommunityId; to: CommunityId }>();
  for (const item of previous) byId.set(item.id, { ...item });
  for (const item of next) {
    const existing = byId.get(item.id);
    byId.set(item.id, {
      id: item.id,
      from: existing?.from ?? item.from,
      to: item.to
    });
  }
  for (const id of [...addedNodes, ...removedNodes]) byId.delete(id);
  return Array.from(byId.values()).filter((item) => item.from !== item.to);
}

function cloneDiff(diff: GraphDiff): GraphDiff {
  return {
    addedNodes: [...diff.addedNodes],
    removedNodes: [...diff.removedNodes],
    recoloredNodes: diff.recoloredNodes.map((item) => ({ ...item })),
    addedEdges: [...diff.addedEdges],
    removedEdges: [...diff.removedEdges],
    newCommunities: [...diff.newCommunities],
    stats: { ...diff.stats }
  };
}

function orderedSet<T extends NodeId | EdgeId | CommunityId>(set: Set<T>): T[] {
  return Array.from(set);
}

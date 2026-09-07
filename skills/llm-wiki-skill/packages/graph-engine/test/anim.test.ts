import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GraphDiffQueue, mergeGraphDiffs } from "../src/anim";
import type { GraphDiff } from "../src/types";

describe("GraphDiffQueue", () => {
  it("consumes immediately when graph is visible", () => {
    const queue = new GraphDiffQueue({ visible: true });
    const decision = queue.push(diff({ addedNodes: ["n1"] }));

    assert.equal(decision.action, "consume");
    assert.deepEqual(decision.diff?.addedNodes, ["n1"]);
    assert.equal(decision.snapshot.isAnimating, true);

    const done = queue.finishAnimation();
    assert.equal(done.action, "queue");
    assert.equal(done.snapshot.isAnimating, false);
  });

  it("queues while hidden and consumes the net diff when shown", () => {
    const queue = new GraphDiffQueue({ visible: false });

    const queued = queue.push(diff({ addedNodes: ["n1"], addedEdges: ["e1"] }));
    assert.equal(queued.action, "queue");
    assert.deepEqual(queued.snapshot.pending?.addedNodes, ["n1"]);

    const shown = queue.setVisible(true);
    assert.equal(shown.action, "consume");
    assert.deepEqual(shown.diff?.addedNodes, ["n1"]);
    assert.deepEqual(shown.diff?.addedEdges, ["e1"]);
    assert.equal(shown.snapshot.pending, null);
  });

  it("holds diffs during drag and consumes after release", () => {
    const queue = new GraphDiffQueue({ visible: true });

    queue.setDragging(true);
    const queued = queue.push(diff({ addedNodes: ["n1"] }));
    assert.equal(queued.action, "queue");
    assert.equal(queued.reason, "dragging");

    const released = queue.setDragging(false);
    assert.equal(released.action, "consume");
    assert.deepEqual(released.diff?.addedNodes, ["n1"]);
  });

  it("does not replay a refresh diff until both drag and animation are idle", () => {
    const queue = new GraphDiffQueue({ visible: true });

    const first = queue.push(diff({ addedNodes: ["already-playing"] }));
    assert.equal(first.action, "consume");
    assert.equal(first.snapshot.isAnimating, true);

    queue.setDragging(true);
    const queued = queue.push(diff({ addedNodes: ["fresh"] }));
    assert.equal(queued.action, "queue");
    assert.equal(queued.reason, "dragging");

    const released = queue.setDragging(false);
    assert.equal(released.action, "queue");
    assert.equal(released.snapshot.pending?.addedNodes.includes("fresh"), true);

    const finished = queue.finishAnimation();
    assert.equal(finished.action, "consume");
    assert.deepEqual(finished.diff?.addedNodes, ["fresh"]);
  });

  it("folds multiple pending diffs into one net replay", () => {
    const queue = new GraphDiffQueue({ visible: false });

    queue.push(diff({
      addedNodes: ["create-then-delete", "stay-new"],
      addedEdges: ["edge-create-then-delete"],
      recoloredNodes: [{ id: "color", from: "old", to: "mid" }],
      stats: { nodeCount: 3, edgeCount: 1, communityCount: 2 }
    }));
    queue.push(diff({
      removedNodes: ["create-then-delete"],
      removedEdges: ["edge-create-then-delete"],
      recoloredNodes: [{ id: "color", from: "mid", to: "new" }],
      newCommunities: ["fresh"],
      stats: { nodeCount: 2, edgeCount: 0, communityCount: 3 }
    }));

    const shown = queue.setVisible(true);

    assert.equal(shown.action, "consume");
    assert.deepEqual(shown.diff, diff({
      addedNodes: ["stay-new"],
      recoloredNodes: [{ id: "color", from: "old", to: "new" }],
      newCommunities: ["fresh"],
      stats: { nodeCount: 2, edgeCount: 0, communityCount: 3 }
    }));
  });
});

describe("mergeGraphDiffs", () => {
  it("cancels add-then-remove nodes and keeps latest stats", () => {
    const merged = mergeGraphDiffs(
      diff({ addedNodes: ["a", "b"], stats: { nodeCount: 2, edgeCount: 0, communityCount: 1 } }),
      diff({ removedNodes: ["a"], stats: { nodeCount: 1, edgeCount: 0, communityCount: 1 } })
    );

    assert.deepEqual(merged.addedNodes, ["b"]);
    assert.deepEqual(merged.removedNodes, []);
    assert.equal(merged.stats.nodeCount, 1);
  });
});

function diff(partial: Partial<GraphDiff> = {}): GraphDiff {
  return {
    addedNodes: partial.addedNodes ?? [],
    removedNodes: partial.removedNodes ?? [],
    recoloredNodes: partial.recoloredNodes ?? [],
    addedEdges: partial.addedEdges ?? [],
    removedEdges: partial.removedEdges ?? [],
    newCommunities: partial.newCommunities ?? [],
    stats: partial.stats ?? { nodeCount: 0, edgeCount: 0, communityCount: 0 }
  };
}

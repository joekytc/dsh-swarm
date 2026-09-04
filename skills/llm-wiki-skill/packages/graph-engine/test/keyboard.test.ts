import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyGraphKeyboardIntent, type GraphKeyboardIntentInput } from "../src/render/keyboard";

describe("graph keyboard ownership", () => {
  it("opens graph search only when the graph owns focus", () => {
    assert.equal(intent({ key: "f", metaKey: true, graphFocused: true }), "open-search");
    assert.equal(intent({ key: "f", ctrlKey: true, graphFocused: true }), "open-search");
    assert.equal(intent({ key: "f", metaKey: true, graphFocused: false }), "blocked");
  });

  it("does not steal browser find from text editing targets", () => {
    assert.equal(intent({
      key: "f",
      metaKey: true,
      graphFocused: true,
      textEditingTarget: true
    }), "blocked");
  });

  it("routes Escape to the graph state only inside graph focus", () => {
    assert.equal(intent({ key: "Escape", graphFocused: true, searchActive: true }), "close-search");
    assert.equal(intent({ key: "Escape", graphFocused: true, toolbarOpen: true }), "close-toolbar");
    assert.equal(intent({ key: "Escape", graphFocused: true, interactionActive: true }), "clear-interaction");
    assert.equal(intent({ key: "Escape", graphFocused: false, searchActive: true }), "blocked");
    assert.equal(intent({ key: "Escape", graphFocused: false, toolbarOpen: true }), "blocked");
    assert.equal(intent({ key: "Escape", graphFocused: false, interactionActive: true }), "blocked");
  });

  it("lets active gestures own Escape even if focus moved outside the graph", () => {
    assert.equal(intent({ key: "Escape", graphFocused: false, activeGesture: true }), "cancel-active-gesture");
    assert.equal(intent({
      key: "Escape",
      graphFocused: true,
      activeGesture: true,
      searchActive: true
    }), "close-search");
  });

  it("blocks unrelated keys", () => {
    assert.equal(intent({ key: "a", graphFocused: true }), "blocked");
    assert.equal(intent({ key: "Enter", graphFocused: true, interactionActive: true }), "blocked");
  });
});

function intent(input: Partial<GraphKeyboardIntentInput>) {
  return classifyGraphKeyboardIntent({
    key: input.key || "",
    ctrlKey: input.ctrlKey === true,
    metaKey: input.metaKey === true,
    graphFocused: input.graphFocused === true,
    activeGesture: input.activeGesture === true,
    textEditingTarget: input.textEditingTarget === true,
    searchActive: input.searchActive === true,
    toolbarOpen: input.toolbarOpen === true,
    interactionActive: input.interactionActive === true
  });
}

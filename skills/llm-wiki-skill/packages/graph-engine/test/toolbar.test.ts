import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GRAPH_TOOLBAR_PANEL_KEY,
  nextToolbarPanelState,
  readToolbarPanelState,
  shouldBlankClickCloseToolbar,
  toolbarPanelStateAfterBlankClick,
  writeToolbarPanelState
} from "../src/render/toolbar";

describe("graph toolbar state", () => {
  it("defaults to a closed toolbar panel", () => {
    assert.equal(readToolbarPanelState(memoryStorage()), "closed");
  });

  it("persists open and closed panel state", () => {
    const storage = memoryStorage();

    writeToolbarPanelState(storage, "filters");
    assert.equal(storage.getItem(GRAPH_TOOLBAR_PANEL_KEY), "filters");
    assert.equal(readToolbarPanelState(storage), "filters");

    writeToolbarPanelState(storage, "closed");
    assert.equal(readToolbarPanelState(storage), "closed");
  });

  it("toggles the same panel closed and switches to another panel", () => {
    assert.equal(nextToolbarPanelState("closed", "filters"), "filters");
    assert.equal(nextToolbarPanelState("filters", "filters"), "closed");
    assert.equal(nextToolbarPanelState("filters", "legend"), "legend");
  });

  it("lets blank canvas clicks close an open popover before graph gestures run", () => {
    assert.equal(shouldBlankClickCloseToolbar("filters"), true);
    assert.equal(toolbarPanelStateAfterBlankClick("filters"), "closed");
    assert.equal(shouldBlankClickCloseToolbar("closed"), false);
    assert.equal(toolbarPanelStateAfterBlankClick("closed"), "closed");
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };
}

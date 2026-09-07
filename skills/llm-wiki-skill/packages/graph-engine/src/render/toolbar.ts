export type GraphToolbarPanelState = "closed" | "filters" | "legend";

export interface GraphToolbarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const GRAPH_TOOLBAR_PANEL_KEY = "llm-wiki:graph:toolbar:panel";

export function normalizeToolbarPanelState(value: unknown): GraphToolbarPanelState {
  return value === "filters" || value === "legend" ? value : "closed";
}

export function readToolbarPanelState(storage: GraphToolbarStorage | null | undefined): GraphToolbarPanelState {
  try {
    return normalizeToolbarPanelState(storage?.getItem(GRAPH_TOOLBAR_PANEL_KEY));
  } catch {
    return "closed";
  }
}

export function writeToolbarPanelState(storage: GraphToolbarStorage | null | undefined, state: GraphToolbarPanelState): void {
  try {
    storage?.setItem(GRAPH_TOOLBAR_PANEL_KEY, state);
  } catch {
    // localStorage can be unavailable in restricted file contexts.
  }
}

export function nextToolbarPanelState(current: GraphToolbarPanelState, requested: Exclude<GraphToolbarPanelState, "closed">): GraphToolbarPanelState {
  return current === requested ? "closed" : requested;
}

export function shouldBlankClickCloseToolbar(state: GraphToolbarPanelState): boolean {
  return state !== "closed";
}

export function toolbarPanelStateAfterBlankClick(state: GraphToolbarPanelState): GraphToolbarPanelState {
  return shouldBlankClickCloseToolbar(state) ? "closed" : state;
}

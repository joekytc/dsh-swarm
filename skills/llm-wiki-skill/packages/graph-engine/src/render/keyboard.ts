export type GraphKeyboardIntent =
  | "open-search"
  | "close-search"
  | "close-toolbar"
  | "cancel-active-gesture"
  | "clear-interaction"
  | "blocked";

export interface GraphKeyboardIntentInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  graphFocused: boolean;
  activeGesture: boolean;
  textEditingTarget: boolean;
  searchActive: boolean;
  toolbarOpen: boolean;
  interactionActive: boolean;
}

export function classifyGraphKeyboardIntent(input: GraphKeyboardIntentInput): GraphKeyboardIntent {
  const key = input.key.toLowerCase();
  const graphOwnsKeyboard = input.graphFocused || input.activeGesture;
  if (!graphOwnsKeyboard) return "blocked";

  if ((input.metaKey || input.ctrlKey) && key === "f") {
    return input.graphFocused && !input.textEditingTarget ? "open-search" : "blocked";
  }

  if (input.key !== "Escape") return "blocked";
  if (input.graphFocused && input.searchActive) return "close-search";
  if (input.graphFocused && input.toolbarOpen) return "close-toolbar";
  if (input.activeGesture) return "cancel-active-gesture";
  if (input.graphFocused && input.interactionActive) return "clear-interaction";
  return "blocked";
}

export function isTextEditingElement(element: Element | null): boolean {
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  if (tagName === "textarea") return true;
  if (tagName === "input") {
    const input = element as HTMLInputElement;
    const type = input.type.toLowerCase();
    return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(type);
  }
  return typeof HTMLElement !== "undefined" && element instanceof HTMLElement && element.isContentEditable;
}

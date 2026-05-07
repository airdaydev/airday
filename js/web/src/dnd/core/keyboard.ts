export type DndKeyAction =
  | { type: "select-only-first" }
  | { type: "select-only-last" }
  | { type: "navigate"; direction: "up" | "down" }
  | { type: "extend"; direction: "up" | "down" }
  | { type: "extend-to-first" }
  | { type: "extend-to-last" }
  | { type: "mod-click" } // cmd+click or ctrl+click — handled by mouse, not keyboard
  | { type: "move-selection"; direction: "up" | "down" }
  | { type: "select-all" }
  | { type: "clear" }
  | { type: "ignore" };

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export function mapDndKeyEvent(e: KeyboardEvent): DndKeyAction {
  const mod = isMac ? e.metaKey : e.ctrlKey;

  // Escape — clear selection
  if (e.key === "Escape") {
    return { type: "clear" };
  }

  // Mod + A — select all
  if (mod && e.key === "a") {
    return { type: "select-all" };
  }

  // Alt/Option + Arrow — jump to first/last
  if (e.altKey && !e.shiftKey && e.key === "ArrowUp") {
    return { type: "select-only-first" };
  }
  if (e.altKey && !e.shiftKey && e.key === "ArrowDown") {
    return { type: "select-only-last" };
  }

  // Shift + Mod + Arrow — extend to first/last
  if (e.shiftKey && mod && e.key === "ArrowUp") {
    return { type: "extend-to-first" };
  }
  if (e.shiftKey && mod && e.key === "ArrowDown") {
    return { type: "extend-to-last" };
  }

  // Shift + Arrow — extend selection
  if (e.shiftKey && !mod && e.key === "ArrowUp") {
    return { type: "extend", direction: "up" };
  }
  if (e.shiftKey && !mod && e.key === "ArrowDown") {
    return { type: "extend", direction: "down" };
  }

  // Mod + Arrow — move selection (reorder)
  if (mod && !e.shiftKey && e.key === "ArrowUp") {
    return { type: "move-selection", direction: "up" };
  }
  if (mod && !e.shiftKey && e.key === "ArrowDown") {
    return { type: "move-selection", direction: "down" };
  }

  // Plain Arrow — navigate
  if (!e.shiftKey && !mod && !e.altKey && e.key === "ArrowUp") {
    return { type: "navigate", direction: "up" };
  }
  if (!e.shiftKey && !mod && !e.altKey && e.key === "ArrowDown") {
    return { type: "navigate", direction: "down" };
  }

  return { type: "ignore" };
}

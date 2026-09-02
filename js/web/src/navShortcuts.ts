// Digit shortcuts for the fixed nav views: 1 Focus, 2 Inbox, 3 Upcoming,
// 4 Done, 5 Bin. Pure decision logic, extracted from Workspace so it can be
// unit-tested without a DOM. The Bin slot mirrors its nav visibility —
// it only exists while the bin holds items, so 5 is a no-op when empty.
// Any modifier disqualifies the key (Cmd+1 belongs to the browser); the
// editable-surface and overlay guards live centrally in `onGlobalKey`.

import type { ViewKey } from "./prefs.ts";

export function digitNavTarget(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  binCount: number,
): ViewKey | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  switch (e.key) {
    case "1":
      return { kind: "focus" };
    case "2":
      return { kind: "list", id: "inbox" };
    case "3":
      return { kind: "upcoming" };
    case "4":
      return { kind: "done" };
    case "5":
      return binCount > 0 ? { kind: "bin" } : null;
    default:
      return null;
  }
}

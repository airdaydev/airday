// How a list is rendered: the flat list view or the board lens, plus
// the board's Done-lane visibility (`spec/board.md`).
//
// The same encoding is used in three places, deliberately: the doc's
// per-list saved default (`ListView.defaultView`, `SettingsView.inboxView`),
// this client's local per-list override in localStorage, and the argument
// to `DocApp.setDefaultView`. One grammar means comparing "what I'm
// looking at" against "what's saved as the default" is a string compare.
//
// Canonical form — the list lens carries no Done-lane state, so a list
// view always encodes as bare "list":
//
//   "list" | "board" | "board:nodone"

export interface ViewSpec {
  /** `true` ≡ the board lens, `false` ≡ the flat list view. */
  board: boolean;
  /** Board Done-lane visibility. Always `true` for the list lens. */
  showDone: boolean;
}

/** The built-in fallback: what a client renders for a list with no saved
 *  default and no local override. */
export const LIST_VIEW: ViewSpec = { board: false, showDone: true };
export const BOARD_VIEW: ViewSpec = { board: true, showDone: true };

export function encodeView(v: ViewSpec): string {
  if (!v.board) return "list";
  return v.showDone ? "board" : "board:nodone";
}

/** Decode a stored view. Absent, empty, or a form this build doesn't
 *  recognize (a newer client's lens) all read as `null` — "no view
 *  here", so the caller falls back to the next source. */
export function parseView(s: string | null | undefined): ViewSpec | null {
  switch (s) {
    case "list":
      return LIST_VIEW;
    case "board":
      return BOARD_VIEW;
    case "board:nodone":
      return { board: true, showDone: false };
    default:
      return null;
  }
}

export function viewsEqual(a: ViewSpec, b: ViewSpec): boolean {
  return encodeView(a) === encodeView(b);
}

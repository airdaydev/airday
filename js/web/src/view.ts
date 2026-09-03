// How a list is rendered: the flat list view or the board lens, plus
// which board lanes are visible (`spec/board.md`).
//
// The same encoding is used in three places, deliberately: the doc's
// per-list saved default (`ListView.defaultView`, `SettingsView.inboxView`),
// this client's local per-list override in localStorage, and the argument
// to `DocApp.setDefaultView`. One grammar means comparing "what I'm
// looking at" against "what's saved as the default" is a string compare.
//
// Canonical form — the list lens carries no lane state (always bare
// "list"), and a board showing every lane is bare "board":
//
//   "list" | "board" | "board:" lane ("," lane)*
//   lane   = "backlog" | "todo" | "in_progress" | "review" | "done"
//
// The lane list names the *visible* lanes in ladder order. Mirrors
// `DefaultView` in core/src/doc.rs — changing one side alone breaks
// saved defaults.

import { OPEN_STATES, type WorkflowState } from "./sync/store.ts";

/** The five board lanes in left-to-right (ladder) order. */
export const ALL_LANES: readonly WorkflowState[] = [...OPEN_STATES, "done"];

export interface ViewSpec {
  /** `true` ≡ the board lens, `false` ≡ the flat list view. */
  board: boolean;
  /** Visible board lanes, in ladder order. Always `ALL_LANES` for the
   *  list lens. Callers keep it non-empty: at least one lane always
   *  renders. */
  lanes: readonly WorkflowState[];
}

/** The built-in fallback: what a client renders for a list with no saved
 *  default and no local override. */
export const LIST_VIEW: ViewSpec = { board: false, lanes: ALL_LANES };
export const BOARD_VIEW: ViewSpec = { board: true, lanes: ALL_LANES };

/** `lanes` reduced to canonical form: ladder order, no repeats. */
function canonicalLanes(lanes: readonly WorkflowState[]): WorkflowState[] {
  return ALL_LANES.filter((l) => lanes.includes(l));
}

export function encodeView(v: ViewSpec): string {
  if (!v.board) return "list";
  const lanes = canonicalLanes(v.lanes);
  // An empty set never reaches the register (see `ViewSpec.lanes`).
  if (lanes.length === ALL_LANES.length || lanes.length === 0) return "board";
  return `board:${lanes.join(",")}`;
}

/** Decode a stored view. Absent, empty, or a form this build doesn't
 *  recognize (a newer client's lens, an unknown lane name, an empty lane
 *  list) all read as `null` — "no view here", so the caller falls back
 *  to the next source. */
export function parseView(s: string | null | undefined): ViewSpec | null {
  if (s === "list") return LIST_VIEW;
  if (s === "board") return BOARD_VIEW;
  if (!s || !s.startsWith("board:")) return null;
  const names = s.slice("board:".length);
  if (names === "") return null;
  const parts = names.split(",");
  if (!parts.every((n) => (ALL_LANES as readonly string[]).includes(n))) return null;
  const lanes = canonicalLanes(parts as WorkflowState[]);
  return lanes.length === ALL_LANES.length ? BOARD_VIEW : { board: true, lanes };
}

export function viewsEqual(a: ViewSpec, b: ViewSpec): boolean {
  return encodeView(a) === encodeView(b);
}

/** `v` with one lane shown or hidden, or `null` when hiding it would
 *  leave no lane at all (at least one lane always renders). */
export function withLane(v: ViewSpec, lane: WorkflowState, visible: boolean): ViewSpec | null {
  const lanes = ALL_LANES.filter((l) => (l === lane ? visible : v.lanes.includes(l)));
  if (lanes.length === 0) return null;
  return { ...v, lanes };
}

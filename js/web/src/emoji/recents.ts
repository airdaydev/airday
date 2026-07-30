// Recently-picked emoji, most recent first.
//
// Device-local UI state, so localStorage rather than the per-account `prefs`
// row in IndexedDB — same reasoning as the view-mode prefs in `Workspace.tsx`.
// It isn't worth a sync round-trip, and "what I reached for on this device"
// is arguably the right scope anyway.

const KEY = "airday.emoji.recents";

/** Three rows of eight in the picker grid. */
const MAX = 24;

export function loadRecentEmoji(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX);
  } catch {
    return [];
  }
}

/** Move `emoji` to the front, deduped, and persist. Returns the new list so
 *  the caller can drive a signal from it without a re-read. */
export function pushRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...loadRecentEmoji().filter((e) => e !== emoji)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private-mode / quota failures are not worth surfacing; the picker
    // works fine without a recents row.
  }
  return next;
}

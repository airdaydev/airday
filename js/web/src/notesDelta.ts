// Plain-text deltas for the notes editor (spec/notes-plan.md, Phase 2).
// The core's `applyNotesDelta` / `itemNotesDelta` speak the Quill delta
// shape in UTF-16 code units, which is what `string.length` and DOM
// offsets count in, so nothing here converts units. The editor turns
// each input event into a delta with `diffToDelta`, and applies inbound
// deltas to its buffer with `applyDelta`, moving the caret with
// `transformOffset`.

export type NotesDeltaOp = { retain: number } | { insert: string } | { delete: number };

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

// Minimal single-region delta from `prev` to `next` (common prefix and
// suffix in UTF-16 units), or null when they are equal. A boundary is
// never placed between the halves of a surrogate pair, so the core's
// scalar-boundary check always passes. A single-region diff is exact for
// every edit a caret or selection produces; a multi-region change (a
// programmatic replace) still yields a correct, if larger, delta.
export function diffToDelta(prev: string, next: string): NotesDeltaOp[] | null {
  if (prev === next) return null;
  const max = Math.min(prev.length, next.length);
  let prefix = 0;
  while (prefix < max && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && prefix < max && isHigh(prev.charCodeAt(prefix - 1))) prefix--;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  )
    suffix++;
  if (suffix > 0 && isLow(prev.charCodeAt(prev.length - suffix))) suffix--;
  const ops: NotesDeltaOp[] = [];
  if (prefix > 0) ops.push({ retain: prefix });
  const deleted = prev.length - prefix - suffix;
  if (deleted > 0) ops.push({ delete: deleted });
  const inserted = next.slice(prefix, next.length - suffix);
  if (inserted) ops.push({ insert: inserted });
  return ops;
}

// Apply `ops` to `text`. Trailing text after the last op is kept.
export function applyDelta(text: string, ops: readonly NotesDeltaOp[]): string {
  let out = "";
  let pos = 0;
  for (const op of ops) {
    if ("retain" in op) {
      out += text.slice(pos, pos + op.retain);
      pos += op.retain;
    } else if ("delete" in op) {
      pos += op.delete;
    } else {
      out += op.insert;
    }
  }
  return out + text.slice(pos);
}

// Where a caret at `offset` (before `ops`) lands after `ops`. An insert
// exactly at the caret goes before it, so remote text typed at the same
// spot pushes the local caret along rather than splitting a word behind
// it.
export function transformOffset(offset: number, ops: readonly NotesDeltaOp[]): number {
  let pos = 0;
  let out = offset;
  for (const op of ops) {
    if (pos > offset) break;
    if ("retain" in op) {
      pos += op.retain;
    } else if ("delete" in op) {
      out -= Math.min(op.delete, Math.max(0, offset - pos));
    } else {
      out += op.insert.length;
    }
  }
  return Math.max(0, out);
}

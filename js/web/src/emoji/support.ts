// Detects the newest Unicode emoji version this device can actually draw,
// so the picker never offers a glyph that renders as a tofu box.
//
// The technique is borrowed from emoji-picker-element (Apache-2.0): render a
// representative emoji for each version to a canvas and check whether the
// result is *coloured*. Every real emoji font draws in colour; a missing
// glyph falls back to the monochrome tofu box (or, for an uncomposed ZWJ
// sequence, to monochrome component glyphs). Versions are probed newest
// first and we stop at the first hit — emoji font coverage is cumulative in
// practice, so the newest drawable version bounds the whole set.
//
// This is a heuristic, and it fails open: any error, or a browser without a
// usable 2D canvas, yields `Infinity` (show everything). A tofu in the
// picker is a much smaller problem than an empty picker.

/** One representative emoji per Unicode emoji version, newest first. Each is
 *  chosen to be introduced *in* that version and to have no plausible
 *  monochrome legacy rendering. Add a row here when a new version ships. */
const PROBES: readonly (readonly [emoji: string, version: number])[] = [
  ["🫩", 16],
  ["🙂‍↔️", 15.1],
  ["🫨", 15],
  ["🫠", 14],
  ["🥲", 13.1],
  ["🥻", 12.1],
  ["🥰", 11],
  ["🤪", 5],
  ["👱‍♀️", 4],
  ["🤣", 3],
  ["👁️‍🗨️", 2],
  ["😀", 1],
  ["😐️", 0.7],
  ["😃", 0.6],
];

const FONT_SIZE = 32;
const CANVAS_SIZE = 64;

/** True if `emoji` renders with at least one non-grey pixel. Grey (r=g=b)
 *  covers both a blank canvas and the monochrome tofu fallback. */
function rendersInColour(ctx: CanvasRenderingContext2D, emoji: string): boolean {
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.fillText(emoji, 0, 0);
  const { data } = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // transparent
    if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) return true;
  }
  return false;
}

let cached: number | null = null;

/** Newest drawable Unicode emoji version, or `Infinity` if we can't tell.
 *  Computed once per page load — the probe is ~14 canvas reads, cheap
 *  enough to not be worth persisting, and re-running it means an OS font
 *  update is picked up on the next reload rather than never. */
export function maxSupportedEmojiVersion(): number {
  if (cached !== null) return cached;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    // `willReadFrequently` keeps the context on the CPU backend; without it
    // browsers warn (and stall) on repeated `getImageData` from a GPU canvas.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return (cached = Infinity);
    ctx.textBaseline = "top";
    ctx.font = `${FONT_SIZE}px sans-serif`;

    for (const [emoji, version] of PROBES) {
      if (rendersInColour(ctx, emoji)) return (cached = version);
    }
    // Nothing drew in colour at all — almost certainly a canvas that doesn't
    // do colour fonts (some headless/CI renderers) rather than a device with
    // no emoji whatsoever. Don't filter on that basis.
    return (cached = Infinity);
  } catch {
    return (cached = Infinity);
  }
}

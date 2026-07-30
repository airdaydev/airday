// Regenerates the vendored emoji dataset at `src/emoji/emoji-data.json`.
// Run from the workspace root with `bun run vendor:emoji`.
//
// Upstream is `emoji-picker-element-data` (Apache-2.0), which is itself
// built from `emojibase` (MIT) over CLDR annotations. We take the data
// only — not the picker component, which is a shadow-DOM custom element
// that wouldn't compose with our Kobalte primitives.
//
// The upstream `en/emojibase` file is ~440kB because it carries skin-tone
// variants, emoticons and per-skin metadata we don't use. We strip to the
// fields the picker actually reads and re-shape each record as a
// positional array, which roughly a third of the raw bytes and cuts
// JSON.parse time. See `src/emoji/data.ts` for the consuming schema.

const UPSTREAM_VERSION = "1.8.0";
const UPSTREAM_URL =
  `https://cdn.jsdelivr.net/npm/emoji-picker-element-data@${UPSTREAM_VERSION}/en/emojibase/data.json`;

/** Emojibase group id for skin-tone / hair-colour modifiers. These are
 *  combining components, not standalone emoji — never shown in a picker. */
const GROUP_COMPONENT = 2;

interface UpstreamEmoji {
  emoji: string;
  annotation: string;
  group?: number;
  order?: number;
  version: number;
  tags?: string[];
  shortcodes?: string[];
}

const outPath = new URL("../src/emoji/emoji-data.json", import.meta.url);

console.log(`fetching ${UPSTREAM_URL}`);
const res = await fetch(UPSTREAM_URL);
if (!res.ok) throw new Error(`upstream fetch failed: ${res.status} ${res.statusText}`);
const upstream = (await res.json()) as UpstreamEmoji[];

const rows = upstream
  .filter((e) => e.group !== undefined && e.group !== GROUP_COMPONENT)
  // Upstream is already in `order`, but it is only optional in the schema;
  // sort explicitly so the vendored file has a defined, stable ordering.
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map((e) => [
    e.emoji,
    e.annotation,
    e.group,
    e.version,
    (e.tags ?? []).join(" "),
    (e.shortcodes ?? []).join(" "),
  ]);

const payload = {
  // Provenance, so a future reader can tell what to re-run to refresh this.
  source: `emoji-picker-element-data@${UPSTREAM_VERSION} en/emojibase (Apache-2.0)`,
  fields: ["emoji", "annotation", "group", "version", "tags", "shortcodes"],
  emoji: rows,
};

const json = JSON.stringify(payload);
await Bun.write(outPath, json);
console.log(
  `wrote ${rows.length} emoji (${upstream.length - rows.length} components dropped), ` +
    `${(json.length / 1024).toFixed(0)}kB to ${outPath.pathname}`,
);

# Notes as LoroText: plan

**Status: plan, not built.** Moves `item.notes` from a whole-string LWW
register to a mergeable `LoroText` child container, and lays out the path
from there to rich text with images. Companion to `sharing-plan.md` ("Text
fields must be mergeable before sharing"), which this plan supersedes for the
storage question.

Research date: 2026-09-04. Loro versions at that date: Rust crate `loro`
1.13.9 (2026-08-01), npm `loro-crdt` 1.15.1 (2026-08-29). Airday pins
`loro = "1.10"` and resolves 1.12.0.

## Decisions in one screen

| Question | Decision |
|---|---|
| Separate doc or same doc? | **Same doc.** `notes` becomes a `LoroText` child of the item map at `items/<id>/notes`. No new root container, no second doc. |
| Lazy creation | **Yes, via Loro mergeable containers** (`LoroMap::ensure_mergeable_text`, Rust 1.13.1+). Created on first write; concurrent first writes on two devices merge into one text. Items without notes carry nothing. |
| Editor connector | **None fits as-is.** Every Loro editor binding needs a JS `LoroDoc`; Airday's doc lives in Rust wasm. We write a thin delta bridge across the wasm boundary instead. |
| Rich text model | **Flat rich text in one `LoroText`** (Quill delta model: inline marks, line formats as attributes on `\n`). Not a ProseMirror node tree. |
| Images | **By reference**, never bytes in the CRDT. A `U+FFFC` placeholder character carrying an `image` attribute that names an encrypted attachment. Attachments are a new dumb server surface (own spec, later phase). |
| `text` field | Ride the same cutover: `text` also becomes a mergeable `LoroText`, plain only, edited via `update`. One schema bump instead of two. |
| Schema | **v3 to v4**, clean break, export / wipe / import per `data-model.md` policy. |

## 1. Storage

### Why the same doc

- One sync engine, one WAL, one compaction horizon, one DEK. A separate
  notes doc per item is the multi-doc substrate from `sharing-plan.md`
  Phases 1-5 (about six days) plus per-doc frontier and snapshot management
  for thousands of tiny docs. Nothing about notes needs it.
- Notes are short. Airday holds next steps, not plans (`subtasks.md`); a
  note is context for one item, not a long-form document. The failure mode
  that justifies a separate doc (one huge text dominating snapshot size) is
  outside the product.
- Sharing later shares the item and its notes together for free.
- Diff translation already routes nested containers under `items` by path
  root (`classify_captured_diff`, `core/src/doc.rs`); a text child slots in
  with one new arm.

### Why a child of the item map, not a `notes/<id>` root container

A per-item root container (`doc.get_text("notes/<id>")`) is op-free and
merges concurrent creation, and Airday already uses that pattern for
`order/<list-id>`. It was the fallback if mergeable containers had not
shipped. Rejected because root containers can never be removed from the
doc, so hard-deleted items would leave a root per item forever, and the
item's fields would live in two places for reads, hashes, export, and
duplication. The mergeable child gives the same merge guarantee inside the
item.

### Mergeable containers (the "lazy creation merge" feature)

Shipped 2026-06 (Loro blog "Mergeable Containers", PR #991, issue #759):

- `LoroMap::ensure_mergeable_text(key) -> LoroText` and siblings for map,
  list, movable list, tree, counter. Rust crate 1.13.1+, npm 1.13.0+.
- The child gets a deterministic id derived from `(parent, key, type)`, so
  two peers calling `ensure_mergeable_text("notes")` concurrently produce
  the same container and their inserts interleave as one text.
- First call writes one small marker op into the map slot; repeat calls are
  idempotent and write nothing. Delete removes the marker (LWW), and the
  child's history stays in the doc, so a later `ensure` resurfaces it.
- `get_or_create_container` is now deprecated in favour of this.
- Contrast with today's `insert_container` on the same key from two peers:
  LWW on the map key, one text hidden. The loser is recoverable only by
  container id (`is_deleted() == true`), which is not a UX.

Consequence: **new items do not get a notes container at creation.** The
container is created on first notes write on whichever device writes first,
and the merge is safe. This is the one place the eager-create workaround
(create at item creation, same commit) is unnecessary.

### Item table after this plan

| Field | v3 | v4 |
|---|---|---|
| `text` | string register | mergeable `LoroText`, plain (no marks), never empty |
| `notes` | string register | mergeable `LoroText`, absent until first write, may carry marks |

Everything else unchanged. `data-model.md` gets these two rows plus a
"v3 to v4" paragraph under schema versioning.

### Loro version bump

Root `Cargo.toml`: `loro = "1.13"`. Verify `bun run test` and
`bun run build:wasm`. Note the Rust crate lags the npm package: the
1.14 / 1.15 fixes (atomic `import_batch`, O(n^2) styled-text read fix,
redundant mark dedupe) are not on crates.io yet. The styled-read fix matters
for rich text with many marks; notes are short, so this is a watch item,
not a blocker.

### Index units

Airday does not enable Loro's `wasm` cargo feature, so every text index in
core, including inside the web wasm build, is a **Unicode scalar index**.
Browser editors speak UTF-16. The bridge converts at the wasm boundary
(`LoroText::convert_pos`, or the `_utf16` method variants where they
exist; `apply_delta` has no UTF-16 variant, so the Rust bridge walks the
delta and converts retain / delete lengths against the current text).

## 2. Core changes (Phase 1, plain text, merge-correct)

Goal: character-level merges with zero UI change. This is the
`sharing-plan.md` pre-flight item, done properly.

- `edit_item_notes(id, notes: &str)`: `ensure_mergeable_text(KEY_NOTES)`
  then `text.update(notes, UpdateOptions::default())` (Myers diff). Empty
  string: delete the key (removes the marker; history retained). Signature
  unchanged, so CLI, wasm bindings, import, and duplicate-list callers are
  untouched.
- `edit_item_text`: same shape with `KEY_TEXT`, keeping the non-empty
  validation. Item creation writes `text` through `ensure_mergeable_text`
  + `insert(0, ..)` in the same commit as the item map.
- Reads: `item_view` reads `LoroText::to_string()` for both fields
  (`read_text_or_string` helper: accept a text container; a stray string
  value is a v3 leftover and, per the clean-break policy, is not read).
- Diff classifier: in the `None` (nested) arm under `ROOT_ITEMS`, a
  `LoroDiff::Text` whose path ends in `(item_map, Index::Key(key))` becomes
  `CapturedDiff::ItemMap { container: <parent item map>, keys: {key} }`.
  Today it falls through to `Opaque`, which forces a `FullResync` on every
  remote keystroke. Also keep the marker write (a `Map` diff on the item
  with key `notes`) mapping to the same key set, which it already does.
- Events: `ItemNotesChanged { id, notes }` and `ItemTextChanged` keep
  carrying the full string (the store, search index, and CLI want plain
  text). Add `ItemNotesDelta { id, delta }` later in Phase 2; not needed for
  Phase 1.
- Hash (`hash_str(&i.notes)`), JSON export / import, duplicate-list copy:
  unchanged because they go through `ItemView` strings and the edit
  functions.
- Undo: core's doc-wide `UndoManager` will start recording each notes
  commit as a workspace undo step. Phase 1 leaves that as-is (it already
  records whole-string sets). Phase 2 revisits (see Undo below).
- Schema: bump the constant to 4, add the JSON cutover note. The JSON
  export shape is unchanged (strings), so v3 exports import into v4 as-is.

Tests (extend the existing multi-peer tests in `core/src/doc.rs`):

1. Two peers write notes to an item that had none, offline, then sync:
   both texts present, one container (the mergeable-id guarantee).
2. Two peers edit different parts of existing notes: both edits present.
3. Same-region concurrent edits: character-level merge, nothing dropped.
4. Remote notes edit produces `ItemNotesChanged` for that item only, no
   `FullResync` (asserts the classifier arm).
5. Clear notes on one peer while another appends: converges
   deterministically (marker LWW vs. resurfaced text); document the result.
6. Export v3 JSON, import into v4, hash equal.

Estimate: 1 day including the cutover.

## 3. Editor bindings: what exists and why none plug in

| Binding | Version (date) | Model | Verdict for Airday |
|---|---|---|---|
| `loro-prosemirror` (official) | 0.4.4 (2026-08-22) | PM node tree as `LoroMap{nodeName, attributes, children: LoroList}` with `LoroText` leaves; sync, undo, ephemeral cursors | Needs a JS `LoroDoc`. Tree model also means Rust could not render notes to text without reimplementing the PM shape. |
| `loro-codemirror` (official) | 0.3.3 (2025-10-07, one commit since) | single `LoroText`, undo, cursors | Needs a JS `LoroDoc`. Its bridge is ~150 lines and is the template for ours. |
| Quill | in-repo example only (Quill 1.3.7) | `LoroText` delta, strings only | No package, but Loro's `TextDelta` is the Quill delta format by design. |
| `loro-slate`, `lexical-loro`, ProseKit `defineLoro` | community / wrappers | trees over loro-prosemirror or their own | Same JS-doc requirement. |
| Tiptap 3 | Yjs only officially | | loro-prosemirror can be registered as raw PM plugins (cooee did this), still JS-doc bound. |

The blocking fact: **Airday's `LoroDoc` is inside `airday-core-web`
(Rust wasm).** Every binding constructs against `loro-crdt`'s JS `LoroDoc`.
Shipping `loro-crdt` too would add a second Loro runtime (1.05 MB gzipped
wasm plus glue) and require mirroring the notes container between two
runtimes on every keystroke. Rejected.

What we build instead: a **delta bridge** on the wasm API.

```
// wasm (core/web/src/lib.rs)
notesDelta(itemId): string            // JSON Vec<TextDelta>, UTF-16 units
applyNotesDelta(itemId, deltaJson)    // UTF-16 in, converted, one commit, origin "notes:<itemId>"
// event
itemNotesDelta { id, delta }          // remote (and other-tab) changes as a UTF-16 delta
```

Rust side: convert UTF-16 to Unicode positions, `ensure_mergeable_text`,
`apply_delta`, commit. Event side: subscribe to `Diff::Text` under the
item's `notes` key, convert Unicode to UTF-16, emit. The web adaptor is the
`loro-codemirror` pattern: local editor change with source `user` goes to
`applyNotesDelta`; `itemNotesDelta` arriving goes to the editor with source
`api`, guarded against echo by origin.

Phase 2 deliverable: this bridge plus the current plain contenteditable
dialog switched from full-string writes to deltas, so a live remote edit
under the caret no longer replaces the whole field. Estimate: 1.5 days.

## 4. Rich text (Phase 3)

### Model: flat rich text in one `LoroText`

Loro's text is a flat sequence with marks; it has **no embeds** (Rust
`TextDelta::Insert { insert: String, .. }`, and `applyDelta` with an object
insert throws). The two official ways to get structure are:

1. A node tree (`LoroList` / `LoroMap` / `LoroText` leaves), which is what
   loro-prosemirror and loro-slate do. Full block structure, but a tree the
   Rust side cannot render without a PM-shaped walker, several containers
   per note, and a much larger bridge.
2. **Quill-style flat rich text**: inline marks (`bold`, `italic`, `code`,
   `strike`, `link`) on ranges; block formats (`header`, `list`,
   `code-block`, `blockquote`) as attributes on the `\n` that terminates
   the line; images as a placeholder character with an attribute.

Option 2 is chosen. It keeps notes in one container, `to_string()` is the
plain-text projection for search, CLI, export, and hashing (with `U+FFFC`
rendered as `[image]`), and the wasm bridge from Phase 2 already carries
attributes.

Style config (`LoroDoc::config_text_style`, set once at doc open, same on
every client): `bold` / `italic` / `strike` / `code` expand `after`;
`link` expand `none`; line attributes (`header`, `list`, `blockquote`,
`code-block`) expand `none`; `image` expand `none`. Loro requires a key to
always use one expand type, so the table lives in one place in core.

### Editor

Quill 2 is the natural fit: its native data model is the same delta, line
formats live on `\n`, images are embeds, and its history module handles
remote transforms with `userOnly: true`. The adaptor translates
`{ insert: { image: src } }` to `insert: "￼"` with
`attributes: { image: <ref> }` and back. Quill's default themes are replaced
with Airday's own toolbar and styles (headless usage is supported).

CodeMirror 6 with Markdown is the fallback if Quill's contenteditable
handling fights the dialog (mobile caret, IME, the existing
`locateOffsetInLinkified` model). It is plain `LoroText` with no marks and
a Markdown preview, images as `![](ref)`. Cheaper, less WYSIWYG. Decide by
prototype in Phase 3, not now.

### Undo

Core's doc-wide `UndoManager` is the workspace undo (moves, lifecycle,
edits). Typing in a rich editor should not push keystroke groups into it,
and the editor's own undo needs to survive remote inserts. Rule: notes
commits carry origin `notes:<itemId>`; the workspace `UndoManager` gets
`add_exclude_origin_prefix("notes:")`; the editor's history module owns
text undo while the editor is open. This is the same scoping problem
tracked upstream as loro-dev/loro#981 (per-container undo); the origin
prefix is the workaround Loro itself suggests.

### What carries over from cooee

Cooee (`danielgormly/cooee`, not on disk any more; `../cooee` is gone) is
one `LoroDoc` per post with `loro-prosemirror` 0.4.3 (`LoroSyncPlugin` +
`LoroUndoPlugin`, no cursor plugin), a PM schema with `image` as a block
node holding a URL, S3 uploads referenced by id, a `contentJson` string
mirror so the server can read the doc, and snapshot-swap (`TAG_REPLACE`)
room initialisation.

Transfers: images by reference only; the mark expand table derived from
"inclusive" semantics; paste sanitisation as a whitelist DOM walk; the
warning that a whole-doc `UndoManager` swallows editor undo.

Does not transfer: per-post docs and the whole replace / epoch machinery
(single-doc here); server-side reads and the JSON mirror (E2EE server);
rebuilding the editor on snapshot import; loro-prosemirror itself (JS doc).

## 5. Images (Phase 4, own spec)

Bytes never enter the CRDT: one photo would be a megabyte op blob in every
snapshot and every device's WAL. Instead:

- New server surface, `spec/attachments.md`: `PUT /attachments/<id>` and
  `GET /attachments/<id>` per account, opaque encrypted blobs, size cap
  (proposal 8 MiB), sqlite table `attachments(account_id, id, bytes,
  created_at)`. Same dumbness as ops: the server cannot read them.
- Client: downscale to at most 2048 px on the long edge, encode WebP,
  encrypt with the account DEK (AES-GCM, fresh nonce, per
  `encryption.md`), upload, then insert `U+FFFC` with
  `image: { id, mime, w, h }`. Cache decrypted bytes in IndexedDB (web) or
  the sqlite store (CLI, if it ever renders).
- Garbage: the server cannot count references. Pre-release rule: hard
  delete of an item deletes the attachments its notes reference (client
  issues the deletes). A periodic client-side sweep is future work; leaks
  are bounded by the size cap.
- Sync of attachments is separate from op sync and needs no protocol
  change; a note referencing an attachment the device has not fetched
  shows a placeholder until `GET` succeeds.
- Snapshots do not include attachments. Durability is the attachments
  table.

Estimate: 3 days including the server spec, tests, and the web upload path.

## 6. Order of work

| Phase | What | Days |
|---|---|---|
| 0 | Bump `loro` to 1.13, build wasm, run tests | 0.5 |
| 1 | `text` + `notes` as mergeable `LoroText`, `update` diffing, classifier arm, schema v4 cutover, merge tests | 1 |
| 2 | Delta bridge (wasm API + event), dialog writes deltas, live remote edits under caret | 1.5 |
| 3 | Rich text: style config, Quill 2 adaptor (or CodeMirror fallback), toolbar, paste whitelist, plain projection with `[image]` | 3 |
| 4 | Attachments spec + server + client upload, image insert | 3 |

Phase 1 is worth doing alone: it removes the one CRDT failure users notice
(the dropped notes edit between phone and laptop) and is a prerequisite for
sharing. Phases 3 and 4 are product decisions and can wait.

## Open questions

- Should `text` (the title) ever carry marks? Plan says no: plain
  `LoroText`, `update` only, so the row renderer never parses attributes.
- Line-format vocabulary: headers and lists yes; tables, embeds other than
  images, and nested lists no. Revisit if notes grow.
- Whether the CLI should print marks (Markdown-ish) or plain text.
  Plan: plain text from `to_string()` with `[image]`.
- Attachment retention after item bin vs hard delete: bin keeps, hard
  delete removes. Restore therefore never loses an image.

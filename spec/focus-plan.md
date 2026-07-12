# Focus + Inbox rename — implementation plan

Status: **planning**. This doc is the handoff for a fresh context. Two features:

1. **Rename "Queue" → "Inbox"** (label only; `main` id and settings keys unchanged).
2. **Add "Focus"** — a reserved, single-tier, curated *list-by-reference*: it points
   at items that live in other lists rather than owning them.

Product decisions already settled (do not relitigate — see below for the *why*):

- **Focus is a single tier.** No "Next"/"Someday"/on-deck sub-tiers. The tool asks
  the user for discipline instead of inventing parking spots for indecision.
- **No scheduling / no dates for Focus.** "Do it first thing tomorrow" is a
  *sequencing* statement, not a time statement: you drop the item into Focus now,
  ordered at the top, and it's there when you sit down. Deferring to a date is a
  separate, deliberately un-prominent future feature (hard-landscape items only),
  out of scope here.
- **Focus is a lens, not a home.** An item in Focus still lives in its source list.
  Removing from Focus removes the *reference*, never the item. Acting on an item in
  Focus (mark Live/Done) mutates the item everywhere.
- **Focus self-cleans via lifecycle.** A referenced item that goes Done or Binned
  evaporates from the Focus view. Focus shows only Open (Backlog + Live) references.
- **Reference-first for a reason:** today Focus references items in the local doc;
  the sharing feature (`spec/sharing-plan.md`) will need Focus to reference items in
  *other* docs. The reference encoding must be forward-compatible with cross-doc refs
  from day one so no migration is needed when sharing lands.

---

## Part A — Rename `main`/`home`/Queue → Inbox (id + label)

**Decided: full flip, including the stored reserved id** (`main` → `inbox`). This is a
**stored-data change, not additive** — the reserved literal appears in every item's
`location` register and in the order-container name. It rides a **one-time export → wipe
→ import cutover** on the live production doc, the same procedure as the documented
v1→v2 break (`spec/data-model.md` "Schema versioning & compatibility"). The container
*shapes* don't change (only the reserved literal and the `order/*` name), so no
schema-version renumber is needed — keep it "v2" and do the cutover.

### A.1 Cutover (the one operational cost)

1. Export JSON on the current build.
2. Wipe the account + local databases (client IDB, server op log/sqlite).
3. Import on the new build.

**The importer must alias the legacy reserved id `main` → `inbox`** — the export JSON
carries `list_id: "main"` for reserved-list items, and the new build reserves `inbox`.
Either add a one-shot alias in the JSON import path (`main` ⇒ `inbox` for the reserved
list only), or `sed` the export file before import. Pick the in-code alias; it's a few
lines and keeps the cutover a pure data round-trip. (Confirm this is the *only* place
`main` is stored verbatim in exported JSON — grep the export path.)

### A.2 Stored-id edit sites (the CRDT-facing ones)

- `core/src/doc.rs:59` — `LIST_MAIN: &str = "main"` → rename const to `LIST_INBOX` and
  set value `"inbox"`. Re-export in `core/src/lib.rs:12`.
- `core/src/doc.rs:60` — `LIST_MAIN_NAME: &str = "Queue"` → `INBOX_NAME` = `"Inbox"`.
- Order container name `order/main` → `order/inbox` (wherever the container name is
  built from `LIST_MAIN`).
- `Location` / `OrderEntry` grammar reserves the literal — flip `main` → `inbox`
  (`spec/data-model.md:98-99`, and the parse/guard code in `core/src/doc.rs` ~305-357).
- Settings key `KEY_MAIN_NAME`/`"main_name"` (`core/src/doc.rs:106`) → `"inbox_name"`;
  mutation `set_main_name` → `set_inbox_name` (`doc.rs:1867`, WASM `core/web/src/lib.rs:246,
  1400`, store `js/web/src/sync/store.ts:209`).
- All reserved-id guards/defaults keyed on `"main"` in `core/src/doc.rs`
  (rename/move/delete refusals, synthesized `ListView`, import id-map, fallback defaults
  — Explore flagged `1867, 1893-1972, 2176-2180, 2250-2256, 2285, 2418, 3383, 3463-3538,
  3594`). Grep `LIST_MAIN` and the literal `"main"` and flip each.
- CLI `--list` default (`cli/src/commands/items.rs:24, 72`) now resolves to `inbox`.
- Web reserved-id literals `{ kind: "list", id: "main" }`: `js/web/src/prefs.ts`,
  `runtime.ts:84-86`, `nav.tsx:227-228, 402`, `Workspace.tsx:890`.

### A.3 Label / i18n / naming (the cosmetic ones)

- `js/web/src/i18n.tsx` — rename the key `home` → `inbox`; English value `"Queue"` →
  `"Inbox"` (`:382`), **Spanish** `"Cola"` → `"Bandeja de entrada"` (`:230`); update key
  declarations (`:62, :229, :381`) and every `t("nav.home")` call site.
- `cli/tests/sync_smoke.rs:257` — assertion `"Queue"` → `"Inbox"`.
- Doc-comment sweep: "Queue"/"non-Queue" → "Inbox"/"non-Inbox" across `core/src/doc.rs`,
  `core/src/events.rs`, `core/web/src/lib.rs`, `core/ffi/src/lib.rs`, `js/web/src/nav.tsx`,
  `js/web/src/sync/store.ts`.
- `spec/data-model.md` — "rendered as Queue" (~261), "non-Queue"/"Queue's count"
  phrasings (~255, 275-276, 294-295), and the reserved-literal note (98-99).

**Sequencing:** do Part A's stored-id rename in **Phase 1** (it's core Rust + a cutover),
*before* the Focus core work, so Focus is built against `inbox` from the start. Land the
cutover on the live doc at a clean checkpoint.

---

## Part B — Focus

### B.1 Why Focus can't reuse the list/order machinery

`spec/data-model.md`: an item's `location` register is `"<list_id>:<placement_id>"` —
a single atomic value naming exactly **one** list. Order containers (`order/<list-id>`)
only become *visible* for an item when `item.location.list_id == L`. That is
single-membership by construction. Focus is a *second* appearance of an item without
moving it out of its home list, so it cannot ride on `location` or the order-container
visibility rule. Focus needs its own container of references.

(Confirmed greenfield: there is no existing reference/alias/pointer concept in the doc
model to extend — `location` is the only membership mechanism.)

### B.2 New container

Add one reserved singleton container, analogous to `order/main`:

- `doc.get_movable_list("focus")` — a `LoroMovableList` of **encoded scalar FocusRef
  strings only** (never child containers — same discipline as order containers). The
  MovableList's own order *is* the Focus order; reorder via `MovableList::mov`.
- Not a `ListMeta` row (like `main`). Reserved, non-deletable, non-renamable.
- **Additive** to the schema-v2 layout — it reinterprets no existing container, and
  Loro roots are typed by (name, type), so a focus-unaware client simply never projects
  it. Recommend treating this as additive within v2 (no version bump); confirm with
  Daniel. Document it in `spec/data-model.md`'s layout section. The sqlite migration
  (`001_init.sql`) is unaffected — it stores opaque blobs.

### B.3 FocusRef grammar (forward-compatible for cross-doc)

```
FocusRef = "<item_id>"              # now: local doc, bare uuid-v7 hex
         = "<doc_id>:<item_id>"     # future: cross-doc (sharing)
```

Same `:`-on-first-colon convention as `Location`/`OrderEntry`; uuid-hex components mean
`:` never collides. **Parser accepts both forms now** (no colon ⇒ local doc); **emitter
writes only the bare form** until sharing lands. This is the whole point of designing it
now — cross-doc refs slot in with zero migration. A ref whose `doc_id` is not the local
doc is *unresolvable today*; projection skips it (later: renders a placeholder).

### B.4 Projection & visibility

`focus_view()` → ordered `Vec<ItemView>`:

```
visible(ref in focus) :=
     ref resolves to the local doc
  && items[ref.item_id] exists
  && items[ref.item_id] is Open           # done_at == null && binned_at == null
  && no earlier visible ref has the same item_id     # dedup, first wins
```

Refs to missing / done / binned / foreign-doc items are **harmless garbage** — filtered
out by projection, GC'd by `reconcile()`. This mirrors the existing "stale order entries
are harmless" invariant. **Reads never mutate** (no self-repair on projection).

### B.5 Lifecycle interplay — the key semantic decision

**Recommended: keep the ref, filter by Open.** `set_item_lifecycle` stays a single
map-write and **never touches the focus container** — exactly the discipline the board
adopted for order containers (`data-model.md` "Done / binned items stay in the order
container"). Consequences:

- Done/Binned ⇒ item drops out of Focus view automatically (Open filter). Ref survives
  as garbage.
- **Un-done ⇒ the item reappears in Focus in its former position** (ref survived). This
  is the trade of keep-and-filter. It's consistent with restore-reveals-former-position
  elsewhere, and arguably nice ("this came back"). **Flag for Daniel to confirm.**
- Hard delete ⇒ ref becomes garbage (item lookup fails), GC'd by reconcile.
- Delete-list bins its items ⇒ they drop from Focus automatically. No special handling.

Rejected alternative: auto-remove the focus ref on Done. It couples the most common
mutation to a second container (two-container write), breaks the single-write invariant,
and makes un-done non-restorative. Same reasoning the board used to reject removing order
entries on lifecycle flips.

### B.6 Focus is a flat list, not a board

Focus renders as a single ordered flat list of Open items. You can still flip an item
Live/Done from within it, but there are **no lanes** (no Backlog/Live/Done split, no
board lens). Keep it deliberately minimal — that's the product thesis.

### B.7 Core API surface (`core/src/doc.rs`)

New mutations (each **one Loro commit**):

- `add_to_focus(item_id, index)` — insert a FocusRef at `index` (default append). If the
  item already has a *visible* ref, **no-op** (recommend; don't move-to-top — confirm).
- `remove_from_focus(item_id)` — remove the item's ref(s) from the focus container. Item
  untouched.
- `move_in_focus(item_id, index)` — reorder within Focus (`MovableList::mov`).

Reads:

- `focus_view()` / `focus_refs()` — the projection above.

Maintenance & integrity:

- Extend `reconcile()` to prune focus refs that are missing / done / binned / foreign,
  and to dedup. Idempotent; no-op when clean.
- **`doc_fingerprint` must hash the focus order** — it's logical state (fixes the curated
  order), exactly as it hashes each list's resolved order.

Constants: add `FOCUS_CONTAINER` (`"focus"`) alongside the existing container-name
constants near `LIST_MAIN_NAME`.

### B.8 Events (`core/src/events.rs`)

Add a focus-changed event variant so clients re-project on focus mutations. Check how
per-container diffs are currently surfaced and mirror that. Note: a lifecycle change that
makes a focused item done/binned already emits an item event — the web store must
re-derive `focus_view` on item events too (visibility depends on item lifecycle), not
only on focus-container events.

### B.9 WASM bindings (`core/web/src/lib.rs`)

Expose `add_to_focus`, `remove_from_focus`, `move_in_focus`, and the focus projection
getter. **Note there are two handle structs** in this file (binding surfaces at ~L107 and
~L1236) — add the methods to **both**, mirroring how `move_item` / `set_item_lifecycle`
appear twice. `bun run build:wasm` from the workspace root.

### B.10 FFI + CLI (`core/ffi/src/lib.rs`, `cli/src/`)

Multi-device proof spans CLI ↔ web, so CLI needs parity. Add FFI wrappers and CLI
commands per `spec/cli.md` conventions, e.g.:

- `airday focus` — list the Focus view
- `airday focus add <item>` / `airday focus rm <item>` / `airday focus mv <item> <pos>`

### B.11 Web UI (`js/web`)

The clean extension point: the view model is a discriminated union
`ViewKey = { kind: "list"; id } | { kind: "done" } | { kind: "bin" }` at
**`js/web/src/prefs.ts:19-22`**. Add `{ kind: "focus" }` there; it's persisted to prefs
and owned by `js/web/src/sync/runtime.ts:77-90`, dispatched in `Workspace.tsx` via
`view().kind` branches (e.g. `Workspace.tsx:194-200`, `:406-415`, `:1009-1016`).

- `i18n.tsx` — add a `focus` label (en **and es**). (The `home` → `inbox` key rename is
  Part A.)
- `nav.tsx` — a reserved **Focus** entry alongside the existing static Done (`nav.tsx:436`)
  and Bin (`nav.tsx:449`) entries; the Home/Inbox row is at `nav.tsx:400-410`. Put Focus
  near the top, above user-created lists. Count badge = number of visible refs. (Note:
  the reserved list synthesizes its `ListView` and can't carry an icon — Focus is a
  static nav entry like Done/Bin, not a `ListMeta` row, so give it a fixed icon.) **Make Focus feel finite:**
  a soft signal past ~7–10 items (color shift / subtle "getting big" — not a hard cap).
  Threshold + exact treatment is a UI decision; keep it gentle.
- **Focus view component** — flat ordered list of `focus_view()`; drag-to-reorder
  (reuse the existing DnD infra in `js/web/src/dnd/`); per-row actions: toggle Live,
  mark Done, and **remove-from-focus as a single cheap gesture** (× / swipe). Removing
  must be as frictionless as adding — that's what keeps Focus lean.
- **Add-to-focus affordance** on any item row (`Row.tsx` / item menu / `TaskDialog.tsx`)
  — a pin/star toggle whose state reflects whether the item currently has a visible focus
  ref. Toggling calls `add_to_focus` / `remove_from_focus`.
- `sync/store.ts` — expose the focus projection + mutations; subscribe to focus events
  and re-derive `focus_view` on item events (per B.8).

### B.12 Sync protocol

**No change.** Focus mutations are ordinary Loro ops in the same doc — opaque blobs to
the server. No wire-version bump, no server work.

---

## Part C — Specs to write/update

- **New `spec/focus.md`** (mirror `spec/board.md`'s structure): the Focus lens —
  reference model, FocusRef grammar, projection/visibility rule, lifecycle interplay,
  flat-not-board decision, and the "single tier, no scheduling" product rationale.
- `spec/data-model.md` — add the `focus` container to the layout; FocusRef grammar; focus
  mutations in the mutation-contracts + rust-API sections; fingerprint note; the Inbox
  rename.
- `spec/cli.md` — the `focus` commands.
- Cross-link from `spec/sharing-plan.md` (cross-doc FocusRef is the forward hook).

---

## Phasing (checkpoint with Daniel between phases)

- **Phase 0 — Specs.** Write `spec/focus.md`; update `data-model.md` (focus container +
  FocusRef + mutations + fingerprint); do the Inbox rename across specs. *Checkpoint.*
- **Phase 1 — Core (Rust).** *First:* the Part A `main` → `inbox` stored-id rename
  (const, `order/inbox`, `location`/`OrderEntry` reserved literal, `inbox_name` key +
  `set_inbox_name`, all reserved-id guards) + the import alias for the cutover, so Focus
  builds against `inbox`. *Then Focus:* container constant; FocusRef encode/parse (both
  forms); `add_to_focus` / `remove_from_focus` / `move_in_focus`; `focus_view`; reconcile
  extension; fingerprint; events. Unit tests (rename round-trips; add/remove/reorder,
  dedup, done-evaporates, un-done-reappears, hard-delete GC, concurrent-add convergence,
  fingerprint-includes-focus). `bun run test`. **Land the live-doc cutover at this
  checkpoint** (export → wipe → import). *Checkpoint.*
- **Phase 2 — WASM.** Both handle structs; `bun run build:wasm`.
- **Phase 3 — Web.** i18n, nav Focus entry + count + soft-cap, Focus view component,
  add-to-focus toggle, store + events wiring, Inbox label. Verify in-browser: two tabs,
  DnD reorder converges, done-evaporates, un-done-reappears, remove-keeps-item.
- **Phase 4 — CLI/FFI.** Focus commands + FFI; CLI↔web integration test; fix
  `sync_smoke.rs` assertion.
- **Phase 5 — Verify.** Multi-device convergence, fingerprint parity across CLI/web,
  self-clean-on-done, un-done-reappears. `/verify`.

---

## Open decisions to confirm before/early in Phase 0

1. **Un-done reappears in Focus** (keep-ref-and-filter, B.5) — confirm acceptable.
   *Recommend: yes.*
2. **Adding an already-focused item no-ops** vs moves-to-top (B.7). *Recommend: no-op.*
3. **Schema treated as additive within v2** (no version bump) for the `focus` container
   (B.2). *Recommend: additive.*
4. ~~i18n key `home` → `inbox`~~ **Resolved: full flip including the stored id** —
   `main` → `inbox` everywhere, with a one-time export/wipe/import cutover on the live
   doc (Part A).
5. **Soft-cap threshold** (~7–10) and its visual treatment (B.11). *UI call.*
6. **FocusRef bare-uuid now** vs a `local:` prefix (B.3). *Recommend: bare; parser treats
   colon-less as local.*
</content>
</invoke>

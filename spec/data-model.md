# Data Model

## Loro doc layout

One Loro doc per account.

- `doc.get_movable_list("items")` — `LoroMovableList<LoroMap>` where each map is one Item.
- `doc.get_movable_list("lists")` — `LoroMovableList<LoroMap>` where each map is one ListMeta.

## Item

| Field | Type | Notes |
|---|---|---|
| `text` | string | the user's content |
| `notes` | string | optional richer text; empty string when absent in simple clients |
| `list_id` | string | references `ListMeta.id` |
| `created_at` | i64 | unix millis (client clock) |
| `done_at` | i64? | set when status → Done |
| `binned_at` | i64? | set when status → Binned |

Item type is implicit (always text in sprint 1). Add an `item_type` field when other kinds appear.

There is no separate persisted `status` field. Visibility is derived from the timestamps:

- live = `done_at == null && binned_at == null`
- done = `done_at != null && binned_at == null`
- binned = `binned_at != null` (an item may have been done earlier and still carry `done_at`)

`Binned` items keep their `list_id` so "restore to original list" works. `Done` items also keep `list_id`. Hard delete (e.g. emptying the bin) removes the Item from the MovableList — Loro handles the tombstone.

## ListMeta

| Field | Type | Notes |
|---|---|---|
| `id` | string | uuid v7 hex; stable, used in `Item.list_id` |
| `name` | string | display name |
| `created_at` | i64 | unix millis |

## Built-in lists

Airday has one reserved primary capture list plus one seeded ordinary list:

- `main` — rendered as "Desk". This id is reserved and addressable by items, but it is not stored as a `ListMeta` row in the `lists` MovableList. For sprint 1 its label is client-defined and it is non-renamable, non-movable, and non-deletable.
- one seeded user-style list named "Later" with a generated id. It is stored like any other `ListMeta` and can later be renamed, moved, or deleted like any user-created list.

The bin is *not* a list; it's the `Binned` status on items.

## Mutations (rust core API surface)

All mutations go through Loro APIs internally; the core exposes typed helpers:

- `add_item(list_id, text) -> ItemId`
- `move_item(item_id, target_list_id, target_index)`
- `set_item_status(item_id, status)` where `status` is the API-level concept `Live | Done | Binned`, implemented by mutating `done_at` / `binned_at`
- `edit_item_text(item_id, text)`
- `add_list(name) -> ListId`
- `rename_list(list_id, name)`
- `delete_list(list_id)` — refuses for `main`; items in the deleted list are reassigned to `main`.
- `empty_bin()` — hard-deletes all `Binned` items.
- `delete_binned(item_id)` — hard-deletes one `Binned` item.

The wire format for ops is whatever Loro emits — opaque bytes from the server's POV.

## Limits

256 lists × 4096 items × 280 chars ≈ 300 MB English / 900 MB CJK. Treat as soft caps for now; enforcement is out of scope sprint 1.

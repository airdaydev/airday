# Data Model

## Loro doc layout

One Loro doc per account.

- `doc.get_movable_list("items")` — `LoroMovableList<LoroMap>` where each map is one Item.
- `doc.get_movable_list("lists")` — `LoroMovableList<LoroMap>` where each map is one ListMeta.
- `doc.get_map("settings")` — `LoroMap` for account-wide synced workspace settings.

## Item

| Field | Type | Notes |
|---|---|---|
| `text` | string | the user's content |
| `notes` | string | optional richer text; empty string when absent in simple clients |
| `list_id` | string | references `ListMeta.id` |
| `created_at` | i64 | unix millis (client clock) |
| `done_at` | i64? | set when status → Done |
| `binned_at` | i64? | set when status → Binned |

Item type is implicit (currently always text). Add an `item_type` field when other kinds appear.

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

Whether the nav shows a live-item count beside each list is governed by a single doc-level flag — see `WorkspaceSettings.show_list_counts`. There is no per-list override; Queue's count is always shown regardless.

## Built-in lists

Airday has one reserved primary capture list:

- `main` — rendered as "Queue". This id is reserved and addressable by items, but it is not stored as a `ListMeta` row in the `lists` MovableList. Its label is currently client-defined and it is non-renamable, non-movable, and non-deletable. Doc-level settings for it live in `settings`.

The bin is *not* a list; it's the `Binned` status on items.

## WorkspaceSettings

Doc-level synced settings that are not owned by any specific `ListMeta`.

| Field | Type | Notes |
|---|---|---|
| `show_list_counts` | bool? | when true, clients render each non-Queue list's live-item count in the nav (subject to a `count > 0` gate). Queue's count is always shown regardless. Absent ≡ false; the mutation deletes the key on the off path so an unset flag leaves no on-disk trace. |
| `main_name` | string? | user-chosen display-name override for the reserved `main` (Queue) list. Absent ≡ no override; clients fall back to the localized built-in label. The mutation deletes the key on empty/whitespace input so an unset override leaves no on-disk trace. |

## Mutations (rust core API surface)

All mutations go through Loro APIs internally; the core exposes typed helpers:

- `add_item(list_id, text) -> ItemId`
- `move_item(item_id, target_list_id, target_index)`
- `set_item_status(item_id, status)` where `status` is the API-level concept `Live | Done | Binned`, implemented by mutating `done_at` / `binned_at`
- `edit_item_text(item_id, text)`
- `add_list(name) -> ListId`
- `rename_list(list_id, name)`
- `set_show_list_counts(show)` — toggles the doc-level "show counts on non-Queue lists" flag. Queue's count is always visible (subject to count > 0) and is not gated by this.
- `set_main_name(name)` — sets or clears the reserved `main` (Queue) list's display-name override in the doc-level `settings` map. Trims input; an empty trimmed string clears the override.
- `delete_list(list_id)` — refuses for `main`; items in the deleted list are reassigned to `main`.
- `empty_bin()` — hard-deletes all `Binned` items.
- `delete_binned(item_id)` — hard-deletes one `Binned` item.

The wire format for ops is whatever Loro emits — opaque bytes from the server's POV.

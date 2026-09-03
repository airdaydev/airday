# URLs

Shareable, bookmarkable addresses for items, lists and the built-in
views. Web client only for now; the token grammar is client-agnostic so
the CLI and future native clients can accept and print the same strings.

## Grammar

The whole address lives in the URL fragment. One self-describing token:

```
url    = <origin> <path> "#" token
token  = "item_" id | "list_" id | "inbox" | "focus" | "upcoming" | "done" | "bin"
id     = [0-9a-f]{32}          -- uuid-v7 hex, same as ItemId / ListMeta.id
```

`#list_inbox` is accepted as an alias and canonicalised to `#inbox`.
Anything else is ignored: the client keeps whatever it was showing.
There is no `#home`: a bare URL (no fragment) restores the last view
from local prefs, as before URLs existed.

## Why the fragment

- **The server learns nothing.** Item and list ids only ever exist
  inside encrypted op blobs. A path URL would put them in access logs
  for the first time; a fragment never leaves the browser. This keeps
  the "server is dumb" property (`spec/architecture.md`) intact.
- **No server route.** `web.rs` serves `/` and a flat set of files. The
  fragment needs nothing new and works cold on a fresh device, before
  the PWA service worker fallback (`spec/pwa-plan.md`) exists.
- **Trivial to migrate.** A native deep link (`airday://item_<id>`) or
  a future path scheme carries the identical token.

## Why not Loro container ids

Loro addresses a child container as `<counter>@<peer>`: peer-relative,
opaque, and it would leak the creating device's peer id into every
link. The uuid keys in `items` / `lists` are the stable public identity
by design (`spec/data-model.md`).

## Item URLs name only the item

`#item_<id>` carries no list and no doc. uuid-v7 is globally unique, so
the client resolves the id by lookup and the link survives the item
moving between lists (and, once sharing lands, between docs: the
client will search every loaded doc, which it must hold anyway for
cross-doc Focus refs, `spec/focus.md`). A `doc_id` on the wire is a
routing key, never identity (`spec/sharing-plan.md`).

## Resolution (web)

Opening `#item_<id>`:

1. Look the id up in the store. If found, navigate to the view that
   shows it (Bin if binned, Done if done, else its home list; an
   archived home list still resolves) and open the item.
2. If not found, hold the id as *pending* and retry on every store
   change until the user navigates elsewhere. This covers a link
   opened on a device that hasn't synced the item yet. Nothing is
   shown for a pending id; a permanently deleted item simply lands
   the user on their restored view.

Opening `#list_<id>` for an unknown list is ignored.

## Address bar mirroring

The address bar always reflects `(view, openItem)`: an open item wins,
so the URL is `#item_<id>` while an item is open and the view's token
otherwise. Board vs list mode, lane visibility and the side-panel
state are prefs, not URL state: the URL names *what*, prefs name *how*.

History entries:

- A view change pushes an entry.
- An explicit item open (row open, Enter, a Find pick, a link) pushes
  one entry, so Back closes the item. Switching from one open item to
  another replaces it. Selection-driven passive opens (the side panel
  following the list selection) only replace, so arrowing through a
  list never grows history.
- Closing the item replaces the entry with the view's token.
- Boot writes the initial hash with a replace, never a push.

Back / Forward and hand-edited hashes apply the route the same way a
pasted link does.

## Affordances

- "Copy link" in the item dialog menu (available for binned items too),
  the row context menu (one link per line for a multi-selection), and
  the list context menu in the nav.
- Notes and titles linkify http(s) URLs. A link to this app's own
  origin and path whose hash parses is rendered as an internal link:
  a plain click applies the route in place instead of opening a tab.
  This is the item-to-item reference mechanism; there is no reference
  field in the data model.

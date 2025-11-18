# Air Roadmap

## 2025 Q3-4 Working Alpha Prototype Sqlite
- [] ensure incoming sync ops construct new objects (or maybe snapshots are required hm?!) and persist (see websocket/index.ts) - in batches (easier to use batch from server initially) (started, unfuck this flow)
- [] no valid ops found in batch (rust side) send test from js (off-by-1)
- [] explicit test to catch off-by-one for streams etc
- [] analyse catch up stream api (limits via mpsc + select! + registers)
- [] server metric endpoint
- [] delete items (tombstones, same api)
- [] snapshot api
- [] Probably a good idea: The merge needs to be monotonic from the last seen timestamp, not just the last generated
- [] airday type materialisation with reactivity
- [] fan out sync ops to all subscribers per library
- [] ensure inbox is the default, immutable list
- [] @airday/core - create & update lists
- [] @airday/core - delete lists
- [] @airday/core - create subitems / sequence
- [] remap initial local library to new on sign up (LATER - OPTIONAL - otherwise keep the anonymous account active)
- [] Glue core to app
- [] UI - Create items
- [] UI - Update items
- [] UI - Delete items
- [] UI - Settings
- [] UI - Kanban
- [] @airday/core - repeat tasks
- [] @airday/core - repeat tasks (shuffle)?
- [] Item List UI - build & respect fractional indexing system
- [] Nav List UI - build & respect fractional indexing system
- [] @airday/core - tracing fixes
- [] get all libraries
- [] handling browser tabs?!
- [] cors review
- [] Postgresql adapter with personal library setup on account creation
- [] consider migrating to change seq version # now - for postgresql adapter...? - investigate can current version interop with postgresql version?
- [] payload encryption
- [] Message bus for fanning out incl. cache busting on postgres version
- [] Benchmarking https://github.com/bheisler/criterion.rs
- [] TODO: more cohesive error messaging system for websockets
- [] protection against future dates being encoded in LWWRegisters
- [] enforce batch size limits

# Sync verification plan
- [] Reconsider how to index merkle tree
- [] Node index should be based on id or created time (what timestamp?)
- [] tree saved in a hashmap & serialised (maybe not necessary in JS if it's fast enough to booststrap - big if) - good idea in sqlite?
- [] hot path = server time-1hr?
- [] day granularity until 1hr ago (server time)
- [] clean-ups required! in-binary job on community version..?
- [] Calculate hashes within sqlite statement? or in application?
- [] On front-end, keep live hash structure that persists on update... probably need same for server-side.
- [] Sync client gets pushed year hashes on every connect + changes since last server timestamp (oh-oh but these are not monotonic across servers - minus drift buffer hack?)
- [] What happens client-side when an update is unauthorised..?

# Span issues!
- [] send back span from server
- [] invalid parent span ids
- [] negative duration spans from airday_js

## Protocol improvements (l8a)
- [] create versioning plan
- [] get js client sync together, then swap out to rust-wasm version after learning wasm
- [] consider smarter batch sizing with size limits

## Done board
- [] Done board show which list item was from
- [] Done board show month heading?
- [] Done board chronological index

## Fixes
- [] Canvas doesn't render constantly (todo list)
- [] Canvas bg resets WHENEVER container size changes (change made for list but component needs rebuilding)
- [] Editing text inline cursor set correctly
- [] Paste into app (strip `- []`)
- [] Dragging out of Done should undo its done start
- [] When items get deleted, ensure no latent references in selection sets, focus etc
- [] Manually define height of list section (by dragging)
- [] item links
- [] Clicking on a list in nav - look for existing list view before creating a new one
- [] tooltip for closing a window that shows kb shortcut
- [] tree backed indexing system to move between panes with numbers
- [] host front-end on cloudflare pages initially (air-private + opentofu)
- [] consider a flash or something more obvious when switching panes
- [] Deselect nav bar items when leaving focus
- [] list switcher to switch between open files (opt+tab)
- [] Context click on list header
- [] touch swipe gesture left /right to hide + show sidebar
- [] Test if drag limit is below or above diagontstrap - big if) - good idea in sqlite?
- [] hot path = server time-1hr?
- [] day granularity until 1hr ago (server time)
- [] clean-ups required! in-binary job on community version..?
- [] Calculate hashes within sqlite statement? or in application?
- [] On front-end, keep live hash structure that persists on update... probably need same for server-side.
- [] Sync client gets pushed year hashes on every connect + changes since last server timestamp (oh-oh but these are not monotonic across servers - minus drift buffer hack?)al line on hover!
- [] on context click of nav item, select the list
- [] Reevaluate keyboard + focus system (start with pen/paper or notes)
- [] drag sidebar to resize
- [] add initial habit item
- [] open performance list, add filters/configuration
- [] Limit open lists, ensure destruction
- [] Drag list headers to drag & drop open views (closing the existing view in favour!)
- [] Next board (referenced items!)
- [] Drag items into list nav
- [] Performance board
- [] Pin views (arrangements of panes) - after trying out workspaces (they suck) pin may be useful
- [] Protection against sending the same resource in a single update?

## Frontend Lifecycle
- [] Add entire history of Done items chronology
- [] Trash items (yes & ability to remove)
- [] Empty trash i.e. tombstone
- [] Delete containers
- [] Repeat items
- [] Series
- [] Filter for habit tracking with sorting (worst/best)
- [] When dragging while holding down command, duplicate
- [] Add search (flexsearch?)
- [] Persist views (per device)
- [] Handle loader validation failure, types

## UI
- [] Drag stack make it nice - add next two items + total count
- [] Copy and paste many items, from csv, etc
- [] Copy as JSON, CSV, Markdown, text, rich text etc
- [] Rename container within sidenav
- [] Ensure selection is cleared on edit
- [] Edit selected items via 'enter' key (vim?)
- [] Context menu for many items
- [] Timeline index
- [] Drag divider to change view size!
- [] Update focus mode to be a floating pomodoro timer that can maximise, without the corny hold to end
- [] Nice empty list states
- [] Weekly roll-over view

## Stickers
- [] Consider less abstract stickers (create sets with AI? artists?)
- [] Remove many stickers
- [] Reinstate sticker system
- [] First full sticker set (llm based? or artist)
- [] Dynamic storage
- [] Custom stickers

## Sync/Data structure
- [] Create Tiered e2ee key plan. tierd? for most text i.e. on-server encrypted key vs off-server key option (probably need on-server encryption... idk revisit this)
- [] Undo/redo... in general, save granular outcomes & apply them

## Predeploy, meta app
- [] API abuse mitigation / define limits
- [] Verify keyboard only, accessibility
- [] PWA update strategy

## Bugs?
- [] can't multiselect nav due to automatically activating pane on list open
- [] moving solo list item should not count as a click! e.g. try to move it into a dead zone
- [] Maybe: show active pane border highlighted, then fade
- [] Deal with merge issue with advanced foreign / late local clock by 1) restricting valid times 2) on local update, also refer to locally stored time

---

# FUTURE GOALS FOR AIRDAY

## Sync engine extraction
- [] generate typescript type ints from Rust (l8a?)
- [] Develop procmacros once initial use case is proven

## Multilingual goals
- [] Spanish (EU) localisation
- [] Japanese localisation
- [] Korean localisation

## Multiplatform goals
- [] PWA
- [] Rust core
- [] Native iOS release
- [] Native Android release
- [] MacOS or native Tauri release (?)
- [] Linux Tauri (or other) release (?)

## Features
- [] @airday/core - export database to json
- [] CalDAV bridge! (pull from event type - as opposed to event_encrypted type!)
- [] User switching
- [] List cal view
- [] Monthly cal view
- [] Annual cal view
- [] Markdown descriptions
- [] Text CRDT (text_snapshot, text_id) fields - linked via link_id
- [] Custom fields
- [] JSON export
- [] Shared libraries (Enforce library limits (3 per user?))
- [] Locations/Map?
- [] voice notes
- [] Experiment with sounds (e.g. speaking llm prompts)
- [] Print styles
- [] LLM Prompting / MCP
- [] qwen3-1.7B exploration
- [] Consider jmap calendar support

## References/notes/things to try
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- https://alexharri.com/blog/clipboard
- https://developer.mozilla.org/en-US/docs/Web/Manifest/share_target pwa share target

## Fractional indexing
- https://observablehq.com/@dgreensp/implementing-fractional-indexing
- www.figma.com/blog/realtime-editing-of-ordered-sequences/

## Optimisations
- Flatbuffer in flatbuffer for predictable sync engine user types (instead of current "AttributeProto")

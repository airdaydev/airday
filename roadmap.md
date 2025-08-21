# Air Roadmap

## 2025 Q3-4 Working Alpha Prototype Sqlite
- [] continue cleanup of sync - start with merge definitions on the attributes themselves always have to make sure the item type matches!? - consider doing everything in the match block
- [] unify in-memory list & persistent idb list
- [] add subscription to in-memory list to core
- [] complete get items since streaming api
- [] attribute level change sets (ensure sync respects dirty set)
- [] delete items (tombstones, same api)
- [] fan out live updates - maintain local library subscription map for sqlite version
- [] Merge attribute macro and/or hashmap on server side! (Start with list attribute)
- [] inbox = default = virtual list! (where orphans go too!)
- [] @airday/core - create & update lists
- [] @airday/core - delete lists
- [] @airday/core - create subitems / sequence
- [] remap initial local library to new on sign up (LATER - OPTIONAL - otherwise keep the anonymous account active)
- [] GLUE CORE TO APP!!
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
- [] Add license https://mariadb.com/bsl-faq-adopting/
- [] Consider AGPL-3.0
- [] Put up website
- [] get all libraries
- [] handling browser tabs?!
- [] cors review
- [] Postgresql adapter with personal library setup on account creation
- [] consider migrating to change seq version # now - for postgresql adapter...? - investigate can current version interop with postgresql version?
- [] Text encryption
- [] Message bus for fanning out incl. cache busting on postgres version
- [] Benchmarking https://github.com/bheisler/criterion.rs
- [] TODO: more cohesive error messaging system for websockets
- [] protection against future dates being encoded in LWWRegisters
- [] Indexing for server_seq
```sql
CREATE INDEX IF NOT EXISTS item_lib_updated ON item(library_id, server_seq DESC);
SELECT server_seq FROM item WHERE library_id = ? ORDER BY server_seq DESC, id DESC LIMIT 1;
```

# Sync verification
- [] Node index should be based on id or created time (what timestamp?)
- [] tree saved in a hashmap & serialised (maybe not necessary in JS if it's fast enough to booststrap - big if) - good idea in sqlite?
- [] hot path = server time-1hr?
- [] day granularity until 1hr ago (server time)
- [] clean-ups required! in-binary job on community version..?
- [] Calculate hashes within sqlite statement? or in application?
- [] On front-end, keep live hash structure that persists on update... probably need same for server-side.
- [] Sync client gets pushed year hashes on every connect + changes since last server timestamp (oh-oh but these are not monotonic across servers - minus drift buffer hack?)

# Span issues!
- [] send back span from server
- [] invalid parent span ids
- [] negative duration spans from airday_js

## Protocol improvements (l8a)
- [] create versioning plan

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
- [] Test if drag limit is below or above diagonal line on hover!
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
- [] Friends alpha and testing
- [] PWA update strategy
- [] optionally enable magic login with email
- [] Paid web service with introductory prices
- [] web app @ air.day/app
- [] BSL vs AGPL?

## Marketing, community
- [] Website (Astro) + waitlist
- [] Consider https://form-data.com/ for backend form (or just vibecode some bullshit)
- [] Consider Zulip/matrix+element/discord (chat)
- [] Consider https://motion.dev/ (Animation library)
- [] Consider https://www.screen.studio/ (Screen recordings)
- [] Consider https://forwardemail.net/en/private-business-email?pricing=true#enhanced
- Pricing https://scastiel.dev/implement-ppp-fair-pricing-for-your-product
- Pricing https://www.principlesofpricing.com/the-customer

## Bugs?
- [] can't multiselect nav due to automatically activating pane on list open
- [] moving solo list item should not count as a click! e.g. try to move it into a dead zone
- [] Maybe: show active pane border highlighted, then fade

## Production phase 1:
- Postgresql single-region cluster (can I upgrade later without downtime?)
- 3 nodes with docker swarm or nomad in Australia
- lb to any node, some sort of health indicator so lb can stop routing to dead nodes
- users can be in conceptually the same room but in different regions, thus message broker must exist between ws servers, redis streams is fine.

---

# FUTURE GOALS FOR AIRDAY

## Multilingual goals
- [] Spanish (EU) localisation
- [] Japanese localisation
- [] Korean localisation

## Multiplatform goals
- [] PWA
- [] Rust core
- [] Native iOS release
- [] Native Android release
- [] Linux Tauri release (?)
- [] MacOS Tauri release (?)

## Features
- [] @airday/core - export database to json
- [] CalDAV support
- [] User switching
- [] List cal view
- [] Monthly cal view
- [] Annual cal view
- [] Markdown descriptions
- [] Collaborative text fields
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

## Multi-region goals:
- Postgresql multi-region cluster (write in US) (no sharding necessary)
- 1+ websocket server per region

## References/notes/things to try
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- https://alexharri.com/blog/clipboard
- https://developer.mozilla.org/en-US/docs/Web/Manifest/share_target pwa share target

## Fractional indexing
- https://observablehq.com/@dgreensp/implementing-fractional-indexing
- www.figma.com/blog/realtime-editing-of-ordered-sequences/

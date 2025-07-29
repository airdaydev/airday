# Air Roadmap

## 2025 Q3 Working Alpha Prototype Sqlite
- [] add in memory list to core (or at least API to keep updated! will need solid compatibility)
- [] merge item api (send a bunch of items to the server & save)
- [] inbox = default = virtual list! (where orphans go too!)
- [] remap initial local library to new on sign up!
- [] Compute unsynced deltas on load (track last sync) (coarse at first)
- [] get items since last sync (server clock skew between restarts?! persist to ensure monotonicity? clock skew BETWEEN SERVERS think about)
- [] delete items
- [] complete, but then reconsider workspaces
- [] @airday/core - create & update lists
- [] @airday/core - delete lists
- [] SYNC CLEAN UP before continuing
- [] @airday/core - create subitems / sequence
- [] @airday/core - repeat tasks
- [] @airday/core - repeat tasks (shuffle)?
- [] @airday/core - make an element-set crdt for
- [] deal with orphaned items (no list reference found - they just show up in the bin! - slightly weird as there's no put back opt, also a partially synced move could push items into the bin erroneously)
- [] UI - Create items
- [] UI - Update items
- [] UI - Delete items
- [] UI - Settings
- [] UI - Spanish
- [] UI - Kanban
- [] Robust dummy data system
- [] Item List UI - build & respect fractional indexing system
- [] Nav List UI - build & respect fractional indexing system
- [] @airday/core - tracing
- [] Add license https://mariadb.com/bsl-faq-adopting/
- [] Put up website
- [] get all libraries
- [] handling browser tabs?!

## Protocol improvements (l8a)
- [] contemplate removal of airday batch messaging system in favour of single action messages - allows generic batching later, when required (batches vs domain-specific batching actions?)
- [] version numbers?
- [] first byte to determine message type (allow separate flatbuffer definitions)

## Done board
- [] Done board show which list item was from
- [] Done board show month heading?
- [] Done board chronological index

## 2025 Q4 Initial Release
- [] @airday/core - export database to flatbuffer
- [] Postgresql adapter with personal library setup on account creation
- [] Text encryption
- [] Shared lists

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
- [] Save views (arrangements of panes)
- [] Print styles
- [] Locations/Map?

## Frontend Lifecycle
- [] Add entire history of Done items chronology
- [] Trash items (yes & ability to remove)
- [] Empty trash
- [] Delete containers
- [] Repeat items
- [] Series
- [] Filter for habit tracking with sorting (worst/best)
- [] When dragging while holding down command, duplicate
- [] Add search
- [] Persist views (per device)
- [] Handle loader validation failure, types
- [] Remove SVGs from JS or at least include in diff bundle

## UI
- [] voice notes
- [] Drag stack make it nice - add next two items + total count
- [] Copy and paste many items, from csv, etc
- [] Copy as JSON, CSV, Markdown, text, rich text etc
- [] Show completed item in og list for 5 seconds before disappearing (progress bar follows checkbox border)
- [] Rename container in sidenav
- [] Ensure selection is cleared on edit
- [] Edit selected items via 'enter' key (vim?)
- [] Context menu for many items
- [] Timeline index
- [] Drag divider to change view size!
- [] Focus mode (design)
- [] Nice empty list states
- [] Reconsider split view, maybe do horizontal only

## Stickers
- [x] Sticker system
- [] Consider less abstract stickers (create sets with AI? artists?)
- [] Remove many stickers
- [] Reinstate sticker system
- [] First full sticker set (llm based? or artist)
- [] Dynamic storage
- [] Custom stickers

## Sync/Data structure
- [] Build todo list sync
- [] Tiered e2ee for most text i.e. on-server encrypted key vs off-server key option (probably need on-server encryption... idk revisit this)
- [] Undo/redo... in general, save granular outcomes & apply them
- [] Multiple users / tenancy is accounted for

## Calendar
- [] Full jmap calendar support
- [] CalDAV support

## Predeploy, meta app
- [] Verify keyboard only, accessibility
- [] Friends alpha and testing
- [] PWA update strategy
- [] Automated testing story
- [] optionally disabled magic login with email
- [] Paid web service with introductory prices
- [] Opens immediately into application, landing page at air.day/about
- [] Consider license type for copyleft (reselling no)
- [] Custom Themes / compact mode
- [] Spanish (EU) localisation
- [] Japanese localisation
- [] Korean localisation

## Marketing, community
- [] Website (Astro)
- [] Consider https://form-data.com/ for backend form (or just vibecode some bullshit)
- [] Consider Zulip/matrix+element/discord (chat)
- [] Consider https://motion.dev/ (Animation library)
- [] Consider https://www.screen.studio/ (Screen recordings)
- [] Consider https://forwardemail.net/en/private-business-email?pricing=true#enhanced
- Pricing https://scastiel.dev/implement-ppp-fair-pricing-for-your-product
- Pricing https://www.principlesofpricing.com/the-customer

## Multiplatform
- [] PWA
- [] Linux Tauri release
- [] MacOS Tauri release
- [] Native iOS release
- [] Native Android release
- [] Explore Webview for cal as partial fallback

## Future goals
- [x] List animations (v1)
- [x] Canvas list
- [] UI - Japanese
- [] Experiment with sounds (e.g. speaking llm prompts)
- [] List cal view
- [] Monthly cal view
- [] Annual cal view
- [] Kanban board
- [] Webgl shadows/pickup
- [] Markdown descriptions
- [] LLM Prompting / MCP
- [] Secrets
- [] Custom fields
- [] JSON export
- [] consider flexsearch

## Bugs?
- [] can't multiselect nav due to automatically activating pane on list open
- [] moving solo list item should not count as a click! e.g. try to move it into a dead zone
- [] Maybe: show active pane border highlighted, then fade

## Reliability
Attribute-level CRDTs but not on object collections and potentially unreliable websocket message dissemination means things can still go out of sync. Checksums, state token count checks (that may include checksum, counts and timestamps), age-based resyncs, list-independence natural shards and smaller more incremental checks.

## Production phase 1:
- Postgresql single-region cluster (can I upgrade later without downtime?)
- 3 nodes with docker swarm or nomad in Australia
- lb to any node, some sort of health indicator so lb can stop routing to dead nodes
- users can be in conceptually the same room but in different regions, thus message broker must exist between ws servers, redis streams is fine.

## Production part 2:
- Postgresql multi-region cluster (write in US) (no sharding necessary)
- 1+ websocket server per region

## References/notes/things to try
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- https://alexharri.com/blog/clipboard
- https://developer.mozilla.org/en-US/docs/Web/Manifest/share_target pwa share target

## Fractional indexing
- https://observablehq.com/@dgreensp/implementing-fractional-indexing
- www.figma.com/blog/realtime-editing-of-ordered-sequences/

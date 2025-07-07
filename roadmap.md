# Air Roadmap

## Next
- [] Canvas doesn't render constantly (todo list)
- [] Canvas bg resets WHENEVER container size changes (change made for list but component needs rebuilding)
- [] Editing text inline cursor set correctly
- [] Deleting items
- [] Add new item
- [] Paste into app (strip `- []`)
- [] Save/Load to JSON
- [] Dragging out of Done should undo its done start
- [] Dummy data - done items with varied dates over last 2 years (after import/export)
- [] When items get deleted, ensure no latent references in selection sets, focus etc
- [] Done board show from list
- [] Done board month headings
- [] Done board chronological index
- [] Manually define height of list section (by dragging)
- [] indexing system for nav
- [] Remove many stickers
- [] item links
- [] Location/map
- [] Clicking on a list in nav - look for existing list view before creating a new one
- [] tooltip for closing a window that shows kb shortcut
- [] tree backed indexing system to move between panes with numbers
- [] host front-end on cloudflare pages initially (air-private + opentofu)
- [] consider a flash or something more obvious when switching panes
- [] Deselect nav bar items when leaving focus
- [ ] list switcher to switch between open files (opt+tab)
- [ ] empty list state nice
- [ ] Context click on list header
- [ ] touch swipe gesture left /right to hide + show sidebar
- [ ] Test if drag limit is below or above diagonal line on hover!
- [ ] on context click of nav item, select the list
- [ ] Reevaluate keyboard + focus system (start with pen/paper or notes)
- [ ] drag sidebar to resize
- [ ] add initial habit item
- [ ] open performance list, add filters/configuration
- [ ] open priority list (added by reference, no move!)
- [ ] Limit open lists, ensure destruction
- [] Drag list headers to drag & drop open views (closing the existing view in favour!)
- [] Next board (referenced items)
- [] Drag items into list nav
- [] Repetitive tasks (shuffle)
- [] Repetitive tasks (in order)
- [] Sequences (one offs, projects)
- [] Performance board
- [] Begin back-end
- [] Shared lists?
- [] Loading pane
- [] Save views (arrangements of panes)
- [] Print styles
- [] group lists (one level)
- [] subitems (one level)
- [] Locations/Map?

## Frontend Lifecycle
- [] Add entire history of Done items chronology
- [] Workspace i.e. account management
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
- [x] Context menus should not go past edge of screen (flipped)
- [x] List should scroll up as you drag up
- [x] Dark mode
- [x] Autoscroll when dragging items at bottom/top of list
- [x] Command+up/down keyboard resorts
- [x] Context menu for one item
- [x] Clear selection on 'esc' key (vim?)
- [x] Show date finished on completed items
- [] voice notes
- [] Drag stack make it nice - add next two items + total count
- [] Copy and paste many items, from csv, etc
- [] Copy as JSON, CSV, Markdown, text, rich text etc
- Rich text https://docs.slatejs.org/ ?
- [] Show completed item in og list for 5 seconds before disappearing (progress bar follows checkbox border)
- [] Rename container in sidenav
- [] Ensure selection is cleared on edit
- [] Edit selected items via 'enter' key (vim?)
- [] List loading animation
- [] Context menu for many items
- [] Timeline index
- [] Add now playing (ref list) list, allow dragging items to now playing list
- [] Drag divider to change view size
- [] Focus mode (design)
- [] Nice empty list states
- [] Export data markdown, json, csv
- [] Import markdown, json, things 3 etc
- [] Reconsider split view, explore multi-windows, tabs

## Stickers
- [x] Sticker system
- [] Reinstate sticker system
- [] First full sticker set (llm based? or artist)
- [] Dynamic storage
- [] Custom stickers

## Sync/Data structure
- [x] Build & evaluate CRDT prototypes
- [] Build todo list sync
- [] Tiered e2ee for most text
- [] Undo/redo... in general, save granular outcomes & apply them
- [] Multiple users / tenancy is accounted for
- [] Full jmap calendar support
- [] CalDAV support

## Predeploy, meta app
- [] Verify keyboard only, accessibility
- [] Friends alpha and testing
- [] PWA update strategy
- [] Automated testing story
- [] Paid web service with introductory prices
- [] Opens immediately into application, landing page at air.day/about
- [] Consider license type for copyleft (reselling no)
- [] Custom Themes / compact mode
- [] Spanish (EU) localisation
- [] Japanese localisation
- [] Korean localisation

## Marketing, community
- [] Website (Astro)
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
- [] consider flexsearch

## Server
- e2e tests could run on server with different port so we can run a dev server at the same time
- protobuf/similar comms

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

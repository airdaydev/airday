# Sunlist Roadmap

## 2024 Q3
- [x] Bring back item view
- [x] New drag/drop list for list view
- [x] Clean up list dnd CSS
- [x] Clean up list dnd backdrop
- [x] list nav dnd
- [x] restore items
- [x] restore list header (might need upstream push to list component!)
- [x] center checkbox
- [x] make dragged item have rounded corners
- [x] fix bug - status bar sits ontop of lists!
- [x] active list highlight differs from non-active
- [x] accurate 0 items of x selected text
- [x] Columns prototype
- [x] Drag to create new column/row (track to ensure limits)
- [x] Recursive views to completion
- [x] moving down with nothing selected should start at top of list
- [x] moving up with nothing selected should start at bottom of list
- [x] fix origin node clearing on selecting existing range bug
- [x] Dropping changes active view
- [x] opening changes active view
- [x] Fix bug: splitting down, right, close creates an empty container view
- [x] opening a list from sidebar replaces active view
- [x] highlight open list in nav bar
- [x] don't double up focus between sidebar and main panes
- [x] Focus exit is like a gauge that fills up; you have to hold it for 2 seconds!
- [x] Bug: jumping into focus & out, then opening a list crashes!
- [x] store check information (done or not?)
- [x] Default view is inbox
- [x] keyboard shortcut for closing a list
- [x] attempt to reselect item when leaving focus mode
- [x] Done item: Don't allow movement within or to a particular list
- [x] allow done items to hack into existing list dnd context
- [x] Reinstate Done board
- [x] Done items should appear immediately in done list
- [x] Prevent keyboard moving items on Done list
- [x] Done items should not be pulled into normal lists
- [] can't multiselect nav
- [] group lists (one level)
- [] When items get deleted, ensure no latent references in selection sets, focus etc
- [] Done items should not pull into normal lists (but we may still need to keep track of which list it was from - crdt can give us this... but we will need to get it in front-end as "previousList" or something)
- [] Dragging out of Done should undo its done start
- [] Done board month headings
- [] Done board chronological index
- [] indexing system for nav
- [] justChecked timer needs to be queued so you can keep selecting shit without it disappearing on you!
- [] tooltip for closing a window that shows kb shortcut
- [] tree backed indexing system to move between panes with numbers
- [] host front-end on cloudflare pages initially (sunlist-private + opentofu)
- [] Deselect nav bar items when leaving focus
- [ ] closing a list focuses on the previous list item
- [ ] list switcher to switch between open files (opt+tab)
- [ ] empty list state nice
- [ ] Context click on list header
- [ ] touch swipe gesture left /right to hide + show sidebar
- [ ] Test if drag limit is below or above diagonal line on hover!
- [ ] on context click of nav item, select the list
- [ ] Reevaluate keyboard + focus system (start with pen/paper or notes)
- [ ] drag sidebar to resize
- [ ] sunlist - experiment with sounds
- [ ] add initial habit item
- [ ] open performance list, add filters/configuration
- [ ] open priority list (added by reference, no move!)
- [ ] Limit open lists, ensure destruction
- [] Drag list headers to drag & drop open views (closing the existing view in favour!)
- [] Up Next board
- [] Drag items into list nav
- [] Repetitive tasks (shuffle)
- [] Repetitive tasks (in order)
- [] Sequences (one offs, projects)
- [] Performance board
- [] Begin back-end
- [] Themes incl. Departure Mono
- [] Shared lists
- [] Weekly view
- [] Monthly view
- [] Loading pane
- [] Save views (arrangements of panes)
- [] experiment with sounds
- [] Print styles

## Frontend Lifecycle
- [] Add entire history of Done items chronology
- [] Workspace management
- [] Up Next board (naming?)
- [] Trash items (yes & ability to remove)
- [] Empty trash
- [] Delete containers
- [] Habit items = set target + smiley
- [] Filter for habit tracking with sorting (worst/best)
- [] When dragging while holding down command, duplicate
- [] Add search
- [] Persist views (per device)
- [] Load 200 items at a time
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
- [] Drag stack make it nice - add next two items + total count
- [] Copy and paste many items, from csv, etc
- [] Copy as JSON, CSV, Markdown, text, rich text etc
- Rich text https://docs.slatejs.org/ ?
- [] Show date finished on completed items
- [] Show completed item in og list for 5 seconds before disappearing (progress bar follows checkbox border)
- [] Rename container in sidenav
- [] Toast notification whenever an item disappears from current context e.g. moves to done, or inbox (MAYBE)
- [] Consider https://github.com/csstools/postcss-plugins/tree/main/plugins/postcss-nesting
- [] Ensure selection is cleared on edit
- [] Edit selected items via 'enter' key (vim?)
- [] List loading animation
- [] Change list icons!
- [] Context menu for many items
- [] Timeline index
- [] Add now playing (ref list) list, allow dragging items to now playing list
- [] Drag divider to change view size
- [] Focus mode (design)
- [] Nice empty list states
- [] Export data markdown, json, csv
- [] Import markdown, json, things 3 etc
- [] Split view 4+ ways

## Stickers
- [x] Sticker system
- [] Reinstate sticker system
- [] First full sticker set
- [] Dynamic storage
- [] Custom stickers

## Sync/Data structure
- [] E2EE - consider https://github.com/porridgewithraisins/e2ee.js/
- [] E2EE study - https://cronokirby.com/posts/2021/06/e2e_in_the_browser/
- [] Auth, consider https://next-auth.js.org/
- [] Build & evaluate CRDT prototype for all operations, considering undo/redo for editing, sorting
- [] Undo/redo... in general, save granular outcomes & apply them (consider a changelog or something visible, otherwise just console)
- [] Multiple users / tenancy is accounted for
- [] Client-side encrypted sync server
- [] Persistence strategy (Clickhouse...? Something easier to scale, partitioning should be simple)
- [] CRDT: How will sorting work (see LSEQ - or automerge's implementation)
- [] CRDT: Define all data structures
- [] Update strategy (anticipate changes)
- [] Add new item adds saves item into store

## Predeploy, meta app
- [] Verify keyboard only, accessibility
- [] Friends alpha and testing
- [] PWA update strategy
- [] Automated testing story
- [] Paid web service with introductory prices
- [] Opens immediately into application, landing page at about.sunlist.app
- [] Consider license type for copyleft (reselling no)
- [] Custom Themes / compact mode
- [] Spanish (EU) localisation
- [] Japanese localisation
- [] Korean localisation

## Marketing, community
- [] Website
- [] Consider https://github.com/Linen-dev/linen.dev (chat)
- [] Consider Zulip (chat)
- [] Consider https://motion.dev/ (Animation library)
- [] Consider https://www.screen.studio/ (Screen recordings)
- [] Consider https://forwardemail.net/en/private-business-email?pricing=true#enhanced
- Pricing https://scastiel.dev/implement-ppp-fair-pricing-for-your-product
- Pricing https://www.principlesofpricing.com/the-customer

## Multiplatform
- [] Launch - PWA
- [] See Tauri
- [] MacOS Tauri release
- [] Linux Tauri release
- [] iOS Tauri app POC
- [] Android Tauri app POC
- [] iOS release
- [] Android release
- [] Explore Ionic Capacitor as fallback

## Stretch goals
- [x] List animations (v1)
- [] Kanban board
- [] Canvas list
- [] Webgl list
- [] Markdown descriptions
- [] Pin Lock
- [] Secrets
- [] Code snippets... maybe just ` and ```
- [] Auto plan suggestions/AI story
- [] "It wouldn't be very good for a very long time, but organizing tasks has always felt like a chore and an inaccurate one at that." <- AI conversations about your todos
- [] Natural looking cross outs? Consider tick seed, underline length
- [] Custom fields
- [] consider flexsearch

## References/notes/things to try
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API
- https://keystatic.com/docs/installation-astro
- https://klim.co.nz/buy/soehne/
- https://alexharri.com/blog/clipboard
- https://developer.mozilla.org/en-US/docs/Web/Manifest/share_target pwa share target

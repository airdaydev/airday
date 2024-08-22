# Borde SolidJS Roadmap

## 2024 Q3
- [] Bring back item view
- [] Split view 4+ ways
- [] New drag/drop list for list view
- [] Resort containers
- [] Multi-select containers
- [] Drag items into other list headings
- [] Begin back-end
- [] Shared lists

## Frontend Lifecycle
- [x] Add entire history of Done items chronology (abstract fastlist into flavours (done, up next etc, search))
- [] Don't allow two of the same boards open at the same time
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

## UI
- [x] Context menus should not go past edge of screen (flipped)
- [x] List should scroll up as you drag up
- [x] Dark mode
- [x] Autoscroll when dragging items at bottom/top of list
- [x] Command+up/down keyboard resorts
- [x] Context menu for one item
- [] Drag stack make it nice
- [] Copy and paste many items, from csv, etc
- [] Copy as JSON, CSV, Markdown, text, rich text etc
- Rich text https://docs.slatejs.org/ ?
- [] Show date finished on completed items
- [] Show completed item in og list for 5 seconds before disappearing
- [] Natural looking cross outs? Consider tick seed, underline length
- [] Rename container in sidenav
- [] Toast notification whenever an item disappears from current context e.g. moves to done, or inbox (MAYBE)
- [] Consider https://github.com/csstools/postcss-plugins/tree/main/plugins/postcss-nesting
- [] Ensure selection is cleared on edit
- [] Edit selected items via 'enter' key (vim?)
- [] Clear selection on 'esc' key (vim?)
- [] Allow dropping items in nav bar list yessir
- [] Change list icons!
- [] Context menu for many items
- [] Timeline index
- [] Add now playing (ref list) list, allow dragging items to now playing list
- [] Drag divider to change view size
- [] Focus mode
- [] Nice empty list states
- [] Export data markdown, json, csv
- [] Import markdown, json, things 3 etc
- [] Keyboard only, accessibility

## Stickers
- [x] Sticker system
- [] First full sticker set
- [] Dynamic storage
- [] Custom stickers

## Sync/Data structure
- [] E2EE - consider https://github.com/porridgewithraisins/e2ee.js/
- [] E2EE study - https://cronokirby.com/posts/2021/06/e2e_in_the_browser/
- [] Auth, consider https://next-auth.js.org/
- [] Build & evaluate CRDT prototype for all operations, considering undo/redo for editing, sorting
- [] Undo/redo... in general, save granular outcomes & apply them (consider a changelog or something visible, otherwise just console)
- [] Client-side encrypted sync server
- [] Persistence strategy (Clickhouse...? Something easier to scale, partitioning should be simple)
- [] CRDT: How will sorting work (see LSEQ - or automerge's implementation)
- [] CRDT: Define all data structures
- [] Update strategy (anticipate changes)
- [] Add new item adds saves item into store

## Predeploy, meta app
- [] Help item type for new users - how to pin in Safari on IOS and same with android
- [] Friends alpha and testing
- [] PWA update strategy
- [] Automated testing story
- [] Paid web service with introductory prices
- [] Opens immediately into application, (no landing page?) or landing page at borde.app/help
- [] Consider license type for copyleft (reselling no)
- [] Custom Themes / compact mode
- [] Spanish (EU) localisation
- [] Japanese localisation
- [] Korean localisation
- [] Ensure multiple users / tenancy is accounted for

## Marketing, community
- [] Website
- [] Consider https://codeberg.org/explore/repos
- [] Consider https://github.com/Linen-dev/linen.dev
- [] Consider https://motion.dev/
- [] Videos: https://www.screen.studio/
- Pricing https://scastiel.dev/implement-ppp-fair-pricing-for-your-product
- Pricing https://www.principlesofpricing.com/the-customer

## Desktop strategy
- [] Desktop app https://github.com/tauri-apps/tauri

## Mobile strategy
- [] Launch - PWA
- [] See https://capacitorjs.com/ and Tauri
- [] iOS Ionic Capacitor/Tauri app POC
- [] Android Ionic Capacitor/Tauri app POC
- [] iOS release

## Stretch goals
- [] Markdown descriptions, with TODO sublists
- [] Pin Lock
- [] Kanban board
- [] Secrets
- [] Code snippets
- [x] List animations
- [] "It wouldn't be very good for a very long time, but organizing tasks has always felt like a chore and an inaccurate one at that." <- AI conversations about your todos

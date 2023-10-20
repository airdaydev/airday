# AcmeList SolidJS Roadmap

## Prototype
- [x] Before going any further w/selection mechanism, make the list reactive to item updates, moves & edits. Preferably the selection mechanism attaches to the projection of the list, rather than the list itself
- [x] cmd+a to select all items
- [x] Meta/Alt keyboard navigation
- [x] Shift keyboard navigation
- [x] Shift mouse navigation
- [x] split view
- [x] Edit existing item
- [x] Drag items up and down
- [x] Drag items to other lists
- [x] Prevent list navigation on edit mode
- [x] Prevent list navigation in context menu
- [x] Context menu for list (at mouse cursor)
- [x] Add new container
- [x] Rename container
- [x] Button to delete & refresh db!
- [x] Ability to mark items as done
- [x] Drop to bottom of list when list is not empty but has space below it
- [x] Allow dropping items between open lists directly
- [x] Highlight active list in nav

## Frontend Lifecycle
- [] Add entire history of Done items chronology (abstract fastlist into flavours (done, up next etc, search))
- [] Up Next board
- [] Trash items
- [] Empty trash
- [] Delete containers
- [] Add new item adds saves item into store
- [] Habit items = set target + smiley
- [] Filter for habit tracking with sorting (worst/best)
- [] Resort containers
- [] Multi-select containers
- [] When dragging while holding down command, duplicate
- [] Add search

## UI
- [] List should scroll up as you drag up
- [] Item in shadow copy of same list should update as you complete update!
- [] Natural looking cross outs? Consider tick seed, underline length
- [] Rename container in sidenav
- [] Implement keyboard undefined behaviour - deselecting origin and trying to shift
- [] Shifting up/down and deselecting doesn't move viewport when deselecting
- [] regression: shift + click with nothing selected
- [] Dark mode
- [] Toast notification whenever an item disappears from current context e.g. moves to done, or inbox
- [] Consider https://github.com/csstools/postcss-plugins/tree/main/plugins/postcss-nesting
- [] Autoscroll when dragging items at bottom/top of list
- [] Ensure selection is cleared on edit 
- [] Edit selected items via 'enter' key
- [] Clear selection on 'esc' key
- [] Command+up/down keyboard resorts
- [] Allow dropping items in nav bar list
- [] Change list icons
- [] Drag stack make it nice
- [] Context menu for one item
- [] Context menu for many items
- [] Timeline index (GL?)
- [] Add now playing list, allow dragging items to now playing list
- [] Drag divider to change view size
- [] Nice empty list states
- [] Export data (JSON, excel, markdown)
- [] Keyboard only, accessibility

## Stickers
- [] Sticker system

## Sync/Data structure
- [] Build & evaluate CRDT prototype for all operations, considering undo/redo for editing, sorting
- [] Undo/redo... in general, save granular outcomes & apply them (consider a changelog or something visible, otherwise just console)
- [] Client-side encrypted sync server
- [] Persistence strategy (Clickhouse...? Something easier to scale, partitioning should be simple)
- [] CRDT: How will sorting work
- [] CRDT: Define all data structures
- [] Update strategy (anticipate changes)

## Predeploy, meta app
- [] Help item type for new users - how to pin in Safari on IOS and same with android
- [] Friends alpha and testing
- [] Mobile web strategy (PWA)
- [] PWA update strategy
- [] Automated testing story
- [] Paid web service with introductory prices
- [] Opens immediately into application, (no landing page?) or landing page at acmelist.com/help
- [] Consider license type for copyleft (reselling no)
- [] Custom Themes / compact mode
- [] Spanish (EU) localisation
- [] Japanese localisation
- [] Ensure multiple users / tenancy is accounted for

## Marketing, community
- [] Website
- [] Consider https://codeberg.org/explore/repos
- [] Consider https://github.com/Linen-dev/linen.dev
- [] Consider https://motion.dev/
- Pricing https://scastiel.dev/implement-ppp-fair-pricing-for-your-product
- Pricing https://www.principlesofpricing.com/the-customer

## Stretch goals
- [] Markdown descriptions, with TODO sublists
- [] Desktop app https://github.com/tauri-apps/tauri
- [] Optional encrypted server
- [] Lock
- [] Mobile native app strategy
- [] Kanban board
- [] Secrets
- [] List animations
- [] Board prototype (canvas/webgl)

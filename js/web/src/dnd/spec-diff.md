NOTE: This is an LLM generated file with fixes that were required from initial generation

## Nudge

During a drag, if `nudge` is enabled, the remaining (non-dragged) items shift down to open a gap at the cursor position, giving visual feedback of where the drop will land.
- **Critical:** dragged items are visually hidden during drag. The remaining items are laid out contiguously — there are no empty slots where dragged items used to be. All hover-index and positioning math must operate in this **collapsed coordinate space**, not the original order.

Let `filtered` = the ordered list with all dragged keys removed. Then:
- `nonDragCount = filtered.length`
- Each non-dragged item's base position: `visualIdx * itemHeight`, where `visualIdx` is its index within `filtered`.

### hoverIndex calculation

`hoverIndex` is a slot index in the collapsed space representing where the gap should open.

```
y = mouseY - parentRect.top + scrollTop
hoverIndex = clamp(floor(y / itemHeight), 0, nonDragCount)
```

This directly divides the mouse Y by item height — no mapping through the original order. The max is `nonDragCount` (not `nonDragCount - 1`) to allow dropping at the very end.

### Applying nudge offsets

For each non-dragged item with `visualIdx` in `filtered`:
- If `visualIdx >= hoverIndex`: `top = (visualIdx * itemHeight) + itemHeight`
- Otherwise: `top = visualIdx * itemHeight`

The gap is always exactly one `itemHeight`, regardless of how many items are being dragged.

### Placeholder

**Important:** removing the nudge when the pointer leaves the parent is an *active* reset, not a skip. The render loop must always call the nudge function during drag — when `hoverIndex` is null, it resets all items to base positions. If nudge is only applied conditionally (e.g. `if hoverIndex !== null`), items will stay at their last nudged positions indefinitely.

The placeholder div is positioned at `hoverIndex * itemHeight - scrollTop` via `transform: translateY(...)`. When the pointer leaves the parent, the placeholder fades out (opacity:0) and nudge offsets are reset.

## Virtualization during drag

During drag, items are positioned in collapsed space (dragged items removed) which doesn't map to their indices in the full order. If virtualization windows based on the full order, items that should be visible in collapsed space may fall outside the range and never render — leaving gaps.

**Fix:** at drag start, pre-compute three structures: `dragSet` (Set for O(1) membership), `collapsedOrder` (the full order with dragged keys removed), and `visualIndexMap` (key → index within collapsedOrder). Virtualize against `collapsedOrder.length` during drag — the windowing range, hover index, and nudge offsets all use the collapsed count and the pre-computed map. This keeps all drag operations O(1) per visible item, critical for lists with 1000+ items.

**Do not bypass virtualization during drag.** An earlier approach rendered all items during drag, which is O(n) on every mouse move and scroll event. With the pre-computed collapsed order, normal virtualization works correctly in collapsed space.

## Listbox overflow during drag

During drag, the listbox height is set to the collapsed layout size. However, absolutely positioned children with high `top` values (from the full order) expand `scrollHeight` beyond the explicit `style.height`, causing a scrollbar to reflect the original full-size list.

**Fix:** set `overflow: hidden` on the listbox at drag start, remove it on drag end. This clips the positioned children so `scrollHeight` respects the set height. The scroll parent still controls scrolling independently.

## hoverIndex must update on scroll, not just mouse move

`hoverIndex` depends on both the cursor position and `scrollTop`. During autoscroll the mouse is stationary but `scrollTop` changes — if `hoverIndex` is only recalculated in the mouse move handler, the placeholder and nudge go stale. Store the last pointer position and recalculate `hoverIndex` in the scroll handler too.

## Drag lifecycle: remove dragged items from DOM

Dragged items must be removed from the DOM (and the rendered item cache) at **drag start**, immediately after cloning them for the overlay. Do not keep them in the DOM with `opacity: 0` — this couples them to the render loop and prevents proper virtualization of the collapsed space.

At **drag end**, the render pass re-mounts them as fresh elements at their correct new position. Fresh mounts have no prior `top` to transition from, so there is no flash. This also avoids fragile transition-suppression hacks (`transition: none` + `requestAnimationFrame` restore) which can interfere with subsequent animations.

## Placeholder positioning

The placeholder is a single absolutely-positioned div showing where dragged items will land. It draws at viewport-relative coordinates (`hoverIndex * itemHeight - scrollTop`). If the placeholder is a child of the scroll container, it scrolls with the content, causing it to drift as the user scrolls during drag.

**Fix:** the placeholder is a sibling of the scroll container (`parent`), not a child. The custom element itself (`<primavera-dnd>`) is the positioning context (`position:relative; display:block`). The DOM structure is:

```
<primavera-dnd style="position:relative; display:block; height:100%">
  <div class="dnd-parent" style="overflow-y:auto; height:100%">
    <div role="listbox">...</div>
  </div>
  <div class="placeholder" style="position:absolute; left:0; right:0; z-index:1; pointer-events:none" />
</primavera-dnd>
```

`left:0; right:0` makes the placeholder auto-stretch to its positioning context, so no `ResizeObserver` is needed to track viewport size. Position is updated via `transform: translateY(...)` (GPU-composited, no reflow); show/hide is an `opacity` transition (0.15s) for smooth fade-in.

## Mouse event ordering: mousedown vs click

`mousedown` fires before `click`. If `mousedown` unconditionally selects or sets up drag state, it will clobber the existing selection before `click` can inspect shift/cmd modifiers.

**Implementation note:** `mousedown` should bail early when shift or the platform modifier key (cmd on macOS, ctrl on Windows/Linux) is held. Let `click` handle all modified clicks (shift+click for extend, cmd/ctrl+click for toggle). `mousedown` only handles plain clicks — selecting unselected items and setting up drag initiation state.

### Placeholder height matches item height

The placeholder is the full height of one item, not a thin line. `DndPlaceholder` receives `itemHeight` and sets it on the div, giving clear visual feedback of the drop slot size.

## Drag overlay: row container styling

The `role="option"` container provides the row's dimensions and positioning within the list, but the consumer's renderer only mounts content *inside* it. When the overlay clones these elements for the drag stack, the clones are removed from the list layout context — they lose their width, and have no background, making them appear as floating unstyled content.

**Fix:** the `role="option"` container should apply baseline visual properties that travel with it when cloned:

- `width: 100%` (already set via `left:0; right:0`)
- `height: itemHeight` (already set)
- `background: var(--dnd-row-bg, transparent)` — a CSS custom property the consumer sets to define the row background. Defaults to transparent so it's opt-in.

The component should apply this background directly on the `role="option"` element at mount time. This ensures drag overlay clones inherit a visible background without the renderer needing to know about drag concerns.

### Overlay inherits resolved styles, not CSS vars

The drag overlay is appended to `<body>`, outside the component's DOM subtree. CSS custom properties scoped to the component (e.g. `--dnd-select-bg`) will not cascade into the overlay. At drag start, resolve computed styles (background, etc.) from the source elements and apply them as concrete values on the overlay wrappers.

## Scroll-to-key animation

The spec calls for smooth scrolling when an off-screen item is selected. Browser-native `scrollTo({ behavior: "smooth" })` is too slow and not tuneable. Use a custom `requestAnimationFrame` lerp instead: each frame, close 35% of the remaining distance (`scrollTop += diff * 0.35`), snapping when `|diff| < 1px`. Cancel any in-flight scroll raf when a new scroll target is set or on disconnect.

Worth mentiong that the browser-native scroll is pretty smooth, but not tight enough e.g. doesn't catch up with holding down arrow (could be resolved by jumping further than it needs to).

### CSS custom property convention

All component-level styling hooks use the `--dnd-*` namespace (e.g. `--dnd-row-bg`, `--dnd-drag-shadow`, `--dnd-placeholder-color`). No per-instance namespace segment is needed — consumers can scope overrides to specific instances using standard CSS selectors on any ancestor or the `<primavera-dnd>` element itself.

## Expansion: animating height

CSS cannot transition `height: auto`, but we want the expanded item's height change to feel coherent with the surrounding `top` transitions (0.15s ease).

**Layout:** the renderer's content is mounted into an inner wrapper, absolutely positioned at the container's top (`position:absolute; top:0; left:0; right:0`). The outer container has a numeric pixel height, `overflow:hidden`, and `transition: top 0.15s ease, height 0.15s ease`. A `ResizeObserver` on the inner wrapper feeds the natural content height onto the outer's `style.height`, which is what makes the height transition fire.

**Why anchor inner to the top:** with absolute positioning, the inner sits at the container's top edge regardless of margin collapsing or normal-flow quirks in the consumer's content. The visible reveal is always top-down as the container grows.

**Initial mount of an already-expanded item** (e.g. scrolled back into view) uses the cached `measuredExpandedHeight` so it appears at the right size without an animation flash.

**`collapseForDrag` must not animate.** Drag setup calls `getBoundingClientRect()` on the items, which would otherwise see a still-expanded layout for the 0.15s of the height transition. Suppress the transition for the synchronous collapse: set `transition: none`, write the new height, force a reflow (`void el.offsetHeight`), restore the prior `transition`. Tear down the observer and clear `expandedKey` directly — do not route through the regular `tearDownExpansion` which assumes an animated collapse.

## Expansion: click-outside collapse + dblclick race

Click-outside-to-collapse is implemented with a document-level `click` listener: if the click target is not contained by the expanded item's element, collapse.

This creates a race when the user double-clicks an item *below* the expanded one:

1. First click hits item B → click-outside fires → expanded item A collapses → items below A shift up (0.15s `top` transition).
2. Second click of the intended dblclick lands on item C (now under the cursor where B used to be).
3. Browser's `dblclick` event fires on the common ancestor (the listbox) or the second-clicked sibling — neither matches the user's intent.

**Fix:** every `click` snapshots the prior click's key and timestamp into `prevClickKey` / `prevClickTime` (before overwriting `lastClickKey` / `lastClickTime`). In `dblclick`, if `prevClickKey` is set and `lastClickTime - prevClickTime < 500ms`, prefer it over the event's own target.

The 500ms window matches the browser's dblclick threshold and is comfortably greater than the 150ms shift animation, so even mid-animation second clicks recover correctly. For an isolated normal dblclick (no shift), the snapshot equals the current target — recovery is a no-op.

The browser already enforces a small mouse-movement tolerance for `dblclick`, so this heuristic only fires when the user genuinely held the cursor still for both clicks — i.e. when their intent really was a dblclick on the original target.

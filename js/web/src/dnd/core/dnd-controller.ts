import type { Key, DndRenderer } from "./types";
import { DndSource } from "./source";
import { DndSelection } from "./selection";
import { DndVirtualization } from "./virtualization";
import { mapDndKeyEvent } from "./keyboard";
import { DndPlaceholder } from "../dom/placeholder";
import { DndAutoscroll } from "../dom/autoscroll";
import { DndDragOverlay } from "../dom/drag-overlay";
import { DndDragNative } from "../dom/drag-native";
import { DndTouch } from "../dom/touch";

const DRAG_BUFFER_PX = 3;
const BORDER_RADIUS_PX = 4;

export interface DndControllerConfig {
  itemHeight: number;
  overscan: number;
  dragType: "native" | "overlay";
  roundedSelect: boolean;
  expansionEnabled: boolean;
  confineAutoscroll: boolean;
  autoscrollBuffer: number;
  dragStackCount: number;
  nudge: boolean;
  reorder: boolean;
  multi: boolean;
  /** When false, plain Arrow keys are ignored. Shift/Cmd/Alt+Arrow still
   *  drive extend/move/jump — they don't depend on plain navigation. Use
   *  this for listboxes (e.g. the sidebar) where row "selection" via plain
   *  arrows has no visible state and would just be confusing. */
  arrowNavigate: boolean;
  clearOnClickOutside: boolean;
  fillHeight: boolean;
}

export interface DndControllerHost {
  /** Positioning context — receives placeholder element. */
  host: HTMLElement;
  /** Scroll viewport. */
  parent: HTMLElement;
  /** Listbox element. */
  listbox: HTMLElement;
}

export interface DndControllerOpts {
  config: DndControllerConfig;
  host: DndControllerHost;
  /** Notify host that render state changed and it should re-render. */
  onChange: () => void;
  /** Lookup current DOM element for a key — used for overlay clones and
   *  expansion observer attachment. May return null if not currently rendered. */
  getItemElement(key: Key): HTMLElement | null;
  /** Lookup the inner content wrapper for a key — used for expansion ResizeObserver. */
  getItemInnerElement(key: Key): HTMLElement | null;
}

export interface DndRenderItem {
  key: Key;
  /** Index in the current order — collapsed during drag, full otherwise. */
  index: number;
  /** Top px in the current coordinate space (with nudge applied if applicable). */
  top: number;
  /** Height px (itemHeight, or measured expanded height for the expanded item). */
  height: number;
  /** True only when an item is selected AND nothing is expanded. */
  selected: boolean;
  selFirst: boolean;
  selLast: boolean;
  expanded: boolean;
  /** True for items that should be visually hidden but kept mounted (e.g. dragged items). */
  hidden: boolean;
}

export interface DndRenderState {
  isDragging: boolean;
  listboxHeight: number;
  /** Items the host should render normally. */
  items: DndRenderItem[];
  /** Items the host MAY keep mounted hidden (drag set during drag). Empty otherwise.
   *  Vanilla path tears these down at drag start; Solid path keeps them mounted to
   *  preserve consumer state across drag — that is the architectural goal. */
  keepAlive: DndRenderItem[];
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * Framework-neutral behaviour controller for the DnD list. Owns all
 * drag/hover/expansion/click-pair state and coordinates the DOM-bound
 * subsystems (autoscroll, drag overlay, native drag, touch, placeholder).
 *
 * Hosts (vanilla custom element OR Solid component) provide the structural
 * DOM, wire DOM events into the controller's handlers, and read render
 * state via getRenderState() to draw items.
 */
export class DndController {
  private opts: DndControllerOpts;
  private cfg: DndControllerConfig;

  private source: DndSource<any> | null = null;
  private selection!: DndSelection;
  private renderer: DndRenderer<any> | null = null;

  private virtualization: DndVirtualization;
  private placeholder: DndPlaceholder;
  private autoscroll: DndAutoscroll;
  private dragOverlay: DndDragOverlay;
  private dragNative: DndDragNative<any> | null = null;
  private touch: DndTouch;

  private destroyed = false;

  // Drag state
  private isDraggingFlag = false;
  private mouseDownPos: { x: number; y: number } | null = null;
  private mouseDownKey: Key | null = null;
  private hoverIndex: number | null = null;
  private scrollRaf: number | null = null;
  private lastPointerPos: { x: number; y: number } | null = null;
  private draggedKeys: Key[] = [];
  private dragSet: Set<Key> = new Set();
  private collapsedOrder: Key[] = [];
  private visualIndexMap = new Map<Key, number>();
  /** Set when a drag ends so the synthetic `click` that follows mouseup
   *  is ignored. Without this, the post-drag click runs `selection.clear()`
   *  (when clearOnClickOutside is on and the click lands on the listbox)
   *  or `selectOnly(key)` (when it lands on a row), in either case
   *  destroying the multi-selection that was just dragged. */
  private suppressNextClick = false;

  // Expansion state
  private expandedKey: Key | null = null;
  private measuredExpandedHeight = 0;
  private expandedObserver: ResizeObserver | null = null;
  private parentResizeObserver: ResizeObserver | null = null;
  private lastViewportHeight = 0;
  /** Inner element currently being observed for expansion height. */
  private observedInnerEl: HTMLElement | null = null;

  // Click pair tracking — needed to recover dblclick target after a
  // click-outside collapse shifts items below the previously-expanded one.
  private lastClickKey: Key | null = null;
  private lastClickTime = 0;
  private prevClickKey: Key | null = null;
  private prevClickTime = 0;

  // Subscriptions
  private sourceUnsub: (() => void) | null = null;
  private sourceSyncUnsub: (() => void) | null = null;
  private selectionUnsub: (() => void) | null = null;

  // Native drag listener bookkeeping
  private nativeListenersAttached = false;

  constructor(opts: DndControllerOpts) {
    this.opts = opts;
    this.cfg = { ...opts.config };

    this.virtualization = new DndVirtualization(this.cfg.itemHeight, this.cfg.overscan);
    this.placeholder = new DndPlaceholder(this.cfg.itemHeight, BORDER_RADIUS_PX);
    this.autoscroll = new DndAutoscroll(
      this.opts.host.parent,
      this.cfg.autoscrollBuffer,
      this.cfg.confineAutoscroll,
    );
    this.dragOverlay = new DndDragOverlay(this.cfg.dragStackCount);
    this.touch = new DndTouch();

    // Auxiliary DOM owned by the controller — placeholder is a sibling of
    // the parent (scroll container), inside host (positioning context).
    this.opts.host.host.appendChild(this.placeholder.getElement());

    this.ensureSelection();

    // Built-in event wiring on the controller-owned subsystems is already
    // handled in their own modules; the host wires DOM events into the
    // controller's handlers (see DndControllerEventHandlers below).

    // Re-render when the parent's clientHeight changes — virtualization's
    // visible range depends on it and initial layout often hasn't completed
    // when the controller is constructed.
    if (typeof ResizeObserver !== "undefined") {
      this.parentResizeObserver = new ResizeObserver(() => {
        const h = this.opts.host.parent.clientHeight;
        if (h === this.lastViewportHeight) return;
        this.lastViewportHeight = h;
        this.opts.onChange();
      });
      this.parentResizeObserver.observe(this.opts.host.parent);
    }

    // Document-level click for clear-on-click-outside / expansion collapse.
    document.addEventListener("click", this.onDocumentClick);
  }

  // ── Public setters ──────────────────────────────────────────────

  setSource(source: DndSource<any>): void {
    if (this.sourceUnsub) this.sourceUnsub();
    if (this.sourceSyncUnsub) this.sourceSyncUnsub();
    this.source = source;
    this.ensureSelection();
    this.selection.updateOrder(source.getOrder());

    this.sourceUnsub = source.onChange(() => {
      this.selection.updateOrder(source.getOrder());
      this.opts.onChange();
    });
    this.sourceSyncUnsub = source.onOrderSync(() => {
      this.selection.updateOrder(source.getOrder());
      this.opts.onChange();
    });

    this.opts.onChange();
  }

  setSelection(selection: DndSelection): void {
    if (this.selectionUnsub) this.selectionUnsub();
    this.selection = selection;
    if (this.source) selection.updateOrder(this.source.getOrder());
    this.selectionUnsub = selection.onChange(() => {
      this.opts.onChange();
    });
    this.opts.onChange();
  }

  setRenderer(renderer: DndRenderer<any>): void {
    this.renderer = renderer;
    if (this.dragNative) this.dragNative.setRenderer(renderer);
    if (this.cfg.dragType === "native" && !this.dragNative) {
      this.dragNative = new DndDragNative(renderer);
    }
    this.opts.onChange();
  }

  setConfig(patch: Partial<DndControllerConfig>): void {
    const prev = { ...this.cfg };
    this.cfg = { ...this.cfg, ...patch };

    if (patch.itemHeight !== undefined) {
      this.virtualization.setItemHeight(patch.itemHeight);
    }
    if (patch.overscan !== undefined) {
      this.virtualization.setOverscan(patch.overscan);
    }
    if (patch.confineAutoscroll !== undefined) {
      this.autoscroll.confine = patch.confineAutoscroll;
    }
    if (patch.dragType !== undefined && patch.dragType !== prev.dragType) {
      if (patch.dragType === "native" && this.renderer && !this.dragNative) {
        this.dragNative = new DndDragNative(this.renderer);
      }
    }
    this.opts.onChange();
  }

  // ── Public getters ──────────────────────────────────────────────

  getSelection() {
    return this.selection?.getSelection() ?? { blocks: [], active: null };
  }

  getSelectionInstance(): DndSelection {
    return this.selection;
  }

  getExpanded(): Key | null {
    return this.expandedKey;
  }

  /** Imperatively expand a key (or pass null to collapse). */
  setExpanded(key: Key | null): void {
    this.applyExpanded(key);
  }

  isDragging(): boolean {
    return this.isDraggingFlag;
  }

  /**
   * Compute the render state for the host. The host iterates `items` to
   * render the visible list; if the host wants to preserve consumer state
   * across drag (Solid path), it ALSO renders `keepAlive` with hidden
   * styling so per-item components stay mounted.
   */
  getRenderState(): DndRenderState {
    if (!this.source) {
      return { isDragging: false, listboxHeight: 0, items: [], keepAlive: [] };
    }

    const order = this.source.getOrder();
    this.selection.updateOrder(order);

    // Sync expanded state into virtualization. Suppressed during drag so
    // collapsed-space math stays uniform-height.
    let expandedIndex: number | null = null;
    if (!this.isDraggingFlag && this.expandedKey !== null) {
      const idx = order.indexOf(this.expandedKey);
      if (idx === -1) {
        // Expanded item was removed from source — collapse through the
        // normal host-notification path so wrapper state stays in sync.
        this.clearExpandedState(true);
      } else {
        expandedIndex = idx;
      }
    }
    this.virtualization.setExpanded(
      expandedIndex,
      this.measuredExpandedHeight || this.cfg.itemHeight,
    );

    const scrollTop = this.opts.host.parent.scrollTop;
    const viewportHeight = this.opts.host.parent.clientHeight;
    const selectedKeys = new Set(this.selection.getSelectedKeys());

    if (this.isDraggingFlag) {
      const visualCount = this.collapsedOrder.length;
      const nudgeExtra =
        this.cfg.reorder && this.hoverIndex !== null && this.cfg.nudge ? 1 : 0;
      const contentHeight = this.virtualization.getTotalHeight(
        visualCount + nudgeExtra,
      );
      const listboxHeight = this.cfg.fillHeight
        ? Math.max(contentHeight, this.cfg.itemHeight)
        : contentHeight;

      const range = this.virtualization.calculateRange(
        scrollTop,
        viewportHeight,
        visualCount,
      );

      const items: DndRenderItem[] = [];
      for (let i = range.startIndex; i < range.endIndex; i++) {
        if (i >= visualCount) break;
        const key = this.collapsedOrder[i];
        const baseTop = i * this.cfg.itemHeight;
        const top =
          this.cfg.reorder &&
          this.cfg.nudge &&
          this.hoverIndex !== null &&
          i >= this.hoverIndex
            ? baseTop + this.cfg.itemHeight
            : baseTop;
        items.push({
          key,
          index: i,
          top,
          height: this.cfg.itemHeight,
          selected: false,
          selFirst: false,
          selLast: false,
          expanded: false,
          hidden: false,
        });
      }

      // Dragged items kept mounted hidden so consumer-rendered state survives.
      const keepAlive: DndRenderItem[] = [];
      for (const key of this.draggedKeys) {
        keepAlive.push({
          key,
          index: -1,
          top: 0,
          height: this.cfg.itemHeight,
          selected: false,
          selFirst: false,
          selLast: false,
          expanded: false,
          hidden: true,
        });
      }

      return { isDragging: true, listboxHeight, items, keepAlive };
    }

    const contentHeight = this.virtualization.getTotalHeight(order.length);
    const listboxHeight = this.cfg.fillHeight
      ? Math.max(contentHeight, this.cfg.itemHeight)
      : contentHeight;

    const range = this.virtualization.calculateRange(
      scrollTop,
      viewportHeight,
      order.length,
    );

    const items: DndRenderItem[] = [];
    for (let i = range.startIndex; i < range.endIndex; i++) {
      if (i >= order.length) break;
      const key = order[i];
      const isExpanded = key === this.expandedKey;
      // Selection chrome is suppressed everywhere while anything is expanded.
      const isSelected = this.expandedKey === null && selectedKeys.has(key);
      let selFirst = false;
      let selLast = false;
      if (isSelected && this.cfg.roundedSelect) {
        const prevKey = i > 0 ? order[i - 1] : null;
        const nextKey = i < order.length - 1 ? order[i + 1] : null;
        selFirst = !prevKey || !selectedKeys.has(prevKey);
        selLast = !nextKey || !selectedKeys.has(nextKey);
      }
      items.push({
        key,
        index: i,
        top: this.virtualization.getItemTop(i),
        height: this.virtualization.getItemHeight(i),
        selected: isSelected,
        selFirst,
        selLast,
        expanded: isExpanded,
        hidden: false,
      });
    }

    return { isDragging: false, listboxHeight, items, keepAlive: [] };
  }

  /** Host calls this whenever it has finished mounting/updating items so the
   *  controller can (re)attach the expansion observer to the now-rendered
   *  inner element. Idempotent — does nothing if observer already attached
   *  to the right element, or if no item is expanded. */
  syncExpansionObserver(): void {
    if (this.expandedKey === null) {
      this.detachExpansionObserver();
      return;
    }
    const inner = this.opts.getItemInnerElement(this.expandedKey);
    if (!inner) {
      // Item not yet rendered — observer will be re-synced after host finishes.
      this.detachExpansionObserver();
      return;
    }
    if (this.observedInnerEl === inner) return;
    this.attachExpansionObserver(inner);
  }

  // ── Subsystem accessors ─────────────────────────────────────────

  /** Placeholder DOM (already appended to host). Exposed for any host that
   *  needs to re-parent it for special layouts. */
  getPlaceholderElement(): HTMLElement {
    return this.placeholder.getElement();
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    document.removeEventListener("click", this.onDocumentClick);
    document.removeEventListener("mousemove", this.onDocMouseMove);
    document.removeEventListener("mouseup", this.onDocMouseUp);

    this.autoscroll.stop();
    if (this.scrollRaf !== null) cancelAnimationFrame(this.scrollRaf);
    this.dragOverlay.stop();
    this.touch.cancel();

    if (this.sourceUnsub) this.sourceUnsub();
    if (this.sourceSyncUnsub) this.sourceSyncUnsub();
    if (this.selectionUnsub) this.selectionUnsub();

    this.detachExpansionObserver();
    if (this.parentResizeObserver) {
      this.parentResizeObserver.disconnect();
      this.parentResizeObserver = null;
    }

    if (this.placeholder.getElement().parentNode) {
      this.placeholder.getElement().parentNode!.removeChild(
        this.placeholder.getElement(),
      );
    }
  }

  // ── Selection bootstrap ────────────────────────────────────────

  private ensureSelection(): void {
    if (this.selection) return;
    this.selection = new DndSelection();
    this.selectionUnsub = this.selection.onChange(() => {
      this.opts.onChange();
    });
  }

  // ── Scroll ──────────────────────────────────────────────────────

  /** Host wires this to parent.addEventListener("scroll"). */
  onScroll = (): void => {
    this.opts.onChange();
    if (this.isDraggingFlag) {
      this.updateHoverIndex();
      this.updatePlaceholder();
    }
  };

  scrollToKey(key: Key): void {
    if (!this.source) return;
    const order = this.source.getOrder();
    const idx = order.indexOf(key);
    if (idx === -1) return;
    const offset = this.virtualization.getScrollToOffset(
      idx,
      this.opts.host.parent.scrollTop,
      this.opts.host.parent.clientHeight,
    );
    if (offset !== null) this.smoothScrollTo(offset);
  }

  private smoothScrollTo(target: number): void {
    if (this.scrollRaf !== null) cancelAnimationFrame(this.scrollRaf);
    const step = () => {
      const diff = target - this.opts.host.parent.scrollTop;
      if (Math.abs(diff) < 1) {
        this.opts.host.parent.scrollTop = target;
        this.scrollRaf = null;
        return;
      }
      this.opts.host.parent.scrollTop += diff * 0.35;
      this.scrollRaf = requestAnimationFrame(step);
    };
    this.scrollRaf = requestAnimationFrame(step);
  }

  // ── Keyboard ────────────────────────────────────────────────────

  /** Host wires to listbox.addEventListener("keydown"). */
  onKeyDown = (e: KeyboardEvent): void => {
    if (!this.source) return;

    if (e.key === "Escape" && this.expandedKey !== null) {
      e.preventDefault();
      this.applyExpanded(null);
      return;
    }

    const action = mapDndKeyEvent(e);
    if (action.type === "ignore") return;
    // Sidebar uses arrowNavigate:false to suppress plain-arrow selection —
    // the only visible "active" state there is the current view, not a
    // selection ring, so silent selection moves were misleading.
    if (action.type === "navigate" && !this.cfg.arrowNavigate) return;
    e.preventDefault();
    const order = this.source.getOrder();

    switch (action.type) {
      case "select-only-first":
        this.selection.selectOnly(this.selection.first());
        this.scrollToKey(this.selection.first());
        break;
      case "select-only-last":
        this.selection.selectOnly(this.selection.last());
        this.scrollToKey(this.selection.last());
        break;
      case "navigate": {
        if (!this.selection.hasSelection()) {
          const key =
            action.direction === "down" ? order[0] : order[order.length - 1];
          if (key !== undefined) {
            this.selection.selectOnly(key);
            this.scrollToKey(key);
          }
        } else {
          const ref =
            action.direction === "down"
              ? this.selection.getSelectionBottom()
              : this.selection.getSelectionTop();
          if (ref !== null) {
            const target =
              action.direction === "down"
                ? this.selection.next(ref)
                : this.selection.prev(ref);
            this.selection.selectOnly(target);
            this.scrollToKey(target);
          }
        }
        break;
      }
      case "extend": {
        const activeBlock = this.selection.getActiveBlock();
        if (activeBlock !== null) {
          const target =
            action.direction === "down"
              ? this.selection.next(activeBlock.to)
              : this.selection.prev(activeBlock.to);
          if (this.cfg.multi) this.selection.extendActive(target);
          else this.selection.selectOnly(target);
          this.scrollToKey(target);
        } else {
          const key =
            action.direction === "down" ? order[0] : order[order.length - 1];
          if (key !== undefined) {
            this.selection.selectOnly(key);
            this.scrollToKey(key);
          }
        }
        break;
      }
      case "extend-to-first":
        if (this.cfg.multi) this.selection.extendActive(this.selection.first());
        else this.selection.selectOnly(this.selection.first());
        this.scrollToKey(this.selection.first());
        break;
      case "extend-to-last":
        if (this.cfg.multi) this.selection.extendActive(this.selection.last());
        else this.selection.selectOnly(this.selection.last());
        this.scrollToKey(this.selection.last());
        break;
      case "move-selection":
        if (this.cfg.reorder) this.handleMoveSelection(action.direction);
        break;
      case "select-all":
        if (this.cfg.multi) this.selection.selectAll();
        break;
      case "clear":
        this.selection.clear();
        break;
    }
  };

  private handleMoveSelection(dir: "up" | "down"): void {
    if (!this.source || !this.selection.hasSelection()) return;
    const selectedKeys = this.selection.getSelectedKeys();
    const order = this.source.getOrder();
    const keySet = new Set(selectedKeys);
    const filtered = order.filter((k) => !keySet.has(k));

    const topKey = this.selection.getSelectionTop()!;
    const topIdx = order.indexOf(topKey);
    const bottomKey = this.selection.getSelectionBottom()!;
    const bottomIdx = order.indexOf(bottomKey);

    let beforeKey: Key | null;
    if (dir === "up") {
      if (topIdx <= 0) return;
      const aboveKey = order[topIdx - 1];
      if (keySet.has(aboveKey)) return;
      const aboveIdxInFiltered = filtered.indexOf(aboveKey);
      beforeKey = aboveIdxInFiltered >= 0 ? filtered[aboveIdxInFiltered] : null;
    } else {
      if (bottomIdx >= order.length - 1) return;
      const belowKey = order[bottomIdx + 1];
      if (keySet.has(belowKey)) return;
      const belowIdxInFiltered = filtered.indexOf(belowKey);
      beforeKey =
        belowIdxInFiltered + 1 < filtered.length
          ? filtered[belowIdxInFiltered + 1]
          : null;
    }

    const txnId = this.source.apply([
      { type: "move", keys: selectedKeys, beforeKey },
    ]);
    this.source._commitUI(txnId);
    this.source._commitState(txnId);

    this.selection.updateOrder(this.source.getOrder());

    const scrollTarget =
      dir === "up"
        ? this.selection.getSelectionTop()
        : this.selection.getSelectionBottom();
    if (scrollTarget !== null) this.scrollToKey(scrollTarget);
  }

  // ── Mouse ───────────────────────────────────────────────────────

  /** Host wires to listbox.addEventListener("click"). */
  onClick = (e: MouseEvent): void => {
    if (!this.source) return;

    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    const key = this.getKeyFromEvent(e);

    this.prevClickKey = this.lastClickKey;
    this.prevClickTime = this.lastClickTime;
    this.lastClickKey = key;
    this.lastClickTime = Date.now();

    if (key === null) {
      if (this.cfg.clearOnClickOutside && this.selection.hasSelection()) {
        this.selection.clear();
      }
      return;
    }

    const modKey = isMac ? e.metaKey : e.ctrlKey;

    if (this.cfg.multi && e.shiftKey) {
      this.selection.extendActive(key);
    } else if (this.cfg.multi && modKey) {
      this.selection.toggleItem(key);
    } else if (!this.isDraggingFlag) {
      this.selection.selectOnly(key);
    }
  };

  /** Host wires to listbox.addEventListener("dblclick"). */
  onDblClick = (e: MouseEvent): void => {
    if (!this.cfg.expansionEnabled) return;
    let key: Key | null = null;
    if (
      this.prevClickKey !== null &&
      this.lastClickTime - this.prevClickTime < 500
    ) {
      key = this.prevClickKey;
    }
    if (key === null) key = this.getKeyFromEvent(e);
    if (key === null) return;
    if (key === this.expandedKey) return;
    this.applyExpanded(key);
  };

  private onDocumentClick = (e: MouseEvent): void => {
    const insideHost = this.isPointInside(
      this.opts.host.host,
      e.clientX,
      e.clientY,
    );
    if (
      this.cfg.clearOnClickOutside &&
      this.selection.hasSelection() &&
      !insideHost
    ) {
      this.selection.clear();
    }
    if (this.expandedKey === null) return;
    const expandedEl = this.opts.getItemElement(this.expandedKey);
    if (!expandedEl) return;
    if (!this.isPointInside(expandedEl, e.clientX, e.clientY)) {
      this.applyExpanded(null);
    }
  };

  private isPointInside(el: Element, x: number, y: number): boolean {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  /** Host wires to listbox.addEventListener("mousedown"). */
  onMouseDown = (e: MouseEvent): void => {
    if (!this.source || e.button !== 0) return;
    if (this.cfg.dragType === "native") return;
    if (this.expandedKey !== null) return;
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    if (e.shiftKey || modKey) return;

    const key = this.getKeyFromEvent(e);
    if (key === null) return;

    if (!this.selection.isSelected(key)) {
      this.selection.selectOnly(key);
    }

    this.mouseDownPos = { x: e.clientX, y: e.clientY };
    this.mouseDownKey = key;

    document.addEventListener("mousemove", this.onDocMouseMove);
    document.addEventListener("mouseup", this.onDocMouseUp);
  };

  private onDocMouseMove = (e: MouseEvent): void => {
    if (!this.mouseDownPos || !this.source) return;

    if (!this.isDraggingFlag) {
      const dx = e.clientX - this.mouseDownPos.x;
      const dy = e.clientY - this.mouseDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_BUFFER_PX) return;
      this.startOverlayDrag(e.clientX, e.clientY);
    }

    this.lastPointerPos = { x: e.clientX, y: e.clientY };
    this.dragOverlay.updatePosition(e.clientX, e.clientY);
    this.autoscroll.confine = this.cfg.confineAutoscroll;
    this.autoscroll.update(e.clientX, e.clientY);

    this.updateHoverIndex();
    this.updatePlaceholder();
    if (this.cfg.nudge) this.opts.onChange();

    this.dispatchDrag("move", e.clientX, e.clientY);
  };

  private onDocMouseUp = (): void => {
    document.removeEventListener("mousemove", this.onDocMouseMove);
    document.removeEventListener("mouseup", this.onDocMouseUp);
    if (this.isDraggingFlag) this.endDrag();
    this.mouseDownPos = null;
    this.mouseDownKey = null;
  };

  private startOverlayDrag(x: number, y: number): void {
    // Drag operates on uniform-height layout — collapse first.
    this.collapseForDrag();

    this.isDraggingFlag = true;
    this.opts.host.listbox.style.overflow = "hidden";
    this.draggedKeys = this.selection.getSelectedKeys();
    this.dragSet = new Set(this.draggedKeys);
    this.rebuildCollapsedOrder();

    const elements: HTMLElement[] = [];
    let grabElement: HTMLElement | null = null;
    for (const key of this.draggedKeys) {
      const el = this.opts.getItemElement(key);
      if (el) {
        elements.push(el);
        if (key === this.mouseDownKey) grabElement = el;
      }
    }

    this.dragOverlay.start(
      elements,
      this.draggedKeys.length,
      x,
      y,
      this.cfg.itemHeight,
      this.opts.host.listbox.clientWidth,
      grabElement ?? elements[0],
    );

    // Notify host so it re-renders. The host is responsible for handling
    // dragged items per its policy:
    //   - Vanilla: tear down dragged items at drag start (calls renderer
    //     cleanup, removes from DOM). It looks at the current render state
    //     where dragged items are not in `items` (they're in `keepAlive`)
    //     and explicitly drops them from its rendered cache.
    //   - Solid: keeps dragged items mounted via keepAlive, hidden via CSS,
    //     so consumer per-item state survives the drag.
    this.opts.onChange();

    // Clamp scroll position once to fit collapsed layout.
    const visualCount = this.collapsedOrder.length;
    const listHeight = Math.max(
      this.virtualization.getTotalHeight(visualCount),
      this.opts.host.parent.clientHeight,
    );
    const maxScroll = listHeight - this.opts.host.parent.clientHeight;
    if (this.opts.host.parent.scrollTop > maxScroll) {
      this.opts.host.parent.scrollTop = Math.max(0, maxScroll);
    }

    this.dispatchDrag("start", x, y);
  }

  private dispatchDrag(
    type: "start" | "move" | "end",
    x: number,
    y: number,
  ): boolean {
    if (this.cfg.dragType !== "overlay") return false;
    if (this.draggedKeys.length === 0) return false;
    const items = this.source
      ? this.draggedKeys
          .map((k) => this.source!.getItem(k))
          .filter((i): i is unknown => i !== undefined)
      : [];
    const event = new CustomEvent(`primavera-dnd-drag${type}`, {
      bubbles: true,
      composed: true,
      cancelable: type === "end",
      detail: { keys: [...this.draggedKeys], items, x, y },
    });
    this.opts.host.host.dispatchEvent(event);
    return event.defaultPrevented;
  }

  private endDrag(): void {
    const pos = this.lastPointerPos ?? { x: 0, y: 0 };
    const consumed = this.dispatchDrag("end", pos.x, pos.y);

    this.dragOverlay.stop();
    this.autoscroll.stop();
    this.placeholder.clear();

    if (
      !consumed &&
      this.cfg.reorder &&
      this.hoverIndex !== null &&
      this.source
    ) {
      const beforeKey =
        this.hoverIndex < this.collapsedOrder.length
          ? this.collapsedOrder[this.hoverIndex]
          : null;
      const txnId = this.source.apply([
        { type: "move", keys: this.draggedKeys, beforeKey },
      ]);
      this.source._commitUI(txnId);
      this.source._commitState(txnId);
    }

    if (this.isDraggingFlag) this.suppressNextClick = true;
    this.isDraggingFlag = false;
    this.hoverIndex = null;
    this.lastPointerPos = null;
    this.draggedKeys = [];
    this.dragSet.clear();
    this.collapsedOrder = [];
    this.visualIndexMap.clear();
    this.opts.host.listbox.style.overflow = "";
    this.opts.onChange();
  }

  // ── Native drag ─────────────────────────────────────────────────

  /** Host wires to per-item dragstart event for native drag mode. */
  onNativeDragStart = (e: DragEvent, key: Key): void => {
    if (!this.source || !this.renderer) return;
    if (this.expandedKey !== null) {
      e.preventDefault();
      return;
    }
    if (!this.selection.isSelected(key)) {
      this.selection.selectOnly(key);
    }

    this.collapseForDrag();
    this.isDraggingFlag = true;
    this.draggedKeys = this.selection.getSelectedKeys();
    this.dragSet = new Set(this.draggedKeys);
    this.rebuildCollapsedOrder();

    if (!this.dragNative) {
      this.dragNative = new DndDragNative(this.renderer);
    }

    const items = this.draggedKeys
      .map((k) => this.source!.getItem(k))
      .filter((i) => i !== undefined);
    this.dragNative.onDragStart(e, this.draggedKeys, items);

    if (!this.nativeListenersAttached) {
      this.opts.host.listbox.addEventListener("dragover", this.onNativeDragOver);
      this.opts.host.listbox.addEventListener("drop", this.onNativeDrop);
      this.opts.host.listbox.addEventListener("dragleave", this.onNativeDragLeave);
      this.nativeListenersAttached = true;
    }

    this.opts.onChange();
  };

  private onNativeDragOver = (e: DragEvent): void => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const rect = this.opts.host.parent.getBoundingClientRect();
    const y = e.clientY - rect.top + this.opts.host.parent.scrollTop;
    const order = this.source!.getOrder();
    this.hoverIndex = this.virtualization.getIndexAtY(y, order.length + 1);

    this.autoscroll.update(e.clientX, e.clientY);
    this.updatePlaceholder();
    if (this.cfg.nudge) this.opts.onChange();
  };

  private onNativeDragLeave = (): void => {
    this.hoverIndex = null;
    this.placeholder.clear();
  };

  private onNativeDrop = (e: DragEvent): void => {
    e.preventDefault();
    this.endDrag();
  };

  /** Host wires to per-item dragend event for native drag mode. */
  onNativeDragEnd = (): void => {
    if (this.nativeListenersAttached) {
      this.opts.host.listbox.removeEventListener("dragover", this.onNativeDragOver);
      this.opts.host.listbox.removeEventListener("drop", this.onNativeDrop);
      this.opts.host.listbox.removeEventListener("dragleave", this.onNativeDragLeave);
      this.nativeListenersAttached = false;
    }

    if (this.dragNative) this.dragNative.onDragEnd();
    this.autoscroll.stop();

    if (this.isDraggingFlag) {
      this.isDraggingFlag = false;
      this.hoverIndex = null;
      this.draggedKeys = [];
      this.dragSet.clear();
      this.collapsedOrder = [];
      this.visualIndexMap.clear();
      this.opts.host.listbox.style.overflow = "";
      this.placeholder.clear();
      this.opts.onChange();
    }
  };

  // ── Touch ───────────────────────────────────────────────────────

  onTouchStart = (e: TouchEvent): void => {
    if (!this.source) return;
    if (this.expandedKey !== null) return;
    const key = this.getKeyFromTouchEvent(e);
    if (key === null) return;
    const t = e.touches[0];
    this.touch.onTouchStart(key, t.clientX, t.clientY);
  };

  onTouchMove = (e: TouchEvent): void => {
    const t = e.touches[0];
    const result = this.touch.onTouchMove(t.clientX, t.clientY);

    switch (result.type) {
      case "drag-start":
        e.preventDefault();
        if (!this.selection.isSelected(result.key)) {
          this.selection.selectOnly(result.key);
        }
        this.startOverlayDrag(result.x, result.y);
        break;
      case "dragging":
        e.preventDefault();
        this.dragOverlay.updatePosition(result.x, result.y);
        this.autoscroll.update(result.x, result.y);

        if (this.source) {
          const rect = this.opts.host.parent.getBoundingClientRect();
          if (
            result.x >= rect.left &&
            result.x <= rect.right &&
            result.y >= rect.top &&
            result.y <= rect.bottom
          ) {
            const y = result.y - rect.top + this.opts.host.parent.scrollTop;
            this.hoverIndex = this.virtualization.getIndexAtY(
              y,
              this.source.getOrder().length,
            );
          } else {
            this.hoverIndex = null;
          }
          this.updatePlaceholder();
          if (this.cfg.nudge) this.opts.onChange();
        }
        this.dispatchDrag("move", result.x, result.y);
        break;
      case "scroll":
        break;
    }
  };

  onTouchEnd = (e: TouchEvent): void => {
    const t = e.changedTouches[0];
    const result = this.touch.onTouchEnd(t.clientX, t.clientY);
    switch (result.type) {
      case "select":
        this.selection.selectOnly(result.key);
        break;
      case "drag-end":
        this.endDrag();
        break;
    }
  };

  // ── Hover / placeholder ─────────────────────────────────────────

  private updateHoverIndex(): void {
    if (!this.source || !this.lastPointerPos) return;
    const rect = this.opts.host.parent.getBoundingClientRect();
    const { x, y } = this.lastPointerPos;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const scrollY = y - rect.top + this.opts.host.parent.scrollTop;
      const nonDragCount = this.collapsedOrder.length;
      this.hoverIndex = Math.max(
        0,
        Math.min(Math.floor(scrollY / this.cfg.itemHeight), nonDragCount),
      );
    } else {
      this.hoverIndex = null;
    }
  }

  private updatePlaceholder(): void {
    if (!this.cfg.reorder || this.hoverIndex === null) {
      this.placeholder.clear();
      return;
    }
    const y =
      this.hoverIndex * this.cfg.itemHeight - this.opts.host.parent.scrollTop;
    this.placeholder.renderPlaceholder(y);
  }

  private rebuildCollapsedOrder(): void {
    if (!this.source) return;
    const order = this.source.getOrder();
    this.collapsedOrder = [];
    this.visualIndexMap.clear();
    for (const key of order) {
      if (!this.dragSet.has(key)) {
        this.visualIndexMap.set(key, this.collapsedOrder.length);
        this.collapsedOrder.push(key);
      }
    }
  }

  // ── Expansion ──────────────────────────────────────────────────

  private applyExpanded(next: Key | null): void {
    if (next === this.expandedKey) return;
    this.clearExpandedState(false);
    this.expandedKey = next;
    this.notifyExpanded(next);
    if (next !== null) {
      // Selection collapses to just the expanded item; chrome is suppressed
      // while expandedKey is set, then reappears on collapse.
      this.selection.selectOnly(next);
    }
    this.opts.onChange();
  }

  private notifyExpanded(next: Key | null): void {
    this.renderer?.setExpanded?.(next);
  }

  private clearExpandedState(notifyHost: boolean): void {
    this.detachExpansionObserver();
    this.expandedKey = null;
    this.measuredExpandedHeight = 0;
    if (notifyHost) this.notifyExpanded(null);
  }

  private collapseForDrag(): void {
    if (this.expandedKey === null) return;
    this.detachExpansionObserver();
    const oldEl = this.opts.getItemElement(this.expandedKey);
    if (oldEl) {
      // Synchronously reset the outer's height with no transition so
      // getBoundingClientRect (used in overlay setup) sees collapsed layout.
      const prev = oldEl.style.transition;
      oldEl.style.transition = "none";
      oldEl.style.height = `${this.cfg.itemHeight}px`;
      void oldEl.offsetHeight;
      oldEl.style.transition = prev;
    }
    this.clearExpandedState(true);
    this.virtualization.setExpanded(null, this.cfg.itemHeight);
  }

  private attachExpansionObserver(inner: HTMLElement): void {
    this.detachExpansionObserver();
    this.observedInnerEl = inner;
    this.expandedObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.borderBoxSize?.[0];
      const h = box ? box.blockSize : entry.contentRect.height;
      if (Math.abs(h - this.measuredExpandedHeight) > 0.5) {
        this.measuredExpandedHeight = h;
        this.opts.onChange();
      }
    });
    this.expandedObserver.observe(inner);
  }

  private detachExpansionObserver(): void {
    if (this.expandedObserver) {
      this.expandedObserver.disconnect();
      this.expandedObserver = null;
    }
    this.observedInnerEl = null;
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private getKeyFromEvent(e: MouseEvent): Key | null {
    const target = e.target as HTMLElement;
    const option = target.closest<HTMLElement>("[role=option]");
    if (!option || option.dataset.key === undefined) return null;
    return option.dataset.key;
  }

  private getKeyFromTouchEvent(e: TouchEvent): Key | null {
    const target = e.target as HTMLElement;
    const option = target.closest<HTMLElement>("[role=option]");
    if (!option || option.dataset.key === undefined) return null;
    return option.dataset.key;
  }
}

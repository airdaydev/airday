import type { Key, DndRenderer } from "../core/types";
import { DndSource } from "../core/source";
import { DndSelection } from "../core/selection";
import {
  DndController,
  type DndControllerConfig,
  type DndRenderItem,
} from "../core/dnd-controller";

const BORDER_RADIUS_PX = 4;

interface RenderedItem {
  element: HTMLElement;
  inner: HTMLElement;
  cleanup: () => void;
  index: number;
}

/**
 * <primavera-dnd> — Virtualized drag-and-drop list with multi-select.
 *
 * No Shadow DOM. Consumer provides a DndSource and DndRenderer.
 *
 * State and behaviour live in DndController; this element owns the structural
 * DOM and per-item mounting via the renderer's mount/dispose protocol.
 */
export class PrimaveraDnd extends HTMLElement {
  private controller: DndController | null = null;
  private source: DndSource<any> | null = null;
  private pendingSelection: DndSelection | null = null;
  private renderer: DndRenderer<any> | null = null;

  private parentEl!: HTMLElement;
  private listbox!: HTMLElement;
  private styleEl!: HTMLStyleElement;

  private renderedItems = new Map<Key, RenderedItem>();
  private initialized = false;

  // ── Attribute helpers ───────────────────────────────────────────

  private get dragType(): "native" | "overlay" {
    return (
      (this.getAttribute("drag-type") as "native" | "overlay") || "overlay"
    );
  }
  private get overscan(): number {
    return parseInt(this.getAttribute("overscan") || "2", 10);
  }
  private get roundedSelect(): boolean {
    return this.getAttribute("rounded-select") !== "false";
  }
  private get shouldAutofocus(): boolean {
    return this.hasAttribute("autofocus");
  }
  private get itemHeight(): number {
    return parseInt(this.getAttribute("item-height") || "32", 10);
  }
  private get expansionEnabled(): boolean {
    return this.hasAttribute("expandable");
  }
  private get confineAutoscroll(): boolean {
    return this.getAttribute("confine-autoscroll") !== "false";
  }
  private get autoscrollBuffer(): number {
    return parseInt(this.getAttribute("autoscroll-buffer") || "32", 10);
  }
  private get dragStackCount(): number {
    return parseInt(this.getAttribute("drag-stack-count") || "3", 10);
  }
  private get nudge(): boolean {
    return this.getAttribute("nudge") !== "false";
  }
  private get reorder(): boolean {
    return this.getAttribute("reorder") !== "false";
  }
  private get multi(): boolean {
    return this.getAttribute("multi") !== "false";
  }
  private get clearOnClickOutside(): boolean {
    return this.hasAttribute("clear-on-click-outside");
  }
  private get fillHeight(): boolean {
    return this.hasAttribute("fill-height");
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  connectedCallback(): void {
    if (this.initialized) return;
    this.init();
  }

  disconnectedCallback(): void {
    this.cleanup();
  }

  // ── Public API ──────────────────────────────────────────────────

  setSource(source: DndSource<any>): void {
    this.source = source;
    if (this.controller) this.controller.setSource(source);
  }

  setSelection(selection: DndSelection): void {
    if (this.controller) this.controller.setSelection(selection);
    else this.pendingSelection = selection;
  }

  setRenderer(renderer: DndRenderer<any>): void {
    this.renderer = renderer;
    if (this.controller) {
      this.controller.setRenderer(renderer);
      // Wipe and re-mount items with the new renderer
      this.clearAllItems();
      this.renderList();
    }
  }

  getSelection() {
    return this.controller?.getSelection() ?? { blocks: [], active: null };
  }

  setExpanded(key: Key | null): void {
    this.controller?.setExpanded(key);
  }

  getExpanded(): Key | null {
    return this.controller?.getExpanded() ?? null;
  }

  // ── Init ────────────────────────────────────────────────────────

  private init(): void {
    this.setupDOM();

    const config: DndControllerConfig = {
      itemHeight: this.itemHeight,
      overscan: this.overscan,
      dragType: this.dragType,
      roundedSelect: this.roundedSelect,
      expansionEnabled: this.expansionEnabled,
      confineAutoscroll: this.confineAutoscroll,
      autoscrollBuffer: this.autoscrollBuffer,
      dragStackCount: this.dragStackCount,
      nudge: this.nudge,
      reorder: this.reorder,
      multi: this.multi,
      clearOnClickOutside: this.clearOnClickOutside,
      fillHeight: this.fillHeight,
    };

    this.controller = new DndController({
      config,
      host: { host: this, parent: this.parentEl, listbox: this.listbox },
      onChange: () => this.renderList(),
      getItemElement: (key) => this.renderedItems.get(key)?.element ?? null,
      getItemInnerElement: (key) => this.renderedItems.get(key)?.inner ?? null,
    });

    if (this.pendingSelection) {
      this.controller.setSelection(this.pendingSelection);
      this.pendingSelection = null;
    }

    // Wire events
    this.parentEl.addEventListener("scroll", this.controller.onScroll, {
      passive: true,
    });
    this.listbox.addEventListener("keydown", this.controller.onKeyDown);
    this.listbox.addEventListener("mousedown", this.controller.onMouseDown);
    this.listbox.addEventListener("click", this.controller.onClick);
    this.listbox.addEventListener("dblclick", this.controller.onDblClick);
    this.listbox.addEventListener("touchstart", this.controller.onTouchStart, {
      passive: false,
    });
    this.listbox.addEventListener("touchmove", this.controller.onTouchMove, {
      passive: false,
    });
    this.listbox.addEventListener("touchend", this.controller.onTouchEnd);

    this.initialized = true;

    if (this.source) this.controller.setSource(this.source);
    if (this.renderer) this.controller.setRenderer(this.renderer);

    this.renderList();

    if (this.shouldAutofocus) {
      queueMicrotask(() => this.listbox.focus());
    }
  }

  private setupDOM(): void {
    const fill = this.fillHeight;
    this.style.cssText = `position:relative;display:block;${fill ? "height:100%;" : ""}`;

    this.parentEl = document.createElement("div");
    this.parentEl.className = "dnd-parent";
    this.parentEl.style.cssText = `position:relative;overflow-y:auto;z-index:2;${fill ? "height:100%;" : ""}`;

    this.listbox = document.createElement("div");
    this.listbox.setAttribute("role", "listbox");
    this.listbox.setAttribute("aria-multiselectable", String(this.multi));
    this.listbox.setAttribute("tabindex", "0");
    this.listbox.style.cssText = `position:relative;outline:none;${fill ? "min-height:100%;" : ""}`;

    this.parentEl.appendChild(this.listbox);
    this.appendChild(this.parentEl);

    this.styleEl = document.createElement("style");
    this.appendChild(this.styleEl);
    this.updateStyles();
  }

  // ── Rendering ───────────────────────────────────────────────────

  private renderList(): void {
    if (!this.controller || !this.source || !this.renderer) return;

    const state = this.controller.getRenderState();

    this.listbox.style.height = `${state.listboxHeight}px`;

    const keysToRender = new Set<Key>();
    for (const it of state.items) keysToRender.add(it.key);

    // Remove items no longer in the visible set. Vanilla path tears down
    // dragged items at drag start because they're not in items[] (they're
    // in keepAlive[], which vanilla deliberately ignores) — calling cleanup()
    // releases per-item framework roots to avoid the leak that the unified
    // architecture is designed to make impossible at the Solid layer.
    for (const [key, item] of this.renderedItems) {
      if (!keysToRender.has(key)) {
        item.cleanup();
        item.element.remove();
        this.renderedItems.delete(key);
      }
    }

    for (const it of state.items) {
      const existing = this.renderedItems.get(it.key);
      if (existing) {
        this.updateItem(existing, it);
      } else {
        this.mountItem(it);
      }
    }

    // After items are mounted, hand DOM refs to controller so it can wire
    // the expansion observer to the (possibly re-mounted) inner element.
    this.controller.syncExpansionObserver();
  }

  private mountItem(state: DndRenderItem): void {
    if (!this.renderer || !this.source) return;
    const item = this.source.getItem(state.key);
    if (item === undefined) return;

    const container = document.createElement("div");
    container.className = "dnd-item";
    container.setAttribute("role", "option");
    container.dataset.key = String(state.key);
    container.style.top = `${state.top}px`;
    container.style.height = `${state.height}px`;

    const inner = document.createElement("div");
    inner.className = "dnd-item-inner";
    if (state.expanded) inner.dataset.expanded = "";
    container.appendChild(inner);

    if (this.dragType === "native") {
      container.draggable = true;
      container.addEventListener("dragstart", (e) =>
        this.controller!.onNativeDragStart(e, state.key),
      );
      container.addEventListener("dragend", () =>
        this.controller!.onNativeDragEnd(),
      );
    }

    this.applyItemSelectionAttrs(container, state);

    const cleanup = this.renderer.mount(state.key, item, inner);
    this.listbox.appendChild(container);

    this.renderedItems.set(state.key, {
      element: container,
      inner,
      cleanup,
      index: state.index,
    });
  }

  private updateItem(existing: RenderedItem, state: DndRenderItem): void {
    existing.element.style.top = `${state.top}px`;
    // Don't clobber the expanded item's animated height while it's animating
    // open/close — virtualization owns its target height via getRenderState
    // and ResizeObserver feeds back the live measurement.
    existing.element.style.height = `${state.height}px`;
    existing.index = state.index;

    if (state.expanded) {
      existing.inner.dataset.expanded = "";
    } else {
      delete existing.inner.dataset.expanded;
    }

    this.applyItemSelectionAttrs(existing.element, state);
  }

  private applyItemSelectionAttrs(
    el: HTMLElement,
    state: DndRenderItem,
  ): void {
    el.setAttribute("aria-selected", String(state.selected));
    if (state.selected) {
      el.dataset.selected = "";
    } else {
      delete el.dataset.selected;
    }
    if (state.selFirst) el.dataset.selFirst = "";
    else delete el.dataset.selFirst;
    if (state.selLast) el.dataset.selLast = "";
    else delete el.dataset.selLast;
  }

  private clearAllItems(): void {
    for (const [, item] of this.renderedItems) {
      item.cleanup();
      item.element.remove();
    }
    this.renderedItems.clear();
  }

  private updateStyles(): void {
    const base = `
      .dnd-item {
        position: absolute;
        left: 0;
        right: 0;
        overflow: hidden;
        transition: top 0.15s ease, height 0.15s ease;
      }
      .dnd-item-inner {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
      }
      .dnd-item-inner[data-expanded] {
        bottom: auto;
      }
      [data-selected] { background: var(--dnd-select-bg, transparent); z-index: 1; }
    `;
    if (!this.roundedSelect) {
      this.styleEl.textContent = base;
      return;
    }
    this.styleEl.textContent = `
      ${base}
      [data-sel-first] { border-top-left-radius: ${BORDER_RADIUS_PX}px; border-top-right-radius: ${BORDER_RADIUS_PX}px; }
      [data-sel-last] { border-bottom-left-radius: ${BORDER_RADIUS_PX}px; border-bottom-right-radius: ${BORDER_RADIUS_PX}px; }
    `;
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  private cleanup(): void {
    if (this.controller) {
      this.parentEl.removeEventListener("scroll", this.controller.onScroll);
      this.listbox.removeEventListener("keydown", this.controller.onKeyDown);
      this.listbox.removeEventListener("mousedown", this.controller.onMouseDown);
      this.listbox.removeEventListener("click", this.controller.onClick);
      this.listbox.removeEventListener("dblclick", this.controller.onDblClick);
      this.listbox.removeEventListener("touchstart", this.controller.onTouchStart);
      this.listbox.removeEventListener("touchmove", this.controller.onTouchMove);
      this.listbox.removeEventListener("touchend", this.controller.onTouchEnd);
      this.controller.destroy();
      this.controller = null;
    }
    this.clearAllItems();
  }
}

/**
 * DOM-based drop-position placeholder. A single absolutely-positioned div
 * moved via transform; opacity fades in/out via CSS transition.
 */
export class DndPlaceholder {
  private el: HTMLElement;

  /** @param gap px shaved off the bottom of the slot so the placeholder
   *  matches gapped cards (e.g. the board). 0 = fills the whole slot,
   *  matching the flush list view. */
  constructor(itemHeight: number, borderRadius: number, gap = 0) {
    this.el = document.createElement("div");
    this.el.className = "dnd-drop-placeholder";
    this.el.style.cssText =
      `position:absolute;left:0;right:0;top:0;` +
      `height:${itemHeight - gap}px;` +
      `border-radius:${borderRadius}px;` +
      `background:var(--dnd-placeholder-color, #3b82f6);` +
      `pointer-events:none;z-index:1;` +
      `opacity:0;transition:opacity 0.15s ease;` +
      `transform:translateY(0);will-change:transform,opacity;`;
  }

  /** Resize when the slot height or gap changes (config live-update). */
  setSize(itemHeight: number, gap = 0): void {
    this.el.style.height = `${itemHeight - gap}px`;
  }

  getElement(): HTMLElement {
    return this.el;
  }

  /**
   * Move placeholder to y and fade in. Pass null to fade out.
   * @param y - Y position in viewport-relative pixels (already accounting for scrollTop).
   */
  renderPlaceholder(y: number | null): void {
    if (y === null) {
      this.el.style.opacity = "0";
      return;
    }
    this.el.style.transform = `translateY(${y}px)`;
    this.el.style.opacity = "1";
  }

  clear(): void {
    this.el.style.opacity = "0";
  }
}

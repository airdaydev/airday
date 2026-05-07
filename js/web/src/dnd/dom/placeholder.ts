/**
 * DOM-based drop-position placeholder. A single absolutely-positioned div
 * moved via transform; opacity fades in/out via CSS transition.
 */
export class DndPlaceholder {
  private el: HTMLElement;

  constructor(itemHeight: number, borderRadius: number) {
    this.el = document.createElement("div");
    this.el.className = "dnd-drop-placeholder";
    this.el.style.cssText =
      `position:absolute;left:0;right:0;top:0;` +
      `height:${itemHeight}px;` +
      `border-radius:${borderRadius}px;` +
      `background:var(--dnd-placeholder-color, #3b82f6);` +
      `pointer-events:none;z-index:1;` +
      `opacity:0;transition:opacity 0.15s ease;` +
      `transform:translateY(0);will-change:transform,opacity;`;
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

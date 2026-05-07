/**
 * that follow the cursor with increasing lag per depth level.
 */
export class DndDragOverlay {
  private overlay: HTMLElement | null = null;
  private stackEls: HTMLElement[] = [];
  private countBadge: HTMLElement | null = null;
  private positions: { x: number; y: number }[] = [];
  private targetPos = { x: 0, y: 0 };
  private raf: number | null = null;
  private active = false;
  private grabOffset = { x: 0, y: 0 };

  constructor(private stackCount: number) {}

  /**
   * Create the overlay and clone the first N selected item elements.
   * @param elements - The selected item DOM elements (first stackCount used)
   * @param totalCount - Total number of dragged items (for badge)
   * @param startX - Initial cursor X
   * @param startY - Initial cursor Y
   * @param itemHeight - Height of a single item row
   * @param listWidth - Width of the list container
   */
  start(
    elements: HTMLElement[],
    totalCount: number,
    startX: number,
    startY: number,
    itemHeight: number,
    listWidth: number,
    grabElement: HTMLElement,
  ): void {
    this.active = true;

    // Compute grab offset: distance from cursor to the grabbed element's top-left
    const rect = grabElement.getBoundingClientRect();
    this.grabOffset = { x: rect.left - startX, y: rect.top - startY };

    this.targetPos = { x: startX + this.grabOffset.x, y: startY + this.grabOffset.y };

    // Create full-page overlay
    this.overlay = document.createElement("div");
    this.overlay.style.cssText =
      "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:9999;pointer-events:none;";
    document.body.appendChild(this.overlay);

    // Clone items into stack, each wrapped in a sized container
    const count = Math.min(elements.length, this.stackCount);
    this.stackEls = [];
    this.positions = [];

    // Resolve background from the first element's computed style (since
    // the overlay is appended to <body>, CSS vars from the component won't cascade)
    const resolvedBg =
      elements.length > 0
        ? getComputedStyle(elements[0]).backgroundColor
        : "#fff";

    for (let i = 0; i < count; i++) {
      const clone = elements[i].cloneNode(true) as HTMLElement;
      clone.style.position = "relative";
      clone.style.top = "0";
      clone.style.left = "0";
      clone.style.right = "auto";
      clone.style.transition = "none";

      const wrapper = document.createElement("div");
      const offset = i * 2;
      const shadow =
        i === 0
          ? "var(--dnd-drag-shadow, 0 0 0 1px color-mix(in oklab,#0000330f,#f0f0f3 25%),0 12px 60px #00000026,0 12px 32px -16px #0009321f)"
          : "none";
      wrapper.style.cssText = `
        position:absolute;
        pointer-events:none;
        opacity:${1 - i * 0.1};
        z-index:${this.stackCount - i};
        transform:translate(0, ${offset}px);
        width:${listWidth}px;
        height:${itemHeight}px;
        background:${resolvedBg};
        box-shadow:${shadow};
        overflow:hidden;
      `;

      wrapper.appendChild(clone);
      this.overlay.appendChild(wrapper);
      this.stackEls.push(wrapper);
      this.positions.push({ x: this.targetPos.x, y: this.targetPos.y });
    }

    // Count badge — appended to overlay directly so it isn't clipped by overflow:hidden.
    // Anchored by its right-middle via transform, then positioned at the right edge
    // of the leading card, vertically centered.
    if (totalCount > 1) {
      this.countBadge = document.createElement("div");
      this.countBadge.textContent = `${totalCount} items`;
      this.countBadge.style.cssText = `
        position:absolute;
        height:20px;
        border-radius:10px;
        background:#3b82f6;color:#fff;
        font-size:12px;
        display:flex;align-items:center;justify-content:center;
        padding:0 8px;
        transform:translate(-50%, -100%);
        z-index:${this.stackCount + 1};
      `;
      this.overlay.appendChild(this.countBadge);
    }

    this.animate();
  }

  /** Update cursor target position. */
  updatePosition(x: number, y: number): void {
    this.targetPos = { x: x + this.grabOffset.x, y: y + this.grabOffset.y };
  }

  /** Tear down overlay and cancel animation. */
  stop(): void {
    this.active = false;
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    this.stackEls = [];
    this.countBadge = null;
    this.positions = [];
  }

  isActive(): boolean {
    return this.active;
  }

  private animate = (): void => {
    if (!this.active) return;

    for (let i = 0; i < this.positions.length; i++) {
      // Each deeper level lerps toward the previous level's position
      // with increasing lag, creating a trailing effect
      const target =
        i === 0 ? this.targetPos : this.positions[i - 1];

      const factor = i === 0 ? 0.8 : 0.6 - i * 0.03;
      const clampedFactor = Math.max(factor, 0.4);

      this.positions[i] = {
        x: this.positions[i].x + (target.x - this.positions[i].x) * clampedFactor,
        y: this.positions[i].y + (target.y - this.positions[i].y) * clampedFactor,
      };

      const el = this.stackEls[i];
      if (el) {
        const offset = i * 2;
        el.style.left = `${this.positions[i].x}px`;
        el.style.top = `${this.positions[i].y + offset}px`;
      }
    }

    // Position badge above the cursor.
    // Transform on the badge anchors it by its bottom-center.
    if (this.countBadge) {
      const cursorX = this.targetPos.x - this.grabOffset.x;
      const cursorY = this.targetPos.y - this.grabOffset.y;
      this.countBadge.style.left = `${cursorX}px`;
      this.countBadge.style.top = `${cursorY - 12}px`;
    }

    this.raf = requestAnimationFrame(this.animate);
  };
}

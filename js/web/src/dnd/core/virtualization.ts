export interface VirtualRange {
  startIndex: number;
  endIndex: number;
}

export class DndVirtualization {
  private expandedIndex: number | null = null;
  private expandedHeight = 0;

  constructor(
    private itemHeight: number,
    private overscan: number = 2,
  ) {}

  setItemHeight(h: number): void {
    this.itemHeight = h;
  }

  setOverscan(o: number): void {
    this.overscan = o;
  }

  /** Set which index (if any) is expanded and to what height. */
  setExpanded(index: number | null, expandedHeight: number): void {
    this.expandedIndex = index;
    this.expandedHeight = expandedHeight;
  }

  private get delta(): number {
    return this.expandedIndex !== null
      ? this.expandedHeight - this.itemHeight
      : 0;
  }

  /** Calculate the range of indices to render. */
  calculateRange(
    scrollTop: number,
    viewportHeight: number,
    totalItems: number,
  ): VirtualRange {
    if (this.expandedIndex === null) {
      const startIndex = Math.max(
        Math.floor(scrollTop / this.itemHeight) - this.overscan,
        0,
      );
      const endIndex = Math.min(
        startIndex +
          Math.ceil(viewportHeight / this.itemHeight) +
          this.overscan * 2,
        totalItems,
      );
      return { startIndex, endIndex };
    }

    const rawStart = this.getIndexAtY(scrollTop, totalItems);
    const startIndex = Math.max(rawStart - this.overscan, 0);

    let endIndex = startIndex;
    let cum = this.getItemTop(startIndex);
    const target = scrollTop + viewportHeight;
    while (endIndex < totalItems && cum < target) {
      cum += this.getItemHeight(endIndex);
      endIndex++;
    }
    endIndex = Math.min(endIndex + this.overscan * 2, totalItems);
    return { startIndex, endIndex };
  }

  getTotalHeight(itemCount: number): number {
    return itemCount * this.itemHeight + this.delta;
  }

  /** Top position for an item at a given index. */
  getItemTop(index: number): number {
    if (this.expandedIndex !== null && index > this.expandedIndex) {
      return index * this.itemHeight + this.delta;
    }
    return index * this.itemHeight;
  }

  /** Height of the item at a given index. */
  getItemHeight(index: number): number {
    return index === this.expandedIndex ? this.expandedHeight : this.itemHeight;
  }

  /** Find which item index is at a given Y coordinate (relative to list top). */
  getIndexAtY(y: number, totalItems: number): number {
    if (this.expandedIndex === null) {
      const idx = Math.floor(y / this.itemHeight);
      return Math.max(0, Math.min(idx, totalItems - 1));
    }
    const expandedTop = this.expandedIndex * this.itemHeight;
    if (y < expandedTop) {
      const idx = Math.floor(y / this.itemHeight);
      return Math.max(0, Math.min(idx, totalItems - 1));
    }
    if (y < expandedTop + this.expandedHeight) {
      return this.expandedIndex;
    }
    const afterY = y - expandedTop - this.expandedHeight;
    const idx = this.expandedIndex + 1 + Math.floor(afterY / this.itemHeight);
    return Math.max(0, Math.min(idx, totalItems - 1));
  }

  /** Get the scroll offset needed to bring an item into view. Returns null if already visible. */
  getScrollToOffset(
    index: number,
    scrollTop: number,
    viewportHeight: number,
  ): number | null {
    const itemTop = this.getItemTop(index);
    const itemBottom = itemTop + this.getItemHeight(index);

    if (itemTop < scrollTop) {
      return itemTop;
    }
    if (itemBottom > scrollTop + viewportHeight) {
      return itemBottom - viewportHeight;
    }
    return null;
  }
}

import type { Key, Block, Selection } from "./types";

type SelectionListener = (sel: DndSelection) => void;

/**
 * Multi-block selection model with merge logic.
 *
 * Blocks are contiguous ranges defined by (anchor, to). The anchor is the
 * stable end set when the block is created; `to` is the fluid end that moves
 * during shift-extend operations. Blocks are always stored sorted by their
 * top position in the list and never overlap — the merge step guarantees this.
 */
export class DndSelection {
  private blocks: Block[] = [];
  private active: Block | null = null;

  /** Key → position index for O(1) lookups. */
  private orderIndex = new Map<Key, number>();
  /** Position → key (reverse of orderIndex). */
  private indexToKey: Key[] = [];
  /** The exact array last indexed by `updateOrder`. `DndSource` only
   *  ever *replaces* its order array (never mutates in place), so
   *  reference identity is a reliable "nothing changed" signal. */
  private lastIndexedOrder: readonly Key[] | null = null;
  /** Memoized `getSelectedKeySet()`. Selected keys are re-derived from
   *  blocks × order on every render pass — during a drag that's every
   *  pointermove, which at a 10k-row selection means a 10k Set rebuild
   *  per frame. Invalidated by `notify()` (every block mutation ends
   *  there — it's the listener contract) and by an order reindex. */
  private selectedSetCache: ReadonlySet<Key> | null = null;

  private listeners = new Set<SelectionListener>();

  constructor(order: readonly Key[] = []) {
    this.updateOrder(order);
  }

  // ── Observers ───────────────────────────────────────────────────

  onChange(cb: SelectionListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify(): void {
    this.selectedSetCache = null;
    for (const cb of this.listeners) cb(this);
  }

  // ── Order management ────────────────────────────────────────────

  updateOrder(order: readonly Key[]): void {
    // Order-version guard: called from several controller paths per
    // update pass *and* from getRenderState on every scroll event —
    // almost always with an order it has already indexed. The reference
    // check makes those redundant calls free; only a genuinely new
    // array pays the O(rows) rebuild. See spec/list-perf-plan.md.
    if (order === this.lastIndexedOrder) return;
    this.lastIndexedOrder = order;
    this.selectedSetCache = null;
    this.orderIndex.clear();
    this.indexToKey = [...order];
    for (let i = 0; i < order.length; i++) {
      this.orderIndex.set(order[i], i);
    }
  }

  // ── Queries ─────────────────────────────────────────────────────

  getSelection(): Selection {
    return { blocks: this.blocks, active: this.active };
  }

  isSelected(key: Key): boolean {
    for (const block of this.blocks) {
      if (this.keyInBlock(key, block)) return true;
    }
    return false;
  }

  /** Memoized Set view of `getSelectedKeys()` for hot `.has()` paths
   *  (render passes, drag frames). Do not mutate. */
  getSelectedKeySet(): ReadonlySet<Key> {
    return (this.selectedSetCache ??= new Set(this.getSelectedKeys()));
  }

  /** Returns selected keys in list order. */
  getSelectedKeys(): Key[] {
    const keys: Key[] = [];
    for (const block of this.blocks) {
      const [top, bottom] = this.blockRange(block);
      for (let i = top; i <= bottom; i++) {
        keys.push(this.indexToKey[i]);
      }
    }
    return keys;
  }

  hasSelection(): boolean {
    return this.blocks.length > 0;
  }

  getActiveBlock(): Block | null {
    return this.active;
  }

  /** Get the topmost selected key. */
  getSelectionTop(): Key | null {
    if (this.blocks.length === 0) return null;
    return this.indexToKey[this.blockTop(this.blocks[0])];
  }

  /** Get the bottommost selected key. */
  getSelectionBottom(): Key | null {
    if (this.blocks.length === 0) return null;
    return this.indexToKey[this.blockBottom(this.blocks[this.blocks.length - 1])];
  }

  // ── Operations ──────────────────────────────────────────────────

  selectOnly(item: Key): void {
    const block: Block = { anchor: item, to: item };
    this.blocks = [block];
    this.active = block;
    this.notify();
  }

  addBlock(item: Key): void {
    const block: Block = { anchor: item, to: item };
    this.blocks.push(block);
    this.active = block;
    this.merge();
    this.notify();
  }

  extendActive(item: Key): void {
    if (!this.active) {
      this.selectOnly(item);
      return;
    }
    const anchorIdx = this.orderIndex.get(this.active.anchor)!;
    const toIdx = this.orderIndex.get(this.active.to)!;
    const itemIdx = this.orderIndex.get(item)!;
    // If the new target is past the anchor (opposite side from current `to`),
    // pivot the anchor to the current `to` so the block grows rather than
    // flips — shift+select outside the current range is always additive.
    if (anchorIdx !== toIdx && Math.sign(itemIdx - anchorIdx) === -Math.sign(toIdx - anchorIdx)) {
      this.active.anchor = this.active.to;
    }
    this.active.to = item;
    this.merge();
    this.notify();
  }

  toggleItem(item: Key): void {
    if (this.isSelected(item)) {
      this.removeItem(item);
    } else {
      this.addBlock(item);
    }
    this.notify();
  }

  moveSelection(dir: "up" | "down"): void {
    if (this.blocks.length === 0) return;

    const delta = dir === "up" ? -1 : 1;
    const totalItems = this.indexToKey.length;

    // Check if movement is possible (all blocks can shift without going out of bounds)
    for (const block of this.blocks) {
      const [top, bottom] = this.blockRange(block);
      if (dir === "up" && top <= 0) return;
      if (dir === "down" && bottom >= totalItems - 1) return;
    }

    // Shift all blocks
    for (const block of this.blocks) {
      const anchorIdx = this.orderIndex.get(block.anchor)!;
      const toIdx = this.orderIndex.get(block.to)!;
      block.anchor = this.indexToKey[anchorIdx + delta];
      block.to = this.indexToKey[toIdx + delta];
    }

    this.merge();
    this.notify();
  }

  selectAll(): void {
    if (this.indexToKey.length === 0) return;
    const block: Block = {
      anchor: this.indexToKey[0],
      to: this.indexToKey[this.indexToKey.length - 1],
    };
    this.blocks = [block];
    this.active = block;
    this.notify();
  }

  clear(): void {
    this.blocks = [];
    this.active = null;
    this.notify();
  }

  // ── Relative identifiers ───────────────────────────────────────

  first(): Key {
    return this.indexToKey[0];
  }

  last(): Key {
    return this.indexToKey[this.indexToKey.length - 1];
  }

  next(item: Key): Key {
    const idx = this.orderIndex.get(item);
    if (idx === undefined) return item;
    return idx < this.indexToKey.length - 1 ? this.indexToKey[idx + 1] : item;
  }

  prev(item: Key): Key {
    const idx = this.orderIndex.get(item);
    if (idx === undefined) return item;
    return idx > 0 ? this.indexToKey[idx - 1] : item;
  }

  activeTop(): Key | null {
    if (!this.active) return null;
    return this.indexToKey[this.blockTop(this.active)];
  }

  activeBottom(): Key | null {
    if (!this.active) return null;
    return this.indexToKey[this.blockBottom(this.active)];
  }

  // ── Private helpers ─────────────────────────────────────────────

  private removeItem(item: Key): void {
    const itemIdx = this.orderIndex.get(item);
    if (itemIdx === undefined) return;

    const newBlocks: Block[] = [];

    for (const block of this.blocks) {
      const [top, bottom] = this.blockRange(block);

      if (itemIdx < top || itemIdx > bottom) {
        // Item not in this block
        newBlocks.push(block);
        continue;
      }

      if (top === bottom) {
        // Single-item block, remove entirely
        if (this.active === block) this.active = null;
        continue;
      }

      if (itemIdx === top) {
        // Remove from top
        block.anchor = this.indexToKey[top + 1];
        block.to = this.indexToKey[bottom];
        newBlocks.push(block);
      } else if (itemIdx === bottom) {
        // Remove from bottom
        block.anchor = this.indexToKey[top];
        block.to = this.indexToKey[bottom - 1];
        newBlocks.push(block);
      } else {
        // Split: item is interior
        const upper: Block = {
          anchor: this.indexToKey[top],
          to: this.indexToKey[itemIdx - 1],
        };
        const lower: Block = {
          anchor: this.indexToKey[itemIdx + 1],
          to: this.indexToKey[bottom],
        };
        newBlocks.push(upper, lower);
        if (this.active === block) {
          this.active = lower;
        }
      }
    }

    this.blocks = newBlocks;

    // If active was removed, pick nearest remaining
    if (this.active === null && this.blocks.length > 0) {
      // Pick the block closest to the removed item
      let closest = this.blocks[0];
      let closestDist = Infinity;
      for (const b of this.blocks) {
        const [t, bo] = this.blockRange(b);
        const dist = Math.min(
          Math.abs(t - itemIdx),
          Math.abs(bo - itemIdx),
        );
        if (dist < closestDist) {
          closestDist = dist;
          closest = b;
        }
      }
      this.active = closest;
    }

    this.notify();
  }

  private merge(): void {
    if (this.blocks.length <= 1) return;

    // Preserve active's anchor before merge
    const activeAnchor = this.active?.anchor ?? null;

    // Sort blocks by their top position
    this.blocks.sort(
      (a, b) => this.blockTop(a) - this.blockTop(b),
    );

    const merged: Block[] = [];
    let current = this.blocks[0];
    let currentHasActive = this.active === current;

    for (let i = 1; i < this.blocks.length; i++) {
      const next = this.blocks[i];
      const currentBottom = this.blockBottom(current);
      const nextTop = this.blockTop(next);

      if (currentBottom + 1 >= nextTop) {
        // Adjacent or overlapping — merge
        const newTop = this.blockTop(current);
        const newBottom = Math.max(currentBottom, this.blockBottom(next));
        if (this.active === next) currentHasActive = true;

        if (currentHasActive && activeAnchor !== null) {
          // Preserve active's anchor; to = opposite end of merged range
          const anchorIdx = this.orderIndex.get(activeAnchor) ?? newTop;
          const toIdx = anchorIdx === newTop ? newBottom : newTop;
          current = {
            anchor: activeAnchor,
            to: this.indexToKey[toIdx],
          };
        } else {
          current = {
            anchor: this.indexToKey[newTop],
            to: this.indexToKey[newBottom],
          };
        }
      } else {
        merged.push(current);
        current = next;
        currentHasActive = this.active === next;
      }
    }
    merged.push(current);

    // Update active to the merged block that contains it
    if (currentHasActive || !merged.includes(this.active!)) {
      if (this.active) {
        const activeTop = this.blockTop(this.active);
        for (const b of merged) {
          const [t, bo] = this.blockRange(b);
          if (activeTop >= t && activeTop <= bo) {
            this.active = b;
            break;
          }
        }
      }
    }

    this.blocks = merged;
  }

  /** Get [topIndex, bottomIndex] for a block, handling anchor > to. */
  private blockRange(block: Block): [number, number] {
    const a = this.orderIndex.get(block.anchor) ?? 0;
    const b = this.orderIndex.get(block.to) ?? 0;
    return a <= b ? [a, b] : [b, a];
  }

  private blockTop(block: Block): number {
    return this.blockRange(block)[0];
  }

  private blockBottom(block: Block): number {
    return this.blockRange(block)[1];
  }

  private keyInBlock(key: Key, block: Block): boolean {
    const idx = this.orderIndex.get(key);
    if (idx === undefined) return false;
    const [top, bottom] = this.blockRange(block);
    return idx >= top && idx <= bottom;
  }
}

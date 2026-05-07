import type { Key } from "../core/types";

export type TouchResult =
  | { type: "select"; key: Key }
  | { type: "drag-start"; key: Key; x: number; y: number }
  | { type: "dragging"; x: number; y: number }
  | { type: "drag-end"; x: number; y: number }
  | { type: "scroll" }
  | { type: "none" };

const LONG_PRESS_MS = 150;
const DRAG_BUFFER_PX = 3;

/**
 * Distinguishes tap (select), scroll, and long-press drag on touch devices.
 * No multi-select on touch.
 */
export class DndTouch {
  private startPos: { x: number; y: number } | null = null;
  private startKey: Key | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTriggered = false;
  private isDragging = false;

  onTouchStart(key: Key, x: number, y: number): void {
    this.startPos = { x, y };
    this.startKey = key;
    this.longPressTriggered = false;
    this.isDragging = false;

    this.clearTimer();
    this.longPressTimer = setTimeout(() => {
      this.longPressTriggered = true;
    }, LONG_PRESS_MS);
  }

  onTouchMove(x: number, y: number): TouchResult {
    if (!this.startPos || this.startKey === null) return { type: "none" };

    const dx = x - this.startPos.x;
    const dy = y - this.startPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < DRAG_BUFFER_PX) return { type: "none" };

    if (!this.longPressTriggered) {
      // Moved before long press — it's a scroll
      this.clearTimer();
      this.reset();
      return { type: "scroll" };
    }

    // Long press triggered and moved past buffer — drag
    if (!this.isDragging) {
      this.isDragging = true;
      return { type: "drag-start", key: this.startKey, x, y };
    }

    return { type: "dragging", x, y };
  }

  onTouchEnd(x: number, y: number): TouchResult {
    this.clearTimer();

    if (this.isDragging) {
      const result: TouchResult = { type: "drag-end", x, y };
      this.reset();
      return result;
    }

    if (this.startKey !== null) {
      const key = this.startKey;
      this.reset();
      return { type: "select", key };
    }

    this.reset();
    return { type: "none" };
  }

  isDraggingState(): boolean {
    return this.isDragging;
  }

  cancel(): void {
    this.clearTimer();
    this.reset();
  }

  private clearTimer(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private reset(): void {
    this.startPos = null;
    this.startKey = null;
    this.longPressTriggered = false;
    this.isDragging = false;
  }
}

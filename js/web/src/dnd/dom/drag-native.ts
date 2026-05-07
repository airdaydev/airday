import type { Key, DndRenderer } from "../core/types";

/**
 * HTML5 native drag-and-drop mode.
 * Sets draggable=true and uses dataTransfer for inter-app drops.
 */
export class DndDragNative<T> {
  private dragging = false;
  private draggedKeys: Key[] = [];

  constructor(private renderer: DndRenderer<T>) {}

  /** Call from dragstart event on a list item. */
  onDragStart(
    e: DragEvent,
    keys: Key[],
    items: T[],
  ): void {
    this.dragging = true;
    this.draggedKeys = keys;

    // Set native drop data if renderer provides it
    if (this.renderer.getNativeDropData && e.dataTransfer) {
      const data = this.renderer.getNativeDropData(keys, items);
      for (const { type, data: value } of data) {
        e.dataTransfer.setData(type, value);
      }
      e.dataTransfer.effectAllowed = "move";
    }
  }

  /** Call from dragend event. */
  onDragEnd(): void {
    this.dragging = false;
    this.draggedKeys = [];
  }

  isDragging(): boolean {
    return this.dragging;
  }

  getDraggedKeys(): Key[] {
    return this.draggedKeys;
  }

  setRenderer(renderer: DndRenderer<T>): void {
    this.renderer = renderer;
  }
}

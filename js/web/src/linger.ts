export interface CapturedPosition<T> {
  index: number;
  value: T;
}

/**
 * Restore removals whose indices were captured one after another.
 *
 * Every later index is relative to a list already missing the earlier
 * removals. Replaying them newest-first is the inverse operation and
 * reconstructs the original layout.
 */
export function restoreCapturedPositions<T>(
  items: T[],
  capturedInOrder: readonly CapturedPosition<T>[],
): void {
  for (let i = capturedInOrder.length - 1; i >= 0; i--) {
    const captured = capturedInOrder[i];
    items.splice(Math.min(Math.max(captured.index, 0), items.length), 0, captured.value);
  }
}

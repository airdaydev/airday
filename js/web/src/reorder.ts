export interface ReorderMove {
  id: string;
  index: number;
}

/**
 * Plan a same-list reorder using only the rows the user actually dragged.
 *
 * Moving every row whose index differs makes a one-row downward drag cost
 * the distance travelled in CRDT commits (and therefore undo steps). Moving
 * the selected rows toward the destination in the appropriate direction
 * reaches the same final order with at most one move per selected row.
 */
export function planReorderMoves(
  ids: readonly string[],
  movedKeys: readonly string[],
  beforeKey: string | null,
): ReorderMove[] {
  const movedSet = new Set(movedKeys);
  const movedIds = ids.filter((id) => movedSet.has(id));
  if (movedIds.length === 0) return [];

  const remaining = ids.filter((id) => !movedSet.has(id));
  const beforeIndex = beforeKey === null ? -1 : remaining.indexOf(beforeKey);
  const insertAt = beforeIndex >= 0 ? beforeIndex : remaining.length;

  const indexed = movedIds.map((id, offset) => ({
    id,
    offset,
    originalIndex: ids.indexOf(id),
  }));
  const expected = [...remaining];
  expected.splice(insertAt, 0, ...movedIds);
  const anchorIndex = beforeKey === null ? ids.length : ids.indexOf(beforeKey);
  // Rows crossing the anchor from above must move bottom-up; rows crossing
  // it from below must move top-down. This also handles discontiguous
  // selections straddling the drop point with one move per selected row.
  const above = indexed.filter((it) => it.originalIndex < anchorIndex).reverse();
  const below = indexed.filter((it) => it.originalIndex > anchorIndex);

  const current = [...ids];
  const moves: ReorderMove[] = [];
  for (const { id, offset } of [...above, ...below]) {
    const from = current.indexOf(id);
    const index = insertAt + offset;
    if (from < 0 || from === index) continue;
    moves.push({ id, index });
    current.splice(from, 1);
    current.splice(index, 0, id);
  }
  if (!current.every((id, i) => id === expected[i])) {
    throw new Error("reorder planner failed to converge");
  }
  return moves;
}

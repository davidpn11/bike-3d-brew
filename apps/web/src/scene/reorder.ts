// Comment ordering. The panel often shows a subset (one area's comments), so a move reorders
// only the shown items among the slots they already occupy; everything else keeps its place.
// The order of scene.annotations is the order customers see, and the pin numbers.

/**
 * Moves the item `id` to position `to` within the subset `visible` (ids in display order; all
 * items when omitted). Returns the same array when nothing changes.
 */
export function moveItem<T extends { id: string }>(list: T[], id: string, to: number, visible?: readonly string[]): T[] {
  if (!Number.isFinite(to)) return list;
  const shown = new Set(visible ?? list.map((x) => x.id));
  const slots: number[] = [];
  list.forEach((x, i) => shown.has(x.id) && slots.push(i));
  const order = slots.map((i) => list[i]);
  const from = order.findIndex((x) => x.id === id);
  const target = Math.max(0, Math.min(order.length - 1, Math.trunc(to)));
  if (from < 0 || from === target) return list;
  const [item] = order.splice(from, 1);
  order.splice(target, 0, item);
  const out = list.slice();
  slots.forEach((slot, k) => (out[slot] = order[k]));
  return out;
}

/** Moves `id` one place up (-1) or down (+1) within the shown subset. */
export function stepItem<T extends { id: string }>(list: T[], id: string, delta: -1 | 1, visible?: readonly string[]): T[] {
  const ids = visible ?? list.map((x) => x.id);
  const from = ids.indexOf(id);
  if (from < 0) return list;
  return moveItem(list, id, from + delta, ids);
}

/**
 * Where a dragged item lands: the number of other items whose vertical midpoint is above the
 * pointer. `mids` are the midpoints of all items in display order, `from` the dragged index.
 */
export function dropIndex(mids: readonly number[], from: number, y: number): number {
  let n = 0;
  mids.forEach((m, i) => i !== from && y > m && n++);
  return n;
}

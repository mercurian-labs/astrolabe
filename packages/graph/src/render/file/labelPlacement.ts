/**
 * Labels that would land on each other: the more important keeps its place and the other gives way
 * until zoom parts them, as a map does. Run on every drawn frame, so it works in buffers kept
 * between frames and allocates nothing.
 */

/** A label is drawn above this alpha; one at or under it takes no room. */
export const LABEL_VISIBLE = 0.01;
/** Labels keep at least this much paper between them, in CSS pixels. */
export const LABEL_ROOM = 2;

/** Each label's box in CSS pixels, one slot per node: centred on `x`, `top` down `height`. */
export interface LabelBoxes {
  readonly x: Float64Array;
  readonly top: Float64Array;
  readonly width: Float64Array;
  readonly height: Float64Array;
}

export const labelBoxes = (count: number): LabelBoxes => ({
  x: new Float64Array(count),
  top: new Float64Array(count),
  width: new Float64Array(count),
  height: new Float64Array(count),
});

/** Whether two boxes come nearer than `LABEL_ROOM`. */
function crowds(boxes: LabelBoxes, a: number, b: number): boolean {
  const across =
    Math.abs((boxes.x[a] ?? 0) - (boxes.x[b] ?? 0)) -
    ((boxes.width[a] ?? 0) + (boxes.width[b] ?? 0)) / 2;
  const aHeight = boxes.height[a] ?? 0;
  const bHeight = boxes.height[b] ?? 0;
  const down =
    Math.abs((boxes.top[a] ?? 0) + aHeight / 2 - (boxes.top[b] ?? 0) - bHeight / 2) -
    (aHeight + bHeight) / 2;
  return across < LABEL_ROOM && down < LABEL_ROOM;
}

/**
 * Places labels in `order`: a label `alpha` shows keeps it unless it crowds one placed before it,
 * and is hidden (0) if it does. The first `forced` of `order` show whatever they crowd, as a
 * hover's labels do; the rest make way for them too. `placed` is scratch, one slot per node.
 */
export function placeLabels(
  boxes: LabelBoxes,
  alpha: Float64Array,
  order: Int32Array,
  forced: number,
  placed: Int32Array,
): void {
  let count = 0;
  for (let at = 0; at < order.length; at += 1) {
    const index = order[at] ?? 0;
    if ((alpha[index] ?? 0) <= LABEL_VISIBLE) continue;
    let crowded = false;
    if (at >= forced) {
      for (let each = 0; each < count && !crowded; each += 1) {
        crowded = crowds(boxes, index, placed[each] ?? 0);
      }
    }
    if (crowded) {
      alpha[index] = 0;
      continue;
    }
    placed[count] = index;
    count += 1;
  }
}

/**
 * Nodes in the order their labels claim room: by `rank`, lowest first, then by `weight`, largest
 * first, then as given.
 */
export function labelOrder(
  count: number,
  rank: (index: number) => number,
  weight: (index: number) => number,
): Int32Array {
  const ranks = Array.from({ length: count }, (_, index) => rank(index));
  const weights = Array.from({ length: count }, (_, index) => weight(index));
  return Int32Array.from(
    Array.from({ length: count }, (_, index) => index).toSorted(
      (a, b) => (ranks[a] ?? 0) - (ranks[b] ?? 0) || (weights[b] ?? 0) - (weights[a] ?? 0) || a - b,
    ),
  );
}

/**
 * Astrolabe: which region the focus moves (`focus.left` …) move to, as Vim and tmux
 * choose a window: geometrically, from the focused region's box. See `regions.ts` for what the
 * regions are on the page.
 */

export type FocusDirection = "left" | "down" | "up" | "right";

export interface RegionBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface RegionCandidate<Region> {
  readonly region: Region;
  readonly box: RegionBox;
  /** When it last had focus, higher for later; 0 for never. Breaks a tie between equals. */
  readonly recency: number;
}

/** Boxes that touch share an edge within this many pixels (a 1px divider, rounding). */
const EDGE_SLACK_PX = 2;

/**
 * How far `box` lies beyond `from` in `direction`, 0 for a box touching it; null when it does not
 * lie that way.
 */
function distanceToward(from: RegionBox, box: RegionBox, direction: FocusDirection) {
  const gap =
    direction === "left"
      ? from.left - box.right
      : direction === "right"
        ? box.left - from.right
        : direction === "up"
          ? from.top - box.bottom
          : box.top - from.bottom;
  if (gap < -EDGE_SLACK_PX) return null;
  return gap <= EDGE_SLACK_PX ? 0 : gap;
}

/** How much `box` overlaps `from` across `direction` (rows for left and right). */
function overlapAcross(from: RegionBox, box: RegionBox, direction: FocusDirection) {
  return direction === "left" || direction === "right"
    ? Math.min(from.bottom, box.bottom) - Math.max(from.top, box.top)
    : Math.min(from.right, box.right) - Math.max(from.left, box.left);
}

const centre = (box: RegionBox) => ({
  x: (box.left + box.right) / 2,
  y: (box.top + box.bottom) / 2,
});

/**
 * The region `direction` moves to from `from`: of the candidates lying that way, the nearest one
 * overlapping it across the direction (the most recently focused, then the most overlapping,
 * between equally near ones), else the one whose centre is nearest. Null at the edge: it never
 * wraps around.
 */
export function neighbourRegion<Region>(
  from: RegionBox,
  candidates: ReadonlyArray<RegionCandidate<Region>>,
  direction: FocusDirection,
): Region | null {
  const toward = candidates.flatMap((candidate) => {
    const distance = distanceToward(from, candidate.box, direction);
    return distance === null ? [] : [{ ...candidate, distance }];
  });
  const overlapping = toward
    .map((candidate) => ({ ...candidate, overlap: overlapAcross(from, candidate.box, direction) }))
    .filter((candidate) => candidate.overlap > EDGE_SLACK_PX);
  if (overlapping.length > 0) {
    const [best] = overlapping.toSorted(
      (a, b) => a.distance - b.distance || b.recency - a.recency || b.overlap - a.overlap,
    );
    return best?.region ?? null;
  }
  const origin = centre(from);
  const [nearest] = toward
    .map((candidate) => {
      const point = centre(candidate.box);
      return { ...candidate, far: Math.hypot(point.x - origin.x, point.y - origin.y) };
    })
    .toSorted((a, b) => a.far - b.far || b.recency - a.recency);
  return nearest?.region ?? null;
}

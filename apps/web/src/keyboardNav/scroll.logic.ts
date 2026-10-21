/**
 * Astrolabe: what the scroll commands (`scroll.down`, `scroll.up`) move, and by how much: half a
 * page of the focused place's main scroll area, as Vim's Ctrl-D and Ctrl-U. See `scroll.ts` for
 * the scroll areas on the page.
 */

export type ScrollDirection = "down" | "up";

export interface ScrollPosition {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface ScrollCandidate<Area> {
  readonly area: Area;
  /** How much of it shows inside its place, in square pixels. */
  readonly visibleArea: number;
}

/** Rounding leaves a scroll area this far from its end when it is there. */
const END_SLACK_PX = 1;

/**
 * A place's main scroll area, of those in it that scroll: the one showing largest (the chat's
 * timeline over its composer, a note over its outline, the sidebar's list). Null for none.
 */
export function mainScrollArea<Area>(
  candidates: ReadonlyArray<ScrollCandidate<Area>>,
): Area | null {
  let best: ScrollCandidate<Area> | null = null;
  for (const candidate of candidates) {
    if (candidate.visibleArea > 0 && (!best || candidate.visibleArea > best.visibleArea)) {
      best = candidate;
    }
  }
  return best?.area ?? null;
}

/** Whether `position` has anywhere to go `direction`. */
export function canScroll(position: ScrollPosition, direction: ScrollDirection): boolean {
  return direction === "down"
    ? position.scrollTop + position.clientHeight < position.scrollHeight - END_SLACK_PX
    : position.scrollTop > END_SLACK_PX;
}

/** How far one scroll goes `direction`, signed: half the area's height, at least a pixel. */
export function scrollDistance(position: ScrollPosition, direction: ScrollDirection): number {
  const half = Math.max(1, Math.round(position.clientHeight / 2));
  return direction === "down" ? half : -half;
}

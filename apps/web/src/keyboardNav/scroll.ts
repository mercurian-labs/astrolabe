import { placeOf } from "./regions";
import {
  canScroll,
  mainScrollArea,
  scrollDistance,
  type ScrollCandidate,
  type ScrollDirection,
} from "./scroll.logic";

/**
 * Astrolabe: the scroll commands on the page. They move the main scroll area of the place keys
 * act from (see `regions.ts`): of the elements in it that scroll vertically, the one showing
 * largest, so the chat's timeline, a pane's note, diff or file, and the sidebar's list, with no
 * marker of their own. The scroll is instant, as the app's other scrolls by key are.
 */

const SCROLLS = new Set(["auto", "scroll", "overlay"]);

/** How much of `rect` shows inside `bounds`, in square pixels. */
function overlapArea(rect: DOMRect, bounds: DOMRect) {
  const width = Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left);
  const height = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/** The elements in `place` (itself too) that scroll vertically, with how much of each shows. */
function scrollCandidates(place: HTMLElement): ScrollCandidate<HTMLElement>[] {
  const bounds = place.getBoundingClientRect();
  const candidates: ScrollCandidate<HTMLElement>[] = [];
  for (const element of [place, ...place.querySelectorAll<HTMLElement>("*")]) {
    // The cheap test first: most elements have nothing to scroll.
    if (element.scrollHeight - element.clientHeight <= 1) continue;
    if (!SCROLLS.has(getComputedStyle(element).overflowY)) continue;
    if (element.closest("[inert]")) continue;
    candidates.push({
      area: element,
      visibleArea: overlapArea(element.getBoundingClientRect(), bounds),
    });
  }
  return candidates;
}

/** The scroll area a scroll key from `origin` moves; null where its place has none. */
export function scrollAreaFrom(origin: Element | null): HTMLElement | null {
  const place = placeOf(origin);
  return place ? mainScrollArea(scrollCandidates(place)) : null;
}

/**
 * Scrolls the place a key from `origin` acts from half a page `direction`; null where it cannot
 * go that way (no scroll area, or at its end).
 */
export function scrollToward(
  direction: ScrollDirection,
  origin: Element | null,
): (() => void) | null {
  const area = scrollAreaFrom(origin);
  if (!area || !canScroll(area, direction)) return null;
  return () => area.scrollBy({ top: scrollDistance(area, direction) });
}

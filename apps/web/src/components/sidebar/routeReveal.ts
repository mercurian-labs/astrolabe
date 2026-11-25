import { useRef } from "react";

import { observeResize } from "~/lib/observeResize";

// AppSidebarLayout owns this so drawer and Settings remounts keep the reveal; scroll position is
// lost on remount.
// Leaving Settings commits the router's location before its matches, briefly hiding thread params.
// Ignore null keys so the same thread does not look new during that gap.
export interface SidebarRouteReveal {
  observedKey: string | null;
  pendingKey: string | null;
  // A draft's first send names its thread without navigating; the user is not looking for it.
  pendingInPlace?: boolean;
}

export function pendingSidebarRouteReveal(
  reveal: SidebarRouteReveal,
  routeKey: string | null,
  inPlace = false,
): string | null {
  if (routeKey === null) return null;
  if (reveal.observedKey !== routeKey) {
    reveal.observedKey = routeKey;
    reveal.pendingKey = routeKey;
    reveal.pendingInPlace = inPlace;
  }
  return reveal.pendingKey;
}

export function completeSidebarRouteReveal(reveal: SidebarRouteReveal): void {
  reveal.pendingKey = null;
}

// Each route change and each mount scroll to the open thread once. Render records
// the route, so a thread left before its row mounted still counts as a change.
// The row can mount after the route, once its shells arrive, so its ref scrolls.
export function useActiveRowReveal(
  reveal: SidebarRouteReveal,
  routeKey: string | null,
  inPlace = false,
) {
  const mountRevealOwed = useRef(true);
  pendingSidebarRouteReveal(reveal, routeKey, inPlace);
  // Returns a ref cleanup while it waits on a hidden row, so an unmount releases the wait.
  const revealRow = (row: HTMLElement | null, rowKey: string): (() => void) | undefined => {
    if (row === null) return undefined;
    if (reveal.pendingKey !== rowKey && !mountRevealOwed.current) return undefined;
    const revealInPlace = reveal.pendingKey === rowKey && reveal.pendingInPlace === true;
    // A row under the pointer was just clicked, so it is in view. Both cases skip the scroll,
    // so settle them before measuring: this runs mid-commit, where a measure forces layout.
    if (revealInPlace || row.matches(":hover")) {
      completeSidebarRouteReveal(reveal);
      mountRevealOwed.current = false;
      return undefined;
    }
    // The closed narrow sheet keeps rows mounted but hidden, and opening it does not
    // re-render them, so wait for the row to get a box before spending the reveal.
    if (row.getClientRects().length === 0) {
      const stopWaiting = observeResize(row, () => {
        if (row.getClientRects().length === 0) return;
        stopWaiting();
        revealRow(row, rowKey);
      });
      return stopWaiting;
    }
    completeSidebarRouteReveal(reveal);
    mountRevealOwed.current = false;
    // Keyboard activation can come from a focused row scrolled out of view.
    row.scrollIntoView({ block: "nearest" });
    return undefined;
  };
  return revealRow;
}

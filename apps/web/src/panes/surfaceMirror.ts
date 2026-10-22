import {
  activateTab,
  allTabs,
  closeTabs,
  focusedPane,
  isEmptyTab,
  openTab,
  replaceTab,
  surfaceIdOf,
  surfaceKey,
  type Arrangement,
} from "./arrangement";
import { findLeaf, leafWithTab, leaves } from "./tree";

/**
 * T3 Code keeps a thread's right-panel surfaces (browser pages, terminals, Diff, Files, pull
 * requests, devices) in one record per thread: which are open, which is in front, and whether
 * the panel shows. Everything in T3 Code opens, reads and closes surfaces through that record.
 * The right panel's panes mirror it rather than intercept it: a surface in the record is a tab, the record's
 * active surface is that tab shown, and closing either closes both. The functions here are the
 * two directions of that mirror; the panes decide only where each surface tab stands.
 */
export interface PanelRecord {
  readonly isOpen: boolean;
  readonly activeSurfaceId: string | null;
  readonly surfaceIds: readonly string[];
}

export function isTerminalSurface(surfaceId: string) {
  return surfaceId.startsWith("terminal:");
}

/**
 * Where a surface new to the arrangement goes: the pane asked from (`targetPaneId`, as a
 * pane's New tab menu asks), else the pane of the surface that was in front, else any pane
 * holding a surface, as the right panel's strip held them all, else the focused pane.
 */
function surfacePane(
  arrangement: Arrangement,
  previous: PanelRecord | null,
  targetPaneId: string | null,
) {
  if (targetPaneId !== null && findLeaf(arrangement.root, targetPaneId)) return targetPaneId;
  const front = previous?.activeSurfaceId;
  const frontPane = front ? leafWithTab(arrangement.root, surfaceKey(front)) : undefined;
  if (frontPane) return frontPane.id;
  return (
    leaves(arrangement.root).find((leaf) => leaf.tabs.some((key) => surfaceIdOf(key) !== null))
      ?.id ?? focusedPane(arrangement).id
  );
}

/**
 * Brings the panes in line with the record after T3 Code changed it, from `previous` (null on
 * first load) to `record`:
 *
 * - A surface gone from the record closes its tab; one that arrives in the same change takes its
 *   place, as a file opened from the Files explorer replaces it.
 * - Every surface in the record has a tab. A new one opens in the pane asked from, else beside
 *   the others, else in the focused pane.
 * - The record's active surface comes to the front of its pane when it changes or the panel
 *   opens. Pane focus stays where it was, unless the surface opened in the pane asked from. As a
 *   thread loads (`previous` null), a document the pane was left showing (a wiki page, a change
 *   group) stays in front: the record, which knows only surfaces, did not choose otherwise.
 *
 * A closed panel is not drawn, so its tabs simply stay where they stood until it opens again.
 * `consumedTarget` says whether a new surface landed in `targetPaneId`.
 */
export function followRecord(
  current: Arrangement,
  previous: PanelRecord | null,
  record: PanelRecord,
  targetPaneId: string | null = null,
): { readonly arrangement: Arrangement; readonly consumedTarget: boolean } {
  let arrangement = current;
  const present = new Set(record.surfaceIds);
  const dropGone = (next: Arrangement) =>
    closeTabs(
      next,
      allTabs(next).filter((key) => {
        const id = surfaceIdOf(key);
        return id !== null && !present.has(id);
      }),
    );

  // A surface that replaces another in one change, as opening a file replaces the Files
  // explorer, takes its place.
  const gone = allTabs(arrangement).filter((key) => {
    const id = surfaceIdOf(key);
    return id !== null && !present.has(id);
  });
  const arriving = record.surfaceIds.filter((id) => !leafWithTab(arrangement.root, surfaceKey(id)));
  if (targetPaneId === null) {
    gone.forEach((key, index) => {
      const id = arriving[index];
      if (id !== undefined) arrangement = replaceTab(arrangement, key, surfaceKey(id));
    });
  }
  arrangement = dropGone(arrangement);

  let consumedTarget = false;
  const missing = record.surfaceIds.filter((id) => !leafWithTab(arrangement.root, surfaceKey(id)));
  for (const id of missing) {
    const asking = consumedTarget ? null : targetPaneId;
    const home = surfacePane(arrangement, previous, asking);
    const asked = home === targetPaneId;
    arrangement = openTab(arrangement, surfaceKey(id), home, asked);
    consumedTarget ||= asked;
  }

  const opening = record.isOpen && !previous?.isOpen;
  const active = record.activeSurfaceId;
  const front =
    active === null ? undefined : leafWithTab(arrangement.root, surfaceKey(active))?.active;
  const documentLeftInFront =
    previous === null && front !== undefined && surfaceIdOf(front) === null && !isEmptyTab(front);
  if (
    active !== null &&
    present.has(active) &&
    !documentLeftInFront &&
    (opening || previous?.activeSurfaceId !== active || arriving.includes(active))
  ) {
    arrangement = activateTab(arrangement, surfaceKey(active), consumedTarget);
  }
  return { arrangement, consumedTarget };
}

/** The surfaces shown: the active tabs of their panes, in reading order. */
function visibleSurfaces(arrangement: Arrangement, record: PanelRecord): string[] {
  const present = new Set(record.surfaceIds);
  return leaves(arrangement.root).flatMap((leaf) => {
    const id = surfaceIdOf(leaf.active);
    return id !== null && present.has(id) ? [id] : [];
  });
}

/**
 * The surface the record should have in front for the panes as they stand, the other direction
 * of the mirror: the one in the focused pane, else the one already active while it stays shown,
 * else the first shown. The surface the record names is the one T3 Code renders, so only it is
 * live; another shown surface waits for its pane to take focus. Whether the panel shows stays
 * T3 Code's to say.
 */
export function activeSurfaceFor(arrangement: Arrangement, record: PanelRecord): string | null {
  const visible = visibleSurfaces(arrangement, record);
  const focused = surfaceIdOf(focusedPane(arrangement).active);
  if (focused !== null && visible.includes(focused)) return focused;
  const kept = record.activeSurfaceId;
  if (kept !== null && (visible.length === 0 || visible.includes(kept))) return kept;
  return visible[0] ?? null;
}

/** The pane that shows the record's active surface, where T3 Code's surface content goes. */
export function hostPaneId(arrangement: Arrangement, record: PanelRecord): string | null {
  if (!record.isOpen || record.activeSurfaceId === null) return null;
  const key = surfaceKey(record.activeSurfaceId);
  return leaves(arrangement.root).find((leaf) => leaf.active === key)?.id ?? null;
}

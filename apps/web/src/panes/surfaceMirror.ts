import {
  CONVERSATION,
  activateTab,
  allTabs,
  closeTabs,
  focusedPane,
  openBeside,
  openTab,
  replaceTab,
  restoreTabs,
  surfaceIdOf,
  surfaceKey,
  type Arrangement,
} from "./arrangement";
import { findLeaf, leafWithTab, leaves } from "./tree";

/**
 * T3 Code keeps a thread's right-panel surfaces (browser pages, terminals, Diff, Files, pull
 * requests, devices) in one record per thread: which are open, which is in front, and whether
 * the panel shows. Everything in T3 Code opens, reads and closes surfaces through that record.
 * The panes mirror it rather than intercept it: a surface in the record is a tab, the record's
 * active surface is that tab shown, and closing either closes both. The functions here are the
 * two directions of that mirror; the panes decide only where each surface tab stands.
 */
export interface PanelRecord {
  readonly isOpen: boolean;
  readonly activeSurfaceId: string | null;
  readonly surfaceIds: readonly string[];
}

/** The tabs a hidden panel took away, so showing it again puts them back where they stood. */
export interface HiddenSurfaces {
  readonly before: Arrangement;
  readonly after: Arrangement;
}

export interface MirrorState {
  readonly arrangement: Arrangement;
  readonly hidden: HiddenSurfaces | null;
}

/** The share of the conversation's pane a surface takes when it first opens beside it. */
const SURFACE_PANE_WEIGHT = 0.42;

function surfaceTabs(arrangement: Arrangement) {
  return allTabs(arrangement).filter((key) => surfaceIdOf(key) !== null);
}

/**
 * Where a surface new to the arrangement goes: the pane asked from (`targetPaneId`, as a
 * pane's New tab menu asks), else the pane of the surface that was in front, else any pane
 * holding a surface, as the right panel's strip held them all. Null when none holds one.
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
      ?.id ?? null
  );
}

/**
 * Brings the panes in line with the record after T3 Code changed it, from `previous` (null on
 * first load) to `record`:
 *
 * - A surface gone from the record closes its tab; one that arrives in the same change takes its
 *   place, as a file opened from the Files explorer replaces it.
 * - The panel hiding takes every surface tab away, remembered in `hidden`; showing it again puts
 *   them back. Unchanged since, the arrangement returns exactly as it was.
 * - While the panel shows, every surface in the record has a tab. A new one opens in the pane
 *   asked from, else beside the others, else in a new pane right of the conversation.
 * - The record's active surface comes to the front of its pane when it changes or the panel
 *   opens. Pane focus stays where it was, unless the surface opened in the pane asked from.
 *
 * `consumedTarget` says whether a new surface landed in `targetPaneId`.
 */
export function followRecord(
  state: MirrorState,
  previous: PanelRecord | null,
  record: PanelRecord,
  targetPaneId: string | null = null,
): MirrorState & { readonly consumedTarget: boolean } {
  let { arrangement, hidden } = state;
  const present = new Set(record.surfaceIds);
  const dropGone = (next: Arrangement) =>
    closeTabs(
      next,
      allTabs(next).filter((key) => {
        const id = surfaceIdOf(key);
        return id !== null && !present.has(id);
      }),
    );

  if (previous?.isOpen && !record.isOpen) {
    const before = dropGone(arrangement);
    const after = closeTabs(before, surfaceTabs(before));
    return {
      arrangement: after,
      hidden: after === before ? hidden : { before, after },
      consumedTarget: false,
    };
  }
  if (!record.isOpen) return { arrangement: dropGone(arrangement), hidden, consumedTarget: false };

  const opening = !previous?.isOpen;
  if (opening && hidden) {
    arrangement =
      arrangement === hidden.after
        ? hidden.before
        : restoreTabs(arrangement, hidden.before, hidden.after, null);
    hidden = null;
  }
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
    const key = surfaceKey(id);
    const home = surfacePane(arrangement, previous, consumedTarget ? null : targetPaneId);
    const asked = home !== null && home === targetPaneId;
    if (home !== null) {
      arrangement = openTab(arrangement, key, home, asked);
      consumedTarget ||= asked;
      continue;
    }
    const conversation = leafWithTab(arrangement.root, CONVERSATION) ?? focusedPane(arrangement);
    arrangement = openBeside(arrangement, key, conversation.id, "right", {
      focus: false,
      weight: SURFACE_PANE_WEIGHT,
    });
  }

  const active = record.activeSurfaceId;
  if (
    active !== null &&
    present.has(active) &&
    (opening || previous?.activeSurfaceId !== active || arriving.includes(active))
  ) {
    arrangement = activateTab(arrangement, surfaceKey(active), consumedTarget);
  }
  return { arrangement, hidden, consumedTarget };
}

/** The surfaces shown: the active tabs of their panes, in reading order. */
export function visibleSurfaces(arrangement: Arrangement, record: PanelRecord): string[] {
  const present = new Set(record.surfaceIds);
  return leaves(arrangement.root).flatMap((leaf) => {
    const id = surfaceIdOf(leaf.active);
    return id !== null && present.has(id) ? [id] : [];
  });
}

/**
 * What the record should say for the panes as they stand, the other direction of the mirror:
 * open while some surface tab is shown, its active surface the one in the focused pane, else
 * the one already active while it stays shown, else the first shown. The surface the record
 * names is the one T3 Code renders, so only it is live; another shown surface waits for its
 * pane to take focus.
 */
export function recordFor(
  arrangement: Arrangement,
  record: PanelRecord,
): { readonly isOpen: boolean; readonly activeSurfaceId: string | null } {
  const visible = visibleSurfaces(arrangement, record);
  if (visible.length === 0) return { isOpen: false, activeSurfaceId: record.activeSurfaceId };
  const focused = surfaceIdOf(focusedPane(arrangement).active);
  if (focused !== null && visible.includes(focused)) {
    return { isOpen: true, activeSurfaceId: focused };
  }
  const kept = record.activeSurfaceId;
  return {
    isOpen: true,
    activeSurfaceId: kept !== null && visible.includes(kept) ? kept : (visible[0] ?? null),
  };
}

/** The pane that shows the record's active surface, where T3 Code's surface content goes. */
export function hostPaneId(arrangement: Arrangement, record: PanelRecord): string | null {
  if (!record.isOpen || record.activeSurfaceId === null) return null;
  const key = surfaceKey(record.activeSurfaceId);
  return leaves(arrangement.root).find((leaf) => leaf.active === key)?.id ?? null;
}

import {
  activateTab,
  allTabs,
  closeTabs,
  focusedPane,
  isEmptyTab,
  openBeside,
  openTab,
  replaceTab,
  surfaceIdOf,
  surfaceKey,
  type Arrangement,
} from "./arrangement";
import { findLeaf, leafWithTab, leaves } from "./tree";

/**
 * T3 Code keeps a thread's right-panel surfaces in one record (open ones, the front one, whether
 * the panel shows) and does everything through it. The panes mirror the record rather than
 * intercept it: a surface is a tab, the active surface is that tab shown, and closing either
 * closes both. The panes decide only where each surface tab stands.
 */
export interface PanelRecord {
  readonly isOpen: boolean;
  readonly activeSurfaceId: string | null;
  readonly surfaceIds: readonly string[];
}

/**
 * How a set of panes names a record's surfaces as tabs: `surface:<id>` by default. Astrolabe's
 * shared panes name each thread's own (`chatSurfaceKey`), count its other linked tabs as part of
 * its panel (`linked`), and open its first surface in a new pane beside `splitFrom`.
 */
export interface SurfaceKeys {
  readonly key: (surfaceId: string) => string;
  readonly id: (key: string) => string | null;
  readonly linked?: (key: string) => boolean;
  readonly splitFrom?: string | null;
}

const PANEL_KEYS: SurfaceKeys = { key: surfaceKey, id: surfaceIdOf };

/** A pane split off for a thread's surfaces takes this share of its owner's room. */
const SPLIT_WEIGHT = 0.45;

/**
 * Where a surface new to the arrangement goes: the pane asked from (`targetPaneId`, as a
 * pane's New tab menu asks), else the pane of the surface that was in front, else any pane
 * holding a surface, as the right panel's strip held them all, else the focused pane (null
 * when `keys` would rather split one off).
 */
function surfacePane(
  arrangement: Arrangement,
  previous: PanelRecord | null,
  targetPaneId: string | null,
  keys: SurfaceKeys,
): string | null {
  if (targetPaneId !== null && findLeaf(arrangement.root, targetPaneId)) return targetPaneId;
  const front = previous?.activeSurfaceId;
  const frontPane = front ? leafWithTab(arrangement.root, keys.key(front)) : undefined;
  if (frontPane) return frontPane.id;
  const holding = leaves(arrangement.root).find((leaf) =>
    leaf.tabs.some((key) => keys.id(key) !== null || keys.linked?.(key) === true),
  );
  if (holding) return holding.id;
  const splitFrom = keys.splitFrom ?? null;
  return splitFrom !== null && findLeaf(arrangement.root, splitFrom)
    ? null
    : focusedPane(arrangement).id;
}

/**
 * Syncs the panes to the record after T3 Code changed it (`previous` is null on first load). A
 * surface replacing a closed one in the same change takes its place; a new one opens in the pane
 * asked from, else beside the others, else in the focused pane. On first load a document left in
 * front stays, since the record knows only surfaces. `consumedTarget`: it landed in `targetPaneId`.
 */
export function followRecord(
  current: Arrangement,
  previous: PanelRecord | null,
  record: PanelRecord,
  targetPaneId: string | null = null,
  keys: SurfaceKeys = PANEL_KEYS,
): { readonly arrangement: Arrangement; readonly consumedTarget: boolean } {
  const { key: surfaceKey, id: surfaceIdOf } = keys;
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
    const home = surfacePane(arrangement, previous, asking, keys);
    const asked = home !== null && home === targetPaneId;
    arrangement =
      home === null
        ? openBeside(arrangement, surfaceKey(id), keys.splitFrom ?? arrangement.focused, "right", {
            focus: false,
            weight: SPLIT_WEIGHT,
          })
        : openTab(arrangement, surfaceKey(id), home, asked);
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
function visibleSurfaces(
  arrangement: Arrangement,
  record: PanelRecord,
  keys: SurfaceKeys,
): string[] {
  const present = new Set(record.surfaceIds);
  return leaves(arrangement.root).flatMap((leaf) => {
    const id = keys.id(leaf.active);
    return id !== null && present.has(id) ? [id] : [];
  });
}

/**
 * The other direction of the mirror: the surface the record should have in front is the focused
 * pane's, else the active one while shown, else the first shown. T3 Code renders only the record's
 * surface, so other shown surfaces wait for their pane's focus. Whether the panel shows stays
 * T3 Code's to say.
 */
export function activeSurfaceFor(
  arrangement: Arrangement,
  record: PanelRecord,
  keys: SurfaceKeys = PANEL_KEYS,
): string | null {
  const visible = visibleSurfaces(arrangement, record, keys);
  const focused = keys.id(focusedPane(arrangement).active);
  if (focused !== null && visible.includes(focused)) return focused;
  const kept = record.activeSurfaceId;
  if (kept !== null && (visible.length === 0 || visible.includes(kept))) return kept;
  return visible[0] ?? null;
}

/** The pane that shows the record's active surface, where T3 Code's surface content goes. */
export function hostPaneId(
  arrangement: Arrangement,
  record: PanelRecord,
  keys: SurfaceKeys = PANEL_KEYS,
): string | null {
  if (!record.isOpen || record.activeSurfaceId === null) return null;
  const key = keys.key(record.activeSurfaceId);
  return leaves(arrangement.root).find((leaf) => leaf.active === key)?.id ?? null;
}

import {
  allTabs,
  focusedPane,
  isEmptyTab,
  openBeside,
  paneLeaf,
  type Arrangement,
} from "./arrangement";
import { findLeaf, leafWithTab, leaves, mapLeaf, removeLeaf } from "./tree";

/**
 * Astrolabe: linked tabs. A tab can belong to an owner tab (`owners`), as a thread's terminal
 * belongs to its chat. It shows only while its owner is in front (`front`); otherwise it is set
 * aside (`parked`) with where it stood, so a thread's right panel is derived, not kept apart.
 */
export interface LinkedArrangement {
  readonly arrangement: Arrangement;
  /** An owned tab's owner: a chat's tab key, or a change group's own tab key. */
  readonly owners: Readonly<Record<string, string>>;
  /** Owned tabs set aside while their owner is not in front, by where they stood. */
  readonly parked: Readonly<Record<string, ParkedTab>>;
  /** The owner in front: the chat focused most recently while in front somewhere. */
  readonly front: string | null;
}

export interface ParkedTab {
  readonly pane: string;
  readonly index: number;
  readonly active: boolean;
}

export interface LinkContext {
  /** Whether a key is a tab that owns others and can come to the front (a chat). */
  readonly isOwner: (key: string) => boolean;
  /** Whether `owner`'s tabs show while `front` is in front: its own, or a group it works in. */
  readonly shows: (owner: string, front: string) => boolean;
  /** Whether the front owner shows its linked tabs at all (its right panel is open). */
  readonly open: (front: string) => boolean;
  /**
   * Tabs the front owner has that no pane holds yet (its thread's surfaces new to the panes), in
   * order: they join it where its tabs come back, so they take the pane the last owner's left.
   */
  readonly arriving?: (front: string) => readonly string[];
}

/** A linked pane's share of the room it divides with its owner's pane. */
const LINKED_PANE_WEIGHT = 0.45;

export function linkedArrangement(arrangement: Arrangement): LinkedArrangement {
  return { arrangement, owners: {}, parked: {}, front: null };
}

/**
 * The owner in front: the focused pane's tab when it is one, or that tab's owner; else the last
 * one while still in front somewhere; else the first in front, in reading order.
 */
function frontOwner(
  arrangement: Arrangement,
  owners: LinkedArrangement["owners"],
  previous: string | null,
  isOwner: (key: string) => boolean,
): string | null {
  const focused = focusedPane(arrangement).active;
  if (isOwner(focused)) return focused;
  const fronts = leaves(arrangement.root).map((leaf) => leaf.active);
  const ownerOfFocused = owners[focused];
  if (ownerOfFocused !== undefined && isOwner(ownerOfFocused) && fronts.includes(ownerOfFocused)) {
    return ownerOfFocused;
  }
  if (previous !== null && fronts.includes(previous)) return previous;
  return fronts.find(isOwner) ?? null;
}

/** Links a tab to `owner`; it shows from now on only while its owner does. */
export function linkTab(state: LinkedArrangement, key: string, owner: string): LinkedArrangement {
  if (state.owners[key] === owner) return state;
  return { ...state, owners: { ...state.owners, [key]: owner } };
}

/** Unlinks a tab: it stays where it is, whoever is in front. */
export function unlinkTab(state: LinkedArrangement, key: string): LinkedArrangement {
  if (!(key in state.owners)) return state;
  const { [key]: _owner, ...owners } = state.owners;
  const { [key]: _parked, ...parked } = state.parked;
  return { ...state, owners, parked };
}

/**
 * The pane the front owner's linked tabs stand in, where another of its tabs opens: one holding
 * a tab it owns, else null (a new one splits off beside the owner, see `openLinked`).
 */
function linkedPaneOf(state: LinkedArrangement, front: string | null): string | null {
  if (front === null) return null;
  return (
    leaves(state.arrangement.root).find((leaf) =>
      leaf.tabs.some((key) => state.owners[key] === front),
    )?.id ?? null
  );
}

/**
 * Opens `key` linked to the front owner, in its linked pane, else in a new pane to the right of
 * the owner's (the focused pane's without one). Focus stays unless `focus`.
 */
export function openLinked(
  state: LinkedArrangement,
  key: string,
  { focus = false }: { focus?: boolean } = {},
): LinkedArrangement {
  const owner = state.front;
  if (owner === null) return state;
  const linked = linkTab(state, key, owner);
  const pane = linkedPaneOf(linked, owner);
  const { arrangement } = linked;
  if (leafWithTab(arrangement.root, key)) return linked;
  if (pane !== null) {
    const leaf = findLeaf(arrangement.root, pane);
    if (!leaf) return linked;
    return {
      ...linked,
      arrangement: {
        ...arrangement,
        root: mapLeaf(arrangement.root, pane, (each) => ({
          ...each,
          tabs: [...each.tabs, key],
          active: key,
        })),
        focused: focus ? pane : arrangement.focused,
      },
    };
  }
  const beside = leafWithTab(arrangement.root, owner)?.id ?? arrangement.focused;
  return {
    ...linked,
    arrangement: openBeside(arrangement, key, beside, "right", {
      focus,
      weight: LINKED_PANE_WEIGHT,
    }),
  };
}

/**
 * Brings the arrangement in line with its links after any change: a closed chat's tabs close, the
 * front owner is worked out again, tabs whose owner does not show are set aside, and returning
 * ones go back where they stood, else where the last owner's stood, else beside the owner. Panes
 * left empty close. The same object when nothing changed.
 */
export function settleLinks(state: LinkedArrangement, context: LinkContext): LinkedArrangement {
  let { arrangement } = state;
  const open = new Set(allTabs(arrangement));
  let owners: Record<string, string> = { ...state.owners };
  let parked: Record<string, ParkedTab> = { ...state.parked };
  let changed = false;

  // An owner closed takes its tabs with it; a tab neither open nor set aside forgets its owner.
  const closing = new Set<string>();
  for (const [key, owner] of Object.entries(owners)) {
    if (context.isOwner(owner) && !open.has(owner)) {
      closing.add(key);
      delete owners[key];
      delete parked[key];
      changed = true;
    } else if (!open.has(key) && !(key in parked)) {
      delete owners[key];
      changed = true;
    }
  }
  for (const key of Object.keys(parked)) {
    if (key in owners) continue;
    delete parked[key];
    changed = true;
  }

  const front = frontOwner(
    removeTabs(arrangement, closing).arrangement,
    owners,
    state.front,
    context.isOwner,
  );
  if (front !== state.front) changed = true;
  const shown = (owner: string) =>
    front !== null && context.open(front) && context.shows(owner, front);
  // Hidden with the front owner's panel, an empty tab holds nothing to bring back: it closes.
  const dropped = (key: string, owner: string) =>
    isEmptyTab(key) && front !== null && context.shows(owner, front) && !shown(owner);
  for (const [key, owner] of Object.entries(owners)) {
    if (!(key in parked) || !dropped(key, owner)) continue;
    delete parked[key];
    delete owners[key];
    changed = true;
  }
  if (front !== null && shown(front)) {
    for (const key of context.arriving?.(front) ?? []) {
      if (key in owners || open.has(key)) continue;
      owners[key] = front;
      parked[key] = { pane: "", index: Number.MAX_SAFE_INTEGER, active: false };
      changed = true;
    }
  }

  // Set aside what does not show, remembering where it stood.
  const hiding = new Set(closing);
  for (const leaf of leaves(arrangement.root)) {
    leaf.tabs.forEach((key, index) => {
      const owner = owners[key];
      if (owner === undefined || shown(owner)) return;
      hiding.add(key);
      if (dropped(key, owner)) {
        delete owners[key];
        return;
      }
      parked[key] = { pane: leaf.id, index, active: leaf.active === key };
    });
  }
  const removed = removeTabs(arrangement, hiding);
  arrangement = removed.arrangement;
  if (hiding.size > 0) changed = true;

  // Bring back what shows, where it stood, else where the last owner's tabs stood.
  const returning = Object.entries(parked)
    .filter(([key]) => {
      const owner = owners[key];
      return owner !== undefined && shown(owner) && !hiding.has(key);
    })
    .toSorted(([, a], [, b]) => a.index - b.index);
  let home: string | null =
    removed.vacated.find((id) => findLeaf(arrangement.root, id)) ?? linkedPaneIn(arrangement);
  for (const [key, place] of returning) {
    delete parked[key];
    changed = true;
    const target = findLeaf(arrangement.root, place.pane) ? place.pane : home;
    if (target === null) {
      const beside =
        (front === null ? undefined : leafWithTab(arrangement.root, front)?.id) ??
        arrangement.focused;
      arrangement = openBeside(arrangement, key, beside, "right", {
        focus: false,
        weight: LINKED_PANE_WEIGHT,
      });
      home = leafWithTab(arrangement.root, key)?.id ?? null;
      continue;
    }
    home ??= target;
    arrangement = {
      ...arrangement,
      root: mapLeaf(arrangement.root, target, (leaf) => {
        const at = Math.min(place.index, leaf.tabs.length);
        const tabs = [...leaf.tabs.slice(0, at), key, ...leaf.tabs.slice(at)];
        return { ...leaf, tabs, active: place.active || leaf.active === "" ? key : leaf.active };
      }),
    };
  }

  arrangement = closeEmptyPanes(arrangement, front);
  if (!changed && arrangement === state.arrangement) return state;
  return { arrangement, owners, parked, front };

  function linkedPaneIn(next: Arrangement): string | null {
    return (
      leaves(next.root).find((leaf) =>
        leaf.tabs.some((key) => owners[key] !== undefined && owners[key] === front),
      )?.id ?? null
    );
  }
}

/**
 * `owner`'s linked tabs set aside, which its panel opening brings back: its own and those of any
 * owner it shows (a change group it works in), as they stood, then its thread's surfaces no pane
 * has held yet. Empty tabs are never set aside.
 */
export function hiddenLinkedTabs(
  state: LinkedArrangement,
  owner: string,
  context: LinkContext,
): string[] {
  const open = new Set(allTabs(state.arrangement));
  const parked = Object.entries(state.parked)
    .filter(([key]) => {
      const by = state.owners[key];
      return by !== undefined && context.shows(by, owner) && !isEmptyTab(key);
    })
    .toSorted(([, a], [, b]) => a.index - b.index)
    .map(([key]) => key);
  const arriving = (context.arriving?.(owner) ?? []).filter(
    (key) => !open.has(key) && !(key in state.parked),
  );
  return [...parked, ...arriving];
}

/**
 * What a chat's linked-tabs toggle offers: to hide its tabs while its panel is open, to bring
 * back the ones set aside, or with none, a new tab.
 */
export type LinkedToggle =
  | { readonly kind: "showing" }
  | { readonly kind: "hidden"; readonly tabs: readonly string[] }
  | { readonly kind: "none" };

export function linkedToggle(
  state: LinkedArrangement,
  owner: string,
  context: LinkContext,
): LinkedToggle {
  if (context.open(owner)) return { kind: "showing" };
  const tabs = hiddenLinkedTabs(state, owner, context);
  return tabs.length > 0 ? { kind: "hidden", tabs } : { kind: "none" };
}

/**
 * Takes `keys` out of their panes without closing a pane they empty (`vacated`), so what comes
 * back can stand there. A pane whose tab in front left shows its neighbour.
 */
function removeTabs(
  arrangement: Arrangement,
  keys: ReadonlySet<string>,
): { readonly arrangement: Arrangement; readonly vacated: string[] } {
  if (keys.size === 0) return { arrangement, vacated: [] };
  const vacated: string[] = [];
  let root = arrangement.root;
  for (const leaf of leaves(arrangement.root)) {
    if (!leaf.tabs.some((key) => keys.has(key))) continue;
    const tabs = leaf.tabs.filter((key) => !keys.has(key));
    if (tabs.length === 0) vacated.push(leaf.id);
    const at = leaf.tabs.indexOf(leaf.active);
    const active = keys.has(leaf.active)
      ? (leaf.tabs.slice(at + 1).find((key) => !keys.has(key)) ??
        leaf.tabs.slice(0, at).findLast((key) => !keys.has(key)) ??
        "")
      : leaf.active;
    root = mapLeaf(root, leaf.id, (pane) => ({ ...pane, tabs, active }));
  }
  return { arrangement: { ...arrangement, root }, vacated };
}

/**
 * Closes panes left with no tabs, their neighbours taking their room; the last pane left gets an
 * empty tab. Focus left on a closed pane goes to the front owner's pane, else the first.
 */
function closeEmptyPanes(arrangement: Arrangement, front: string | null): Arrangement {
  const empty = leaves(arrangement.root).filter((leaf) => leaf.tabs.length === 0);
  if (empty.length === 0) return arrangement;
  let root: Arrangement["root"] | null = arrangement.root;
  for (const leaf of empty) root = root === null ? null : removeLeaf(root, leaf.id);
  if (root === null) {
    const fresh = `empty/${arrangement.seq}`;
    const id = empty[0]?.id ?? "p0";
    return { root: paneLeaf(id, [fresh]), focused: id, seq: arrangement.seq + 1 };
  }
  const next = { ...arrangement, root };
  if (findLeaf(root, arrangement.focused)) return next;
  const focused =
    (front === null ? undefined : leafWithTab(root, front)?.id) ?? leaves(root)[0]?.id ?? "p0";
  return { ...next, focused };
}

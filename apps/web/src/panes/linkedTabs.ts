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
  /** Hidden from the chat's linked tabs filter: it stays aside while its owner shows the rest. */
  readonly hidden?: boolean;
}

/** One of a chat's linked tabs, and whether it shows when the chat is in front. */
export interface LinkedTab {
  readonly key: string;
  readonly shown: boolean;
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
  if (
    ownerOfFocused !== undefined &&
    isOwner(ownerOfFocused) &&
    allTabs(arrangement).includes(ownerOfFocused)
  ) {
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

/** `tabs` of the pane `pane` with what was set aside from it back, as `settleLinks` returns it. */
function withParked(
  tabs: readonly string[],
  pane: string,
  parked: LinkedArrangement["parked"],
): string[] {
  const order = [...tabs];
  for (const [key, place] of parkedInOrder(parked)) {
    if (place.pane === pane) order.splice(Math.min(place.index, order.length), 0, key);
  }
  return order;
}

const parkedInOrder = (parked: LinkedArrangement["parked"]) =>
  Object.entries(parked).toSorted(([, a], [, b]) => a.index - b.index);

/**
 * Sets one of `owner`'s linked tabs aside on its own: it stays hidden while the rest show. Its
 * index counts the tabs hidden before it, so tabs hidden one by one come back in order.
 */
export function hideLinkedTab(
  state: LinkedArrangement,
  key: string,
  owner: string,
): LinkedArrangement {
  const place = state.parked[key];
  if (place) return { ...state, parked: { ...state.parked, [key]: { ...place, hidden: true } } };
  const leaf = leafWithTab(state.arrangement.root, key);
  const linked = linkTab(state, key, owner);
  return {
    ...linked,
    arrangement: removeTabs(state.arrangement, new Set([key])).arrangement,
    parked: {
      ...state.parked,
      [key]: leaf
        ? {
            pane: leaf.id,
            index: withParked(leaf.tabs, leaf.id, state.parked).indexOf(key),
            active: false,
            hidden: true,
          }
        : { pane: "", index: Number.MAX_SAFE_INTEGER, active: false, hidden: true },
    },
  };
}

/** Lets `keys` hidden on their own come back with the rest of their owner's tabs. */
export function showLinkedTabs(
  state: LinkedArrangement,
  keys: readonly string[],
): LinkedArrangement {
  const parked = { ...state.parked };
  for (const key of keys) {
    const place = parked[key];
    if (!place?.hidden) continue;
    const { hidden: _hidden, ...rest } = place;
    parked[key] = rest;
  }
  return { ...state, parked };
}

/**
 * Brings the arrangement in line with its links after any change: a chat's tabs leave its pane, a
 * closed chat's tabs close, the front owner is worked out again, tabs whose owner does not show
 * are set aside, and returning ones go back where they stood, else where the last owner's stood,
 * else beside the owner. Panes left empty close. The same object when nothing changed.
 */
export function settleLinks(state: LinkedArrangement, context: LinkContext): LinkedArrangement {
  let arrangement = keepLinkedTabsOutOfChatPanes(state.arrangement, state.owners, context.isOwner);
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
  // A tab opened again by name while set aside is no longer aside.
  for (const key of Object.keys(parked)) {
    if (key in owners && !open.has(key)) continue;
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
    .filter(([key, place]) => {
      const owner = owners[key];
      return owner !== undefined && shown(owner) && !hiding.has(key) && !place.hidden;
    })
    .toSorted(([, a], [, b]) => a.index - b.index);
  let home: string | null =
    removed.vacated.find((id) => findLeaf(arrangement.root, id)) ?? linkedPaneIn(arrangement);
  for (const [key, place] of returning) {
    delete parked[key];
    changed = true;
    const standing = findLeaf(arrangement.root, place.pane);
    const owner = owners[key];
    const ownPane =
      owner !== undefined && context.isOwner(owner) && standing?.tabs.includes(owner) === true;
    const target = standing && !ownPane ? place.pane : home;
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
 * A chat's linked tabs show with the chat, so they never share its pane, where picking one would
 * hide the chat. However they met, they go to the pane of its other linked tabs, else a new one
 * beside it, and the chat shows in their place. A change group's tabs stay with it.
 */
function keepLinkedTabsOutOfChatPanes(
  start: Arrangement,
  owners: LinkedArrangement["owners"],
  isOwner: LinkContext["isOwner"],
): Arrangement {
  let arrangement = start;
  for (const leaf of leaves(start.root)) {
    for (const key of leaf.tabs) {
      const owner = owners[key];
      if (owner === undefined || !isOwner(owner) || !leaf.tabs.includes(owner)) continue;
      const shown = findLeaf(arrangement.root, leaf.id)?.active === key;
      arrangement = removeTabs(arrangement, new Set([key])).arrangement;
      if (shown) {
        arrangement = {
          ...arrangement,
          root: mapLeaf(arrangement.root, leaf.id, (pane) => ({ ...pane, active: owner })),
        };
      }
      const linkedPane = leaves(arrangement.root).find(
        (pane) => !pane.tabs.includes(owner) && pane.tabs.some((other) => owners[other] === owner),
      );
      arrangement = linkedPane
        ? {
            ...arrangement,
            root: mapLeaf(arrangement.root, linkedPane.id, (pane) => ({
              ...pane,
              tabs: [...pane.tabs, key],
              active: shown ? key : pane.active,
            })),
          }
        : openBeside(arrangement, key, leaf.id, "right", {
            focus: false,
            weight: LINKED_PANE_WEIGHT,
          });
    }
  }
  return arrangement;
}

/** Whether dragged `keys` are all linked tabs of a chat in this pane, so none may join its tabs. */
export function keptFromPane(
  owners: LinkedArrangement["owners"],
  keys: readonly string[],
  paneTabs: readonly string[],
  isOwner: LinkContext["isOwner"],
): boolean {
  return (
    keys.length > 0 &&
    keys.every((key) => {
      const owner = owners[key];
      return owner !== undefined && isOwner(owner) && paneTabs.includes(owner);
    })
  );
}

/**
 * `owner`'s linked tabs, its own and those of any owner it shows (a change group it works in), as
 * they stand or stood, then its thread's surfaces no pane has held yet. With its panel closed none
 * show, and an empty tab, which a closed panel drops, is not among them.
 */
export function linkedTabsOf(
  state: LinkedArrangement,
  owner: string,
  context: LinkContext,
): LinkedTab[] {
  const { root } = state.arrangement;
  const panelOpen = context.open(owner);
  const open = new Set(allTabs(state.arrangement));
  const isLinked = (key: string) => {
    const by = state.owners[key];
    return by !== undefined && context.shows(by, owner);
  };
  // What stood in a pane since closed returns to the pane holding the rest, so it lists there.
  const home = leaves(root).find((leaf) => leaf.tabs.some(isLinked))?.id ?? "";
  const parked = Object.fromEntries(
    Object.entries(state.parked).map(([key, place]) => [
      key,
      findLeaf(root, place.pane) ? place : { ...place, pane: home },
    ]),
  );
  const held = leaves(root).flatMap((leaf) => withParked(leaf.tabs, leaf.id, parked));
  const away = home === "" ? withParked([], "", parked) : [];
  const arriving = (context.arriving?.(owner) ?? []).filter(
    (key) => !open.has(key) && !(key in state.parked),
  );
  const linked = [...held, ...away].filter(
    (key) => isLinked(key) && (panelOpen || !isEmptyTab(key)),
  );
  return [...linked, ...arriving].map((key) => ({
    key,
    shown: panelOpen && !state.parked[key]?.hidden,
  }));
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
 * Closes panes left with no tabs, each one's room going as `removeLeaf` gives it (back to the
 * pane it was split from, so hiding a chat's linked pane gives the chat its room back); the last
 * pane left gets an empty tab. Focus left on a closed pane goes to the front owner's pane, else the first.
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

import {
  findLeaf,
  insertBeside,
  leafWithTab,
  leaves,
  mapLeaf,
  removeLeaf,
  setWeights,
  type Leaf,
  type Side,
  type SplitNode,
} from "./tree";

/**
 * A thread's arrangement in its right panel: its pane tree, the focused pane, and the next free
 * id number. Each thread keeps its own on the device.
 *
 * A tab is named by a key. One of the thread's right-panel surfaces is `surface:<surface id>`
 * (see `surfaceMirror.ts`), and a tab that shows nothing yet is `empty/<n>`.
 */
export interface Arrangement {
  readonly root: SplitNode;
  readonly focused: string;
  readonly seq: number;
}

const SURFACE_PREFIX = "surface:";

export function surfaceKey(surfaceId: string) {
  return `${SURFACE_PREFIX}${surfaceId}`;
}

/** The surface a tab shows; null for an empty tab. */
export function surfaceIdOf(key: string): string | null {
  return key.startsWith(SURFACE_PREFIX) ? key.slice(SURFACE_PREFIX.length) : null;
}

function emptyKey(n: number) {
  return `empty/${n}`;
}

export function isEmptyTab(key: string) {
  return /^empty\/\d+$/.test(key);
}

/** Whether a key names a tab an arrangement can hold. */
export function isTabKey(key: string) {
  return isEmptyTab(key) || (surfaceIdOf(key)?.length ?? 0) > 0;
}

/** A pane holding `tabs`, the first one active. */
export function paneLeaf(id: string, tabs: readonly string[]): Leaf {
  return { type: "leaf", id, tabs, active: tabs[0] ?? "" };
}

/** How a thread's right panel first opens on a device: one pane with one empty tab. */
export function startingArrangement(): Arrangement {
  return { root: paneLeaf("p0", [emptyKey(0)]), focused: "p0", seq: 1 };
}

/**
 * One more than the highest number among a tree's `p<n>` ids and `empty/<n>` tabs, so new
 * ids never repeat.
 */
export function seqAfter(root: SplitNode): number {
  const numbers = (node: SplitNode): number[] => {
    const own = Number(/^p(\d+)$/.exec(node.id)?.[1] ?? -1);
    if (node.type === "branch") return [own, ...node.children.flatMap(numbers)];
    return [own, ...node.tabs.map((key) => Number(/^empty\/(\d+)$/.exec(key)?.[1] ?? -1))];
  };
  return Math.max(-1, ...numbers(root)) + 1;
}

export function allTabs(arrangement: Arrangement): string[] {
  return leaves(arrangement.root).flatMap((leaf) => leaf.tabs);
}

export function focusedPane(arrangement: Arrangement): Leaf {
  const found = findLeaf(arrangement.root, arrangement.focused) ?? leaves(arrangement.root)[0];
  return found ?? paneLeaf(arrangement.focused, [emptyKey(arrangement.seq)]);
}

export function focusPane(arrangement: Arrangement, paneId: string): Arrangement {
  if (arrangement.focused === paneId || !findLeaf(arrangement.root, paneId)) return arrangement;
  return { ...arrangement, focused: paneId };
}

/** Shows a tab in its pane; that pane takes focus unless `focus` is false. */
export function activateTab(arrangement: Arrangement, key: string, focus = true): Arrangement {
  const leaf = leafWithTab(arrangement.root, key);
  if (!leaf) return arrangement;
  const focused = focus ? leaf.id : arrangement.focused;
  if (leaf.active === key && arrangement.focused === focused) return arrangement;
  return {
    ...arrangement,
    root: mapLeaf(arrangement.root, leaf.id, (pane) => ({ ...pane, active: key })),
    focused,
  };
}

function insertTab(
  arrangement: Arrangement,
  key: string,
  paneId: string,
  at: number,
  focus = true,
): Arrangement {
  const root = mapLeaf(arrangement.root, paneId, (pane) => ({
    ...pane,
    tabs: [...pane.tabs.slice(0, at), key, ...pane.tabs.slice(at)],
    active: key,
  }));
  return { ...arrangement, root, focused: focus ? paneId : arrangement.focused };
}

/**
 * Opens a tab in a pane (the focused one by default) after its active tab, or in place of an
 * empty active tab, and shows it. A tab already open in that pane is shown; one open in another
 * pane moves over, closing that pane when it was its only tab. The pane takes focus unless
 * `focus` is false.
 */
export function openTab(
  arrangement: Arrangement,
  key: string,
  paneId: string = arrangement.focused,
  focus = true,
): Arrangement {
  const target = findLeaf(arrangement.root, paneId) ?? focusedPane(arrangement);
  const source = leafWithTab(arrangement.root, key);
  if (source?.id === target.id) return activateTab(arrangement, key, focus);
  const from = source ? detachTab(arrangement, key, target.id) : arrangement;
  const pane = findLeaf(from.root, target.id) ?? target;
  const at = pane.tabs.indexOf(pane.active);
  if (isEmptyTab(pane.active)) {
    const root = mapLeaf(from.root, pane.id, (leaf) => ({
      ...leaf,
      tabs: leaf.tabs.map((tab, index) => (index === at ? key : tab)),
      active: key,
    }));
    return { ...from, root, focused: focus ? pane.id : from.focused };
  }
  return insertTab(from, key, pane.id, at + 1, focus);
}

/**
 * Divides a pane on one side and opens a tab in the new pane there. A tab open elsewhere moves. The new pane takes focus unless `focus` is
 * false. `weight` is the new pane's share of the divided pane's room, out of 1.
 */
export function openBeside(
  arrangement: Arrangement,
  key: string,
  targetId: string,
  side: Side,
  { focus = true, weight = 0.5 }: { focus?: boolean; weight?: number } = {},
): Arrangement {
  if (!findLeaf(arrangement.root, targetId)) return openTab(arrangement, key, undefined, focus);
  const source = leafWithTab(arrangement.root, key);
  if (source?.id === targetId && source.tabs.length === 1) return arrangement;
  const from = source ? detachTab(arrangement, key, targetId) : arrangement;
  const leaf = paneLeaf(`p${from.seq}`, [key]);
  const branchId = `p${from.seq + 1}`;
  // The divided pane's share splits by `weight` rather than in half.
  const root = reweighPair(
    insertBeside(from.root, targetId, leaf, side, branchId),
    targetId,
    leaf.id,
    weight,
  );
  return {
    ...from,
    root,
    focused: focus ? leaf.id : from.focused,
    seq: from.seq + 2,
  };
}

function reweighPair(root: SplitNode, targetId: string, newId: string, weight: number): SplitNode {
  if (weight === 0.5 || root.type === "leaf") return root;
  const visit = (node: SplitNode): SplitNode => {
    if (node.type === "leaf") return node;
    const targetIndex = node.children.findIndex((c) => c.type === "leaf" && c.id === targetId);
    const newIndex = node.children.findIndex((c) => c.type === "leaf" && c.id === newId);
    if (targetIndex !== -1 && newIndex !== -1) {
      const share = (node.weights[targetIndex] ?? 1) + (node.weights[newIndex] ?? 1);
      const weights = node.weights.map((w, i) =>
        i === newIndex ? share * weight : i === targetIndex ? share * (1 - weight) : w,
      );
      return setWeights(node, node.id, weights);
    }
    let changed = false;
    const children = node.children.map((child) => {
      const next = visit(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, children } : node;
  };
  return visit(root);
}

/**
 * Takes a tab out of its pane; the neighbouring tab (the one after it, else before it) takes
 * over. A pane left with no tabs closes and its neighbours take its room, focus moving to the
 * pane before it (or after it); the last pane, or `keepPaneId`'s, stays. The last pane gets an
 * empty tab; `keepPaneId`'s is left for the caller to fill.
 */
function detachTab(arrangement: Arrangement, key: string, keepPaneId?: string): Arrangement {
  const leaf = leafWithTab(arrangement.root, key);
  if (!leaf) return arrangement;
  const index = leaf.tabs.indexOf(key);
  const tabs = leaf.tabs.filter((tab) => tab !== key);
  if (tabs.length === 0 && leaf.id !== keepPaneId) {
    const all = leaves(arrangement.root);
    const root = all.length > 1 ? removeLeaf(arrangement.root, leaf.id) : null;
    if (!root) {
      const fresh = emptyKey(arrangement.seq);
      return {
        ...arrangement,
        root: mapLeaf(arrangement.root, leaf.id, (pane) => ({
          ...pane,
          tabs: [fresh],
          active: fresh,
        })),
        seq: arrangement.seq + 1,
      };
    }
    if (arrangement.focused !== leaf.id) return { ...arrangement, root };
    const at = all.findIndex((pane) => pane.id === leaf.id);
    const next = all[at - 1] ?? all[at + 1];
    return { ...arrangement, root, focused: next?.id ?? arrangement.focused };
  }
  const active = leaf.active === key ? (tabs[index] ?? tabs[index - 1] ?? "") : leaf.active;
  return {
    ...arrangement,
    root: mapLeaf(arrangement.root, leaf.id, (pane) => ({ ...pane, tabs, active })),
  };
}

/** Puts `next` in `key`'s place in its pane, active where `key` was. */
export function replaceTab(arrangement: Arrangement, key: string, next: string): Arrangement {
  const leaf = leafWithTab(arrangement.root, key);
  if (!leaf || leafWithTab(arrangement.root, next)) return arrangement;
  return {
    ...arrangement,
    root: mapLeaf(arrangement.root, leaf.id, (pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => (tab === key ? next : tab)),
      active: pane.active === key ? next : pane.active,
    })),
  };
}

/**
 * Closes a tab. Closing a pane's last tab closes the pane and its neighbours take its room; the
 * last pane stays and gets an empty tab.
 */
export function closeTab(arrangement: Arrangement, key: string): Arrangement {
  const leaf = leafWithTab(arrangement.root, key);
  if (!leaf) return arrangement;
  const alone = leaves(arrangement.root).length === 1 && leaf.tabs.length === 1;
  if (alone && isEmptyTab(key)) return arrangement;
  return detachTab(arrangement, key);
}

export function closeTabs(arrangement: Arrangement, keys: readonly string[]): Arrangement {
  return keys.reduce((next, key) => closeTab(next, key), arrangement);
}

/** The tabs a tab's "Close others" or "Close tabs to the right" closes. */
export function tabsToClose(
  arrangement: Arrangement,
  key: string,
  which: "others" | "after",
): readonly string[] {
  const leaf = leafWithTab(arrangement.root, key);
  if (!leaf) return [];
  return which === "others"
    ? leaf.tabs.filter((tab) => tab !== key)
    : leaf.tabs.slice(leaf.tabs.indexOf(key) + 1);
}

/**
 * Moves a tab into a pane's tabs at `index` (the end by default), or reorders it within its
 * own, as dropping it on a strip does, counted before the move as the insertion line shows it.
 * The tab becomes active and its pane takes focus; a pane it leaves empty closes.
 */
export function moveTab(
  arrangement: Arrangement,
  key: string,
  toPaneId: string,
  index?: number,
): Arrangement {
  const source = leafWithTab(arrangement.root, key);
  const target = findLeaf(arrangement.root, toPaneId);
  if (!source || !target) return arrangement;
  let at = index ?? target.tabs.length;
  if (source.id === target.id && source.tabs.indexOf(key) < at) at -= 1;
  if (source.id === target.id && source.tabs.indexOf(key) === at) {
    return activateTab(arrangement, key);
  }
  return insertTab(detachTab(arrangement, key, toPaneId), key, toPaneId, at);
}

/**
 * Moves several tabs, in the order given, into a pane's tabs at `index` (the end by default),
 * as dropping a selection of tabs on a strip does. `index` is counted before the move, as the
 * insertion line shows it. `activeKey` (the first by default) becomes active and the pane takes
 * focus; panes the tabs leave empty close.
 */
export function moveTabs(
  arrangement: Arrangement,
  keys: readonly string[],
  toPaneId: string,
  index?: number,
  activeKey?: string,
): Arrangement {
  const moving = keys.filter((key) => leafWithTab(arrangement.root, key));
  const [first] = moving;
  const target = findLeaf(arrangement.root, toPaneId);
  if (first === undefined || !target) return arrangement;
  if (moving.length === 1) return moveTab(arrangement, first, toPaneId, index);
  const at = index ?? target.tabs.length;
  const staying = target.tabs.slice(0, at).filter((key) => !moving.includes(key)).length;
  const detached = moving.reduce((next, key) => detachTab(next, key, toPaneId), arrangement);
  const active = activeKey !== undefined && moving.includes(activeKey) ? activeKey : first;
  const root = mapLeaf(detached.root, toPaneId, (pane) => ({
    ...pane,
    tabs: [...pane.tabs.slice(0, staying), ...moving, ...pane.tabs.slice(staying)],
    active,
  }));
  return { ...detached, root, focused: toPaneId };
}

/**
 * Astrolabe: places `keys`, in order, as a drop from outside the panes (a sidebar row) on
 * `paneId` asks: into its tabs at `index` (counted as the insertion line shows it), or in a new
 * pane on `side`. A key not open yet opens there; one open elsewhere moves. `activeKey` (the
 * first by default) is active.
 */
export function placeTabs(
  arrangement: Arrangement,
  keys: readonly string[],
  paneId: string,
  drop: { readonly side: Side | null; readonly index: number },
  activeKey?: string,
): Arrangement {
  const [first] = keys;
  const target = findLeaf(arrangement.root, paneId);
  if (first === undefined || !target) return arrangement;
  // A pane showing only an empty tab takes the drop in its place.
  const [only, ...rest] = target.tabs;
  const lone = drop.side === null && rest.length === 0 && only !== undefined && isEmptyTab(only);
  // Not open yet: opened at the pane's end, from where the move below puts them in place.
  const opened = keys.reduce((next, key) => {
    if (leafWithTab(next.root, key)) return next;
    const pane = findLeaf(next.root, paneId);
    return pane ? insertTab(next, key, paneId, pane.tabs.length) : next;
  }, arrangement);
  const active = activeKey !== undefined && keys.includes(activeKey) ? activeKey : first;
  if (drop.side !== null) return splitWithTabs(opened, keys, paneId, drop.side, active);
  const placed = moveTabs(opened, keys, paneId, drop.index, active);
  return lone ? closeTab(placed, only) : placed;
}

/**
 * Divides a pane on one side and moves several tabs, in order, into the new pane there, as
 * dropping a selection of tabs on a pane's content does. `activeKey` (the first by default)
 * becomes active; the new pane takes focus.
 */
export function splitWithTabs(
  arrangement: Arrangement,
  keys: readonly string[],
  targetId: string,
  side: Side,
  activeKey?: string,
): Arrangement {
  const moving = keys.filter((key) => leafWithTab(arrangement.root, key));
  const [first] = moving;
  if (first === undefined) return arrangement;
  const split = splitWithTab(arrangement, first, targetId, side);
  const pane = leafWithTab(split.root, first);
  if (split === arrangement || !pane) return arrangement;
  return moveTabs(split, moving, pane.id, undefined, activeKey);
}

/**
 * Moves several tabs of one pane into a new pane beside it, as "Split right" and "Split down"
 * do for a selection. Taking every tab leaves an empty tab behind, so the pane stays.
 */
export function splitTabs(arrangement: Arrangement, keys: readonly string[], side: Side) {
  const [first] = keys;
  const source = first === undefined ? undefined : leafWithTab(arrangement.root, first);
  if (!source) return arrangement;
  const moving = source.tabs.filter((key) => keys.includes(key));
  const from = source.tabs.length > moving.length ? arrangement : newTab(arrangement, source.id);
  return splitWithTabs(from, moving, source.id, side);
}

/**
 * Divides a pane on one side and moves a tab into the new pane there, as dropping a tab on a
 * pane's content does. The new pane takes focus; a pane's only tab cannot divide its own pane.
 */
export function splitWithTab(
  arrangement: Arrangement,
  key: string,
  targetId: string,
  side: Side,
): Arrangement {
  if (!leafWithTab(arrangement.root, key) || !findLeaf(arrangement.root, targetId)) {
    return arrangement;
  }
  return openBeside(arrangement, key, targetId, side);
}

/**
 * Moves a tab into a new pane beside its own, as "Split right" and "Split down" do. A pane's
 * only tab leaves an empty tab behind, so the pane stays where it was.
 */
export function splitTab(arrangement: Arrangement, key: string, side: Side): Arrangement {
  const source = leafWithTab(arrangement.root, key);
  if (!source) return arrangement;
  const from = source.tabs.length > 1 ? arrangement : newTab(arrangement, source.id);
  return splitWithTab(from, key, source.id, side);
}

/** Opens an empty tab at the end of a pane's tabs (the focused one by default). */
export function newTab(
  arrangement: Arrangement,
  paneId: string = arrangement.focused,
): Arrangement {
  const target = findLeaf(arrangement.root, paneId) ?? focusedPane(arrangement);
  const opened = insertTab(arrangement, emptyKey(arrangement.seq), target.id, target.tabs.length);
  return { ...opened, seq: arrangement.seq + 1 };
}

export function resizePanes(
  arrangement: Arrangement,
  branchId: string,
  weights: readonly number[],
): Arrangement {
  const root = setWeights(arrangement.root, branchId, weights);
  return root === arrangement.root ? arrangement : { ...arrangement, root };
}

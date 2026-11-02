import {
  allTabs,
  isEmptyTab,
  isTabKey,
  paneLeaf,
  seqAfter,
  startingArrangement,
  type Arrangement,
} from "./arrangement";
import type { LinkedArrangement, ParkedTab } from "./linkedTabs";
import { isSectionTabKey } from "~/sectionTabs/sectionTabs";
import { leaves, removeLeaf, withOrigin, type SplitNode } from "./tree";

/** The keys a right panel or the Change Requests panes keep: their surfaces, and chats and documents. */
const isPaneKey = (key: string) => isTabKey(key) || isSectionTabKey(key);

/**
 * Each thread's right-panel arrangement is the device's, in localStorage under its scoped thread key, so a
 * thread comes back as it was left in any browser tab and after a restart. A thread left in its
 * starting arrangement keeps nothing, so storage grows only with the threads someone arranged.
 */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// The main-area arrangements of earlier builds (`t3code:panes:v1:`) held the conversation and
// guest threads; the right panel starts fresh rather than reading them.
const STORAGE_PREFIX = "t3code:right-panel-panes:v1:";

export function arrangementStorageKey(threadKey: string) {
  return `${STORAGE_PREFIX}${threadKey}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a stored tree node, keeping only what the panes can show: a pane's tabs are keys of
 * tabs it can hold, each open once (`open` collects them), its active tab one of them; a
 * branch divides at least two nodes by positive weights. Ids repeat nowhere (`ids`). Null
 * when nothing usable is left.
 */
function readNode(
  value: unknown,
  open: Set<string>,
  ids: Set<string>,
  isKey: (key: string) => boolean,
): SplitNode | null {
  if (!isRecord(value) || typeof value.id !== "string" || ids.has(value.id)) return null;
  ids.add(value.id);
  if (value.type === "leaf") {
    if (!Array.isArray(value.tabs)) return null;
    const tabs: string[] = [];
    for (const key of value.tabs) {
      if (typeof key !== "string" || !isKey(key) || open.has(key)) continue;
      open.add(key);
      tabs.push(key);
    }
    if (tabs.length === 0) return null;
    const active =
      typeof value.active === "string" && tabs.includes(value.active) ? value.active : tabs[0];
    const leaf = { ...paneLeaf(value.id, tabs), active: active ?? "" };
    return typeof value.from === "string" ? { ...leaf, from: value.from } : leaf;
  }
  if (value.type !== "branch" || (value.direction !== "row" && value.direction !== "column")) {
    return null;
  }
  if (!Array.isArray(value.children)) return null;
  const stored = Array.isArray(value.weights) ? value.weights : [];
  const children: SplitNode[] = [];
  const weights: number[] = [];
  value.children.forEach((child, index) => {
    const node = readNode(child, open, ids, isKey);
    if (!node) return;
    children.push(node);
    const weight = stored[index];
    weights.push(typeof weight === "number" && Number.isFinite(weight) && weight > 0 ? weight : 1);
  });
  const [only] = children;
  if (children.length === 0 || !only) return null;
  if (children.length === 1) return only;
  return { type: "branch", id: value.id, direction: value.direction, children, weights };
}

/**
 * Forgets an origin naming no other pane of the tree (one dropped as unreadable), so it cannot
 * point at a later pane given the same id.
 */
function dropStaleOrigins(root: SplitNode): SplitNode {
  const ids = new Set(leaves(root).map((leaf) => leaf.id));
  const visit = (node: SplitNode): SplitNode => {
    if (node.type === "branch") return { ...node, children: node.children.map(visit) };
    const { from } = node;
    return from === undefined || (from !== node.id && ids.has(from))
      ? node
      : withOrigin(node, undefined);
  };
  return visit(root);
}

/**
 * A stored arrangement as the panes can use it; null for one that holds nothing usable. `isKey`
 * says which tab keys the panes can show (the right panel's by default).
 */
export function parseArrangement(
  value: unknown,
  isKey: (key: string) => boolean = isPaneKey,
): Arrangement | null {
  if (!isRecord(value)) return null;
  const read = readNode(value.root, new Set(), new Set(), isKey);
  if (!read) return null;
  const root = dropStaleOrigins(read);
  const panes = leaves(root);
  const focused =
    typeof value.focused === "string" && panes.some((pane) => pane.id === value.focused)
      ? value.focused
      : (panes[0]?.id ?? "p0");
  const stored = typeof value.seq === "number" && Number.isSafeInteger(value.seq) ? value.seq : 0;
  return { root, focused, seq: Math.max(stored, seqAfter(root)) };
}

/** The arrangement a thread was last left in on this device; null when it has none. */
function readArrangement(storage: StorageLike | null, threadKey: string): Arrangement | null {
  try {
    const raw = storage?.getItem(arrangementStorageKey(threadKey));
    return raw ? parseArrangement(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function isStarting(arrangement: Arrangement) {
  const { root } = arrangement;
  return (
    root.type === "leaf" &&
    root.tabs.length === 1 &&
    isEmptyTab(root.tabs[0] ?? "") &&
    arrangement.focused === root.id
  );
}

export function writeArrangement(
  storage: StorageLike | null,
  threadKey: string,
  arrangement: Arrangement,
) {
  try {
    const key = arrangementStorageKey(threadKey);
    if (isStarting(arrangement)) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(arrangement));
  } catch {
    // Storage full or blocked: the panes still work until the page goes away.
  }
}

/** The arrangement a thread opens in: as last left on this device, else its starting one. */
export function loadArrangement(storage: StorageLike | null, threadKey: string): Arrangement {
  return readArrangement(storage, threadKey) ?? startingArrangement();
}

/**
 * Astrolabe: the shared panes as kept on the device: their arrangement (`isKey` says which tabs
 * they hold) and links, keeping only links of tabs open or set aside, and set-aside tabs that
 * still have an owner. Null for nothing usable.
 */
export function parseLinkedArrangement(
  value: unknown,
  isKey: (key: string) => boolean,
): LinkedArrangement | null {
  if (!isRecord(value)) return null;
  const arrangement = parseArrangement(value, isKey);
  if (!arrangement) return null;
  const open = new Set(allTabs(arrangement));
  const parked: Record<string, ParkedTab> = {};
  if (isRecord(value.parked)) {
    for (const [key, place] of Object.entries(value.parked)) {
      if (!isKey(key) || open.has(key) || !isRecord(place)) continue;
      const { pane, index, active } = place;
      if (typeof pane !== "string" || typeof index !== "number" || !Number.isFinite(index))
        continue;
      parked[key] = { pane, index: Math.max(0, index), active: active === true };
    }
  }
  const owners: Record<string, string> = {};
  if (isRecord(value.owners)) {
    for (const [key, owner] of Object.entries(value.owners)) {
      if (typeof owner === "string" && (open.has(key) || key in parked)) owners[key] = owner;
    }
  }
  for (const key of Object.keys(parked)) if (!(key in owners)) delete parked[key];
  const front = typeof value.front === "string" && open.has(value.front) ? value.front : null;
  return { arrangement, owners, parked, front };
}

/** A tree's pane ids and empty tabs renumbered from `offset`, so trees can join without clashes. */
function renumber(node: SplitNode, offset: number): SplitNode {
  const id = (raw: string) => {
    const number = /^p(\d+)$/.exec(raw)?.[1];
    return number === undefined ? `${raw}-${offset}` : `p${Number(number) + offset}`;
  };
  if (node.type === "branch") {
    return { ...node, id: id(node.id), children: node.children.map((c) => renumber(c, offset)) };
  }
  const tab = (key: string) => {
    const number = /^empty\/(\d+)$/.exec(key)?.[1];
    return number === undefined ? key : `empty/${Number(number) + offset}`;
  };
  const moved = { ...node, id: id(node.id), tabs: node.tabs.map(tab), active: tab(node.active) };
  return node.from === undefined ? moved : { ...moved, from: id(node.from) };
}

/**
 * Astrolabe: the shared panes as they first open after sections kept panes of their own: the
 * chats (`chats`, by tab key, `activeChat` in front) in one pane, and beside it each section's
 * arrangement as it was left. Null when there was nothing to bring.
 */
export function joinLayouts(
  chats: readonly string[],
  activeChat: string | null,
  sections: readonly Arrangement[],
  isKey: (key: string) => boolean,
): Arrangement | null {
  const kept = sections.filter((section) => !isStarting(section));
  const parts: SplitNode[] = [];
  if (chats.length > 0) {
    const leaf = paneLeaf("p0", chats);
    parts.push(
      activeChat !== null && chats.includes(activeChat) ? { ...leaf, active: activeChat } : leaf,
    );
  }
  let offset = 1;
  for (const section of kept) {
    parts.push(renumber(section.root, offset));
    offset += seqAfter(section.root) + 1;
  }
  const [only] = parts;
  if (!only) return null;
  const root: SplitNode =
    parts.length === 1
      ? only
      : {
          type: "branch",
          id: `p${offset}`,
          direction: "row",
          children: parts,
          weights: parts.map(() => 1),
        };
  const joined = parseArrangement({ root, focused: leaves(root)[0]?.id, seq: offset + 1 }, isKey);
  if (!joined) return null;
  // A pane left with only empty tabs, its others open elsewhere already, has nothing to bring.
  let trimmed: SplitNode | null = joined.root;
  for (const leaf of leaves(joined.root)) {
    if (trimmed === null || leaves(trimmed).length === 1 || !leaf.tabs.every(isEmptyTab)) continue;
    trimmed = removeLeaf(trimmed, leaf.id);
  }
  if (trimmed === null) return null;
  const focused = leaves(trimmed)[0]?.id ?? joined.focused;
  return { ...joined, root: trimmed, focused };
}

/**
 * Astrolabe: `extra`'s panes joined to the right of `base`'s, as a section's own panes join the
 * shared ones. Its pane ids and empty tabs are renumbered past `base`'s, tabs `base` holds stay
 * where `base` has them, and its panes left with only empty tabs go. `base` keeps its ids, so
 * what refers to its panes still does; a `base` holding nothing yet gives way to `extra`.
 */
export function joinBeside(
  base: Arrangement,
  extra: Arrangement,
  isKey: (key: string) => boolean,
): Arrangement {
  const offset = Math.max(base.seq, seqAfter(base.root)) + 1;
  const held = new Set(allTabs(base));
  const moved = renumber(extra.root, offset);
  const parsed = parseArrangement(
    { root: moved, focused: leaves(moved)[0]?.id, seq: 0 },
    (key) => isKey(key) && !held.has(key),
  );
  let side: SplitNode | null = parsed?.root ?? null;
  for (const leaf of parsed ? leaves(parsed.root) : []) {
    if (side !== null && leaf.tabs.every(isEmptyTab)) side = removeLeaf(side, leaf.id);
  }
  if (side === null) return base;
  if (isStarting(base)) {
    return { root: side, focused: leaves(side)[0]?.id ?? base.focused, seq: seqAfter(side) };
  }
  const id = `p${seqAfter(side)}`;
  const root: SplitNode = {
    type: "branch",
    id,
    direction: "row",
    children: [base.root, side],
    weights: [1, 1],
  };
  return { root, focused: base.focused, seq: Math.max(base.seq, seqAfter(root)) };
}

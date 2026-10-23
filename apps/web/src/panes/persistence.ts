import {
  isEmptyTab,
  isTabKey,
  paneLeaf,
  seqAfter,
  startingArrangement,
  type Arrangement,
} from "./arrangement";
import { isSectionTabKey } from "~/sectionTabs/sectionTabs";
import { leaves, type SplitNode } from "./tree";

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
    return { ...paneLeaf(value.id, tabs), active: active ?? "" };
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
 * A stored arrangement as the panes can use it; null for one that holds nothing usable. `isKey`
 * says which tab keys the panes can show (the right panel's by default).
 */
export function parseArrangement(
  value: unknown,
  isKey: (key: string) => boolean = isPaneKey,
): Arrangement | null {
  if (!isRecord(value)) return null;
  const root = readNode(value.root, new Set(), new Set(), isKey);
  if (!root) return null;
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

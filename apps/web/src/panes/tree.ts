/**
 * A thread's pane tree: leaves are panes holding tabs, branches divide their room side by
 * side (`row`) or stacked (`column`) by relative weights. Every operation returns a new tree
 * and keeps untouched subtrees by reference, so unchanged panes skip re-rendering.
 */

export type Direction = "row" | "column";
export type Side = "left" | "right" | "top" | "bottom";

export interface Leaf {
  readonly type: "leaf";
  readonly id: string;
  /** The keys of the views the pane's tabs show, in strip order; never empty. */
  readonly tabs: readonly string[];
  /** The tab the pane shows, one of `tabs`. */
  readonly active: string;
  /** The pane this one was split from, which gets its room back when it closes. */
  readonly from?: string;
}

export interface Branch {
  readonly type: "branch";
  readonly id: string;
  readonly direction: Direction;
  readonly children: readonly SplitNode[];
  readonly weights: readonly number[];
}

export type SplitNode = Leaf | Branch;

/** The smallest a pane may be dragged to, in pixels. */
export const MIN_SPLIT_PX = 160;
function sideDirection(side: Side): Direction {
  return side === "left" || side === "right" ? "row" : "column";
}

function isBefore(side: Side) {
  return side === "left" || side === "top";
}

export function leaves(node: SplitNode): Leaf[] {
  return node.type === "leaf" ? [node] : node.children.flatMap(leaves);
}

export function findLeaf(node: SplitNode, id: string) {
  return leaves(node).find((leaf) => leaf.id === id);
}

export function leafWithTab(node: SplitNode, key: string) {
  return leaves(node).find((leaf) => leaf.tabs.includes(key));
}

function containsLeaf(node: SplitNode, id: string): boolean {
  return node.type === "leaf" ? node.id === id : node.children.some((c) => containsLeaf(c, id));
}

export function mapLeaf(node: SplitNode, id: string, update: (leaf: Leaf) => Leaf): SplitNode {
  if (node.type === "leaf") return node.id === id ? update(node) : node;
  let changed = false;
  const children = node.children.map((child) => {
    const next = mapLeaf(child, id, update);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

export function setWeights(
  node: SplitNode,
  branchId: string,
  weights: readonly number[],
): SplitNode {
  if (node.type === "leaf") return node;
  if (node.id === branchId) {
    return weights.length === node.children.length ? { ...node, weights } : node;
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = setWeights(child, branchId, weights);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/**
 * Collapses a branch left with one child into that child, and folds a child branch that
 * runs the same direction as its parent into the parent, keeping each pane's share.
 */
function normalize(branch: Branch): SplitNode {
  const children: SplitNode[] = [];
  const weights: number[] = [];
  branch.children.forEach((child, index) => {
    const weight = branch.weights[index] ?? 1;
    if (child.type === "branch" && child.direction === branch.direction) {
      const total = sum(child.weights);
      child.children.forEach((grandchild, inner) => {
        children.push(grandchild);
        weights.push(((child.weights[inner] ?? 1) * weight) / total);
      });
    } else {
      children.push(child);
      weights.push(weight);
    }
  });
  const [only] = children;
  if (children.length === 1 && only) return only;
  return { ...branch, children, weights };
}

/**
 * Removes a pane. One pane beside it in its branch takes all its room and the others keep theirs:
 * the one holding the pane it was split from, else one split from it (next to it, else the
 * first), else the one before it, else the one after. Panes split from it count as split from
 * the pane that took its place from then on. Returns null when nothing is left.
 */
export function removeLeaf(node: SplitNode, id: string): SplitNode | null {
  const removed = findLeaf(node, id);
  if (!removed) return node;
  const dropped = dropLeaf(node, removed);
  return dropped && repoint(dropped.node, removed, dropped.heir);
}

/** Removes `removed`, giving its room to one sibling; `heir` is the pane that took its place. */
function dropLeaf(
  node: SplitNode,
  removed: Leaf,
): { readonly node: SplitNode; readonly heir: string | undefined } | null {
  if (node.type === "leaf") return node.id === removed.id ? null : { node, heir: undefined };
  const weights = node.children.map((_, i) => node.weights[i] ?? 1);
  const index = node.children.findIndex((c) => c.type === "leaf" && c.id === removed.id);
  if (index === -1) {
    const at = node.children.findIndex((c) => containsLeaf(c, removed.id));
    const child = node.children[at];
    if (!child) return { node, heir: undefined };
    const inner = dropLeaf(child, removed);
    if (!inner) return null;
    const children = node.children.map((child, i) => (i === at ? inner.node : child));
    return { node: normalize({ ...node, children, weights }), heir: inner.heir };
  }
  const { at, heir } = heirOf(node.children, index, removed);
  const share = weights[index] ?? 1;
  const children = node.children.filter((_, i) => i !== index);
  const rest = weights.flatMap((w, i) => (i === index ? [] : [i === at ? w + share : w]));
  if (children.length === 0) return null;
  return { node: normalize({ ...node, children, weights: rest }), heir };
}

/** Which of a removed pane's siblings takes its room, and the pane in it that takes its place. */
function heirOf(children: readonly SplitNode[], index: number, removed: Leaf) {
  const origin = removed.from;
  if (origin !== undefined) {
    const at = children.findIndex((c, i) => i !== index && containsLeaf(c, origin));
    if (at !== -1) return { at, heir: origin };
  }
  const splitters = children.flatMap((child, at) => {
    if (at === index) return [];
    const splitter = leaves(child).find((leaf) => leaf.from === removed.id);
    return splitter ? [{ at, heir: splitter.id }] : [];
  });
  const splitter =
    splitters.find(({ at }) => at === index - 1) ??
    splitters.find(({ at }) => at === index + 1) ??
    splitters[0];
  if (splitter) return splitter;
  const at = index > 0 ? index - 1 : index + 1;
  const neighbour = children[at];
  return { at, heir: neighbour?.type === "leaf" ? neighbour.id : undefined };
}

/**
 * Points panes split from `removed` at `heir`, the pane that took its place; `heir` itself
 * takes `removed`'s own origin.
 */
function repoint(node: SplitNode, removed: Leaf, heir: string | undefined): SplitNode {
  if (node.type === "leaf") {
    if (node.from !== removed.id) return node;
    const from = node.id === heir ? removed.from : heir;
    return withOrigin(node, from === node.id ? undefined : from);
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = repoint(child, removed, heir);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

export function withOrigin(leaf: Leaf, from: string | undefined): Leaf {
  if (from !== undefined) return { ...leaf, from };
  const { from: _from, ...rest } = leaf;
  return rest;
}

/**
 * Divides the target pane and puts `newLeaf` on the given side of it, remembering it was split from
 * the target. The divided pane's share is halved between the two, so the other panes keep their
 * size.
 */
export function insertBeside(
  node: SplitNode,
  targetId: string,
  newLeaf: Leaf,
  side: Side,
  branchId: string,
): SplitNode {
  const direction = sideDirection(side);
  const leaf = withOrigin(newLeaf, targetId);
  const pair = (target: SplitNode) => (isBefore(side) ? [leaf, target] : [target, leaf]);
  if (node.type === "leaf") {
    if (node.id !== targetId) return node;
    return { type: "branch", id: branchId, direction, children: pair(node), weights: [1, 1] };
  }
  const index = node.children.findIndex((c) => c.type === "leaf" && c.id === targetId);
  const target = node.children[index];
  if (target && node.direction === direction) {
    const half = (node.weights[index] ?? 1) / 2;
    return {
      ...node,
      children: [
        ...node.children.slice(0, index),
        ...pair(target),
        ...node.children.slice(index + 1),
      ],
      weights: [...node.weights.slice(0, index), half, half, ...node.weights.slice(index + 1)],
    };
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = insertBeside(child, targetId, newLeaf, side, branchId);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/**
 * The narrowest a subtree may be, in pixels: panes side by side add up, stacked panes take
 * the widest. `minOf` gives each pane's own minimum width.
 */
export function minWidthPx(node: SplitNode, minOf: (leaf: Leaf) => number): number {
  if (node.type === "leaf") return minOf(node);
  const widths = node.children.map((child) => minWidthPx(child, minOf));
  return node.direction === "row" ? widths.reduce((all, w) => all + w, 0) : Math.max(...widths);
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0) || 1;
}

/**
 * Moves the divider after `index` by `deltaPx` inside a branch `extentPx` long. Only the two
 * panes either side of the divider change, and neither goes below its minimum size
 * (`minBeforePx` and `minAfterPx`, scaled down together when the pair cannot hold both).
 * `weights` are the weights when the drag started, so repeated calls do not drift.
 */
export function resizeTiled(
  weights: readonly number[],
  index: number,
  deltaPx: number,
  extentPx: number,
  minBeforePx = MIN_SPLIT_PX,
  minAfterPx = MIN_SPLIT_PX,
): readonly number[] {
  const before = weights[index];
  const after = weights[index + 1];
  if (before === undefined || after === undefined || extentPx <= 0) return weights;
  const perPx = sum(weights) / extentPx;
  const fit = Math.min(1, (before + after) / ((minBeforePx + minAfterPx) * perPx));
  const [minBefore, minAfter] = [minBeforePx * perPx * fit, minAfterPx * perPx * fit];
  const moved = clamp(deltaPx * perPx, minBefore - before, after - minAfter);
  return weights.map((weight, i) =>
    i === index ? before + moved : i === index + 1 ? after - moved : weight,
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

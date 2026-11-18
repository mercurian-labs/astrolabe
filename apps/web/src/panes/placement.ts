import type { PaneOpenBeside } from "@t3tools/contracts";

import { parseChatTabKey } from "~/sectionTabs/sectionTabs";

import { activateTab, openBeside, openTab, type Arrangement } from "./arrangement";
import { findLeaf, leafWithTab, leaves, type Leaf, type Side, type SplitNode } from "./tree";

/**
 * Astrolabe: where a view opened beside what you are reading goes (Panes › Where does an opened
 * tab go?). A side pane takes it as a tab before the panes divide, and they divide only while
 * both halves stay usable, so a narrow window keeps one pane and a wide one keeps two.
 */
export const CHAT_ROOM_PX = 480;
const VIEW_ROOM_PX = 400;

const roomOf = (key: string) => (parseChatTabKey(key) !== null ? CHAT_ROOM_PX : VIEW_ROOM_PX);

let measuredWidthPx: number | null = null;
let opensBeside: PaneOpenBeside = "when-room";

/** The panes' width on screen, as their root last measured it; null before it mounts. */
const panesWidthPx = () => measuredWidthPx;

export function setPanesWidthPx(widthPx: number | null) {
  measuredWidthPx = widthPx;
}

/** Settings › General › Panes: "as-tab" never divides a pane for a view that can share it. */
export function setPaneOpenBeside(setting: PaneOpenBeside) {
  opensBeside = setting;
}

/** The width the tiling gives the pane `id` in a tree `widthPx` wide, or null without it. */
export function paneWidthPx(node: SplitNode, id: string, widthPx: number): number | null {
  if (node.type === "leaf") return node.id === id ? widthPx : null;
  const total = node.weights.reduce((sum, weight) => sum + weight, 0) || 1;
  for (const [index, child] of node.children.entries()) {
    const share = node.direction === "row" ? (node.weights[index] ?? 0) / total : 1;
    const width = paneWidthPx(child, id, widthPx * share);
    if (width !== null) return width;
  }
  return null;
}

/**
 * The pane beside `targetId` that can take another tab: not showing a chat, which a tab in front
 * would cover. The nearest after it in reading order, else the nearest before it.
 */
function sidePaneOf(arrangement: Arrangement, targetId: string): Leaf | undefined {
  const all = leaves(arrangement.root);
  const at = all.findIndex((leaf) => leaf.id === targetId);
  if (at === -1) return undefined;
  const takes = (leaf: Leaf) => parseChatTabKey(leaf.active) === null;
  return all.slice(at + 1).find(takes) ?? all.slice(0, at).toReversed().find(takes);
}

/**
 * Whether dividing `targetId` for `key`, which takes `weight` of it, leaves both panes room
 * enough. Unmeasured, it does.
 */
function hasRoomBeside(
  arrangement: Arrangement,
  targetId: string,
  key: string,
  weight: number,
  widthPx: number | null,
): boolean {
  const target = findLeaf(arrangement.root, targetId);
  if (!target || widthPx === null) return true;
  const width = paneWidthPx(arrangement.root, targetId, widthPx);
  if (width === null) return true;
  return width * weight >= roomOf(key) && width * (1 - weight) >= roomOf(target.active);
}

export interface OpenNearOptions {
  readonly side?: Side;
  readonly focus?: boolean;
  /** The new pane's share when the panes divide. */
  readonly weight?: number;
  /** The panes' width; the measured one by default. */
  readonly widthPx?: number | null;
  /** It may not join the target's pane, as a chat's linked tab may not join the chat's. */
  readonly ownPane?: boolean;
  /** Whether the panes may divide for room; the setting by default. */
  readonly divides?: boolean;
}

/**
 * Opens `key` beside the pane `targetId`: in front where another pane holds it; else in the side
 * pane; else in a new pane, while there is room for one; else as a tab after the target's. One
 * the target holds moves out the same way, or stays in front where it is.
 */
export function openNear(
  arrangement: Arrangement,
  key: string,
  targetId: string,
  {
    side = "right",
    focus = true,
    weight = 0.5,
    widthPx = panesWidthPx(),
    ownPane = false,
    divides = opensBeside === "when-room",
  }: OpenNearOptions = {},
): Arrangement {
  const holder = leafWithTab(arrangement.root, key);
  if (holder && holder.id !== targetId) return activateTab(arrangement, key, focus);
  const sidePane = sidePaneOf(arrangement, targetId);
  if (sidePane) return openTab(arrangement, key, sidePane.id, focus);
  if (ownPane || (divides && hasRoomBeside(arrangement, targetId, key, weight, widthPx))) {
    return openBeside(arrangement, key, targetId, side, { focus, weight });
  }
  return holder ? activateTab(arrangement, key, focus) : openTab(arrangement, key, targetId, focus);
}

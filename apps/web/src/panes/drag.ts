import { useSyncExternalStore, type DragEvent } from "react";
import type { Side } from "./tree";

/**
 * What is being dragged: a tab, by the key of the view it shows, and the tabs travelling with it
 * (`keys`, in their pane's order: the selection it is part of, else itself). Drop targets need it
 * during `dragover`, where the browser hides dataTransfer contents, so the item is kept here for
 * the drag's duration.
 */
export interface DragItem {
  readonly key: string;
  readonly keys: readonly string[];
}

let current: DragItem | null = null;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/**
 * Starts dragging `item`, `label` naming it. Several tabs travel under one preview: the grabbed
 * pill's title on a stack of cards, with how many there are, so the drag shows it carries them
 * all; one tab keeps the browser's snapshot of its pill.
 */
export function startDrag(event: DragEvent, item: DragItem, label: string) {
  current = item;
  event.dataTransfer.effectAllowed = "move";
  // Firefox only starts a drag that carries data.
  event.dataTransfer.setData("text/plain", label);
  if (item.keys.length > 1) setStackedPreview(event, label, item.keys.length);
  // After the browser has taken its snapshot, so the pills restyle without changing it.
  setTimeout(changed);
}

export function endDrag() {
  if (current === null) return;
  current = null;
  changed();
}

/** Whether a tab is travelling in the current drag: the pills dragged dim while they are. */
export function useDragging(key: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current?.keys.includes(key) ?? false,
  );
}

/** The preview for several tabs: a card with the grabbed tab's title and the count, stacked. */
function setStackedPreview(event: DragEvent, title: string, count: number) {
  const card = document.createElement("div");
  // Off screen but rendered, as the browser needs to draw it; drawn in the theme's tokens.
  Object.assign(card.style, {
    position: "fixed",
    top: "-1000px",
    left: "0",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    maxWidth: "240px",
    height: "28px",
    padding: "0 6px 0 10px",
    borderRadius: "6px",
    border: "1px solid var(--border)",
    background: "var(--card)",
    color: "var(--foreground)",
    font: "500 12px/1 var(--font-sans, system-ui)",
    // Two cards behind it, offset down and right.
    boxShadow:
      "3px 3px 0 -1px var(--card), 3px 3px 0 0 var(--border), 6px 6px 0 -1px var(--card), 6px 6px 0 0 var(--border)",
  } satisfies Partial<CSSStyleDeclaration>);
  const name = document.createElement("span");
  name.textContent = title;
  Object.assign(name.style, { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
  const badge = document.createElement("span");
  badge.textContent = String(count);
  Object.assign(badge.style, {
    flexShrink: "0",
    minWidth: "18px",
    height: "18px",
    padding: "0 5px",
    borderRadius: "9px",
    background: "var(--primary)",
    color: "var(--primary-foreground)",
    fontSize: "11px",
    lineHeight: "18px",
    textAlign: "center",
  } satisfies Partial<CSSStyleDeclaration>);
  card.append(name, badge);
  document.body.append(card);
  event.dataTransfer.setDragImage(card, 16, 14);
  // The browser copies the image as the drag starts; the card is not needed after.
  setTimeout(() => card.remove());
}

export function currentDrag() {
  return current;
}

/** An edge divides the pane there; the middle (the pane's strip) joins its tabs. */
export type DropZone = Side | "center";

/** Share of a pane's width or height, from each edge, that divides it on drop. */
const EDGE_BAND = 0.25;
/** A band of one half leaves no middle: every point of a pane is in the half nearest it. */
const HALVES = 0.5;

/**
 * Which part of a pane a pointer at (x, y) inside a `width` x `height` box points at: the
 * nearest edge within `edgeBand` of it, or the middle.
 */
export function dropZone(
  x: number,
  y: number,
  width: number,
  height: number,
  edgeBand = EDGE_BAND,
): DropZone {
  const distances = [
    { side: "left" as const, share: x / width },
    { side: "right" as const, share: 1 - x / width },
    { side: "top" as const, share: y / height },
    { side: "bottom" as const, share: 1 - y / height },
  ];
  const nearest = distances.reduce((best, next) => (next.share < best.share ? next : best));
  return nearest.share <= edgeBand ? nearest.side : "center";
}

/**
 * Where a tab dragged over a pane lands, as Obsidian decides it. Over the pane's strip, its
 * top `stripSize` pixels, it joins the pane's tabs. Over the content it divides the pane on
 * the half nearest the pointer.
 */
export function paneDropZone(
  x: number,
  y: number,
  width: number,
  height: number,
  stripSize: number,
): DropZone {
  return y < stripSize ? "center" : dropZone(x, y - stripSize, width, height - stripSize, HALVES);
}

/**
 * Where a tab dragged along a strip lands, given each tab's midpoint along the strip in order:
 * before the first tab whose midpoint is past the pointer, or at the end.
 */
export function insertIndex(midpoints: readonly number[], at: number) {
  const index = midpoints.findIndex((middle) => at < middle);
  return index === -1 ? midpoints.length : index;
}

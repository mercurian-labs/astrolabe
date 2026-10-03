import type { DragEvent } from "react";
import type { Side } from "./tree";

/**
 * What is being dragged: a tab, by the key of the view it shows. Drop targets need it during
 * `dragover`, where the browser hides dataTransfer contents, so the item is kept here for the
 * drag's duration.
 */
export interface DragItem {
  readonly key: string;
}

let current: DragItem | null = null;

export function startDrag(event: DragEvent, item: DragItem, label: string) {
  current = item;
  event.dataTransfer.effectAllowed = "move";
  // Firefox only starts a drag that carries data.
  event.dataTransfer.setData("text/plain", label);
}

export function endDrag() {
  current = null;
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

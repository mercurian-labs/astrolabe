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
  /**
   * Astrolabe: for what is dragged from outside the panes (a sidebar's rows, with no tabs yet:
   * `keys` is empty), what dropping it does: open it on `paneId`, at `index` of its strip or in
   * a new pane on `side`.
   */
  readonly place?: (paneId: string, drop: { side: Side | null; index: number }) => void;
  /**
   * Astrolabe: a tab group dragged by its marker (`tabGroups`), by its id: `keys` are its run's
   * tabs, which hide behind the marker until the drop, and it lands between whole runs.
   */
  readonly group?: string;
}

let current: DragItem | null = null;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/**
 * Starts dragging `item`, named `label`. The preview is `startTabDragPreview`'s pill, with how
 * many travel (`count`, the tabs by default) when several do.
 */
export function startDrag(
  event: DragEvent<HTMLElement>,
  item: DragItem,
  label: string,
  count = item.keys.length,
) {
  current = item;
  event.dataTransfer.effectAllowed = "move";
  // Firefox only starts a drag that carries data.
  event.dataTransfer.setData("text/plain", label);
  startTabDragPreview(event, count);
  // After the drag has started, so the pills restyle without disturbing it.
  setTimeout(changed);
}

export function endDrag() {
  stopTabDragPreview();
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

/** The tab group being dragged by its marker, if one is: its run shows the marker alone. */
export function useDraggedGroup(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current?.group ?? null,
  );
}

/** Stands in for the browser's own drag image, which the page draws instead. */
const BLANK =
  typeof Image === "undefined"
    ? null
    : Object.assign(new Image(), {
        src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      });

let preview: { readonly element: HTMLElement; readonly stop: () => void } | null = null;

/**
 * Draws a tab's drag preview in the page: a pill with the tab's icon and title, held under the
 * pointer where it grabbed the tab, with a count and stacked cards behind it when `count` tabs
 * travel. The browser's own snapshot of a tab takes the strip around it (square corners, the
 * tab in front's feet), so it is replaced by a blank image. A tab group's marker is its own
 * preview, as it stands, on a card's fill. Ends on drop, on the drag's end, or with
 * `stopTabDragPreview`.
 */
export function startTabDragPreview(event: DragEvent<HTMLElement>, count = 1) {
  stopTabDragPreview();
  const tab = event.currentTarget;
  const box = tab.getBoundingClientRect();
  const grab = { x: event.clientX - box.left, y: Math.min(event.clientY - box.top, 28) };
  const element = tab.hasAttribute("data-tab-group")
    ? groupPreview(tab, box)
    : tabPreview(tab, box, count);
  element.setAttribute("aria-hidden", "true");
  const place = (x: number, y: number) => {
    element.style.translate = `${x - grab.x}px ${y - grab.y}px`;
  };
  place(event.clientX, event.clientY);
  document.body.append(element);
  if (BLANK) event.dataTransfer.setDragImage(BLANK, 0, 0);

  // Every dragover in the page, wherever it lands; capturing on the window, ahead of the
  // targets that stop it.
  const follow = (moved: globalThis.DragEvent) => place(moved.clientX, moved.clientY);
  const stop = () => stopTabDragPreview();
  window.addEventListener("dragover", follow, true);
  window.addEventListener("drop", stop, true);
  window.addEventListener("dragend", stop, true);
  preview = {
    element,
    stop: () => {
      window.removeEventListener("dragover", follow, true);
      window.removeEventListener("drop", stop, true);
      window.removeEventListener("dragend", stop, true);
      element.remove();
    },
  };
}

function tabPreview(tab: HTMLElement, box: DOMRect, count: number) {
  const element = document.createElement("div");
  element.className =
    // Its icon at full strength, as the tab in front draws it.
    "pointer-events-none fixed top-0 left-0 z-[100] flex h-7 items-center gap-1.5 rounded-md border border-border bg-popover px-2.25 text-xs font-medium text-foreground shadow-md [&_img]:opacity-100 [&_svg]:opacity-100 [&>[data-tab-icon]]:opacity-100";
  element.style.width = `${Math.min(box.width, 240)}px`;
  // Two cards behind it, offset down and right.
  if (count > 1) {
    element.style.boxShadow =
      "3px 3px 0 -1px var(--popover), 3px 3px 0 0 var(--border), 6px 6px 0 -1px var(--popover), 6px 6px 0 0 var(--border)";
  }
  const icon = tab.querySelector("[data-tab-icon]");
  if (icon) element.append(icon.cloneNode(true));
  const title = document.createElement("span");
  title.className = "min-w-0 flex-1 truncate";
  title.textContent = tab.getAttribute("aria-label");
  element.append(title);
  if (count > 1) {
    const badge = document.createElement("span");
    badge.className =
      "flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-primary px-1.25 text-[11px] text-primary-foreground";
    badge.textContent = String(count);
    element.append(badge);
  }
  return element;
}

function groupPreview(marker: HTMLElement, box: DOMRect) {
  const element = marker.cloneNode(true) as HTMLElement;
  element.removeAttribute("data-tab-group");
  element.removeAttribute("draggable");
  element.classList.add("pointer-events-none", "fixed", "top-0", "left-0", "z-[100]", "shadow-md");
  element.style.width = `${box.width}px`;
  // The marker is bare in its strip, as the tabs behind the one in front are.
  element.style.background = "var(--popover)";
  element.style.borderColor = "var(--border)";
  return element;
}

/** Removes the drag preview, as a drop that moved the dragged tab elsewhere does. */
function stopTabDragPreview() {
  preview?.stop();
  preview = null;
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

/**
 * Where the insertion line for `index` goes along a strip whose tabs are `boxes`, in order: midway
 * between the tabs either side of it, or `gap / 2` past the end tab; `start` with no tabs.
 */
export function insertionLineX(
  boxes: readonly { readonly left: number; readonly right: number }[],
  index: number,
  gap: number,
  start: number,
) {
  const before = boxes[index - 1];
  const after = boxes[index];
  if (before && after) return (before.right + after.left) / 2;
  if (after) return after.left - gap / 2;
  if (before) return before.right + gap / 2;
  return start;
}

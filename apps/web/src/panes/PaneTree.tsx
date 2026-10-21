import { Fragment, useEffect, useRef, useState, type PointerEvent } from "react";

import { cn } from "../lib/utils";
import { resizePanes } from "./arrangement";
import { useMaximizedPaneId, useMaximizedPaneStore } from "./maximize";
import type { PanesSnapshot } from "./panesController";
import { usePanesHost } from "./PaneSurfaceHost";
import { PaneView } from "./PaneView";
import {
  findLeaf,
  leaves,
  MIN_SPLIT_PX,
  minWidthPx,
  resizeTiled,
  type Direction,
  type SplitNode,
} from "./tree";

const paneMinimum = () => MIN_SPLIT_PX;

/**
 * The thread's right-panel panes, fitted to the panel. Panes never go below their minimum width;
 * when those add up past the panel, it scrolls sideways rather than squeezing them.
 */
/**
 * `panelMaximized` says whether the panel fills the main area, so its left edge is the window's
 * and its top-left strip clears a collapsed sidebar's controls.
 */
export function PaneTree({
  snapshot,
  panelMaximized,
}: {
  snapshot: PanesSnapshot;
  panelMaximized: boolean;
}) {
  const { arrangement, hostPaneId } = snapshot;
  const maximizedId = useMaximizedPaneId();
  // Maximizing ends once the pane is gone or the last one left, so a later split shows every
  // pane rather than maximizing again.
  const maximized =
    maximizedId !== null &&
    findLeaf(arrangement.root, maximizedId) &&
    leaves(arrangement.root).length > 1
      ? maximizedId
      : null;
  useEffect(() => {
    if (maximizedId !== null && maximized === null) useMaximizedPaneStore.getState().restore();
  }, [maximized, maximizedId]);
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 overflow-y-hidden",
        maximized === null ? "overflow-x-auto" : "overflow-x-hidden",
      )}
      data-panes-root
    >
      <PaneNode
        node={arrangement.root}
        focused={arrangement.focused}
        hostPaneId={hostPaneId}
        maximized={maximized}
        atTop
        atLeft={panelMaximized}
        atRight
      />
    </div>
  );
}

function PaneNode({
  node,
  focused,
  hostPaneId,
  maximized,
  atTop,
  atLeft,
  atRight,
}: {
  node: SplitNode;
  focused: string;
  hostPaneId: string | null;
  /** The pane filling the panel, if one does; the others stay mounted beneath it. */
  maximized: string | null;
  /** Whether the node's top, left or right edge is the window's title bar's. */
  atTop: boolean;
  atLeft: boolean;
  atRight: boolean;
}) {
  if (node.type === "leaf") {
    return (
      <PaneView
        leaf={node}
        focused={node.id === focused}
        hosting={node.id === hostPaneId}
        maximized={maximized === null ? null : maximized === node.id}
        atTop={maximized === node.id || atTop}
        atLeft={atLeft}
        atRight={maximized === node.id || atRight}
        minWidth={paneMinimum()}
      />
    );
  }
  return (
    // Each pane and split holds its minimum width and no more: left to their content, a strip
    // of tabs (which scrolls) would count at its full width and push the panes past the panel.
    <div
      className={
        node.direction === "column"
          ? "flex min-h-0 min-w-0 flex-1 flex-col"
          : "flex min-h-0 min-w-0 flex-1"
      }
      style={{ minWidth: minWidthPx(node, paneMinimum) }}
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          <div
            className="flex min-h-0"
            style={{
              flex: `${node.weights[index] ?? 1} 1 0px`,
              minWidth: minWidthPx(child, paneMinimum),
            }}
          >
            <PaneNode
              node={child}
              focused={focused}
              hostPaneId={hostPaneId}
              maximized={maximized}
              atTop={atTop && (node.direction === "row" || index === 0)}
              atLeft={atLeft && (node.direction === "column" || index === 0)}
              atRight={
                atRight && (node.direction === "column" || index === node.children.length - 1)
              }
            />
          </div>
          {index < node.children.length - 1 ? (
            <Divider
              branchId={node.id}
              direction={node.direction}
              weights={node.weights}
              resize={(start, delta, extent) =>
                node.direction === "row"
                  ? resizeTiled(
                      start,
                      index,
                      delta,
                      extent,
                      minWidthPx(node.children[index] ?? node, paneMinimum),
                      minWidthPx(node.children[index + 1] ?? node, paneMinimum),
                    )
                  : resizeTiled(start, index, delta, extent)
              }
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The line between two panes, after Obsidian's: 1px, with a 3px handle that takes the accent
 * colour while hovered or dragged. Dragging captures the pointer and turns the drag into the
 * branch's new weights.
 */
function Divider({
  branchId,
  direction,
  weights,
  resize,
}: {
  branchId: string;
  direction: Direction;
  weights: readonly number[];
  resize: (start: readonly number[], deltaPx: number, extentPx: number) => readonly number[];
}) {
  const { controller } = usePanesHost();
  const drag = useRef<{ start: readonly number[]; origin: number; extent: number } | null>(null);
  const [active, setActive] = useState(false);
  const along = (event: PointerEvent) => (direction === "row" ? event.clientX : event.clientY);
  const end = () => {
    drag.current = null;
    setActive(false);
  };
  const row = direction === "row";
  return (
    <div className={row ? "relative w-px shrink-0 bg-border" : "relative h-px shrink-0 bg-border"}>
      <div
        role="separator"
        aria-orientation={row ? "vertical" : "horizontal"}
        data-active={active || undefined}
        className={
          row
            ? "absolute inset-y-0 -left-px z-10 w-[3px] cursor-col-resize touch-none transition-colors hover:bg-primary data-active:bg-primary"
            : "absolute inset-x-0 -top-px z-10 h-[3px] cursor-row-resize touch-none transition-colors hover:bg-primary data-active:bg-primary"
        }
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const branch = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            start: weights,
            origin: along(event),
            extent: branch ? (row ? branch.width : branch.height) : 0,
          };
          setActive(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          const next = resize(start.start, along(event) - start.origin, start.extent);
          controller.update((arrangement) => resizePanes(arrangement, branchId, next));
        }}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  );
}

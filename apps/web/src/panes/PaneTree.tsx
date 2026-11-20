import { Fragment, useContext, useEffect, useRef, useState, type PointerEvent } from "react";

import { BackgroundThreadContext } from "../components/chat/backgroundThread";
import { useClientSettings } from "../hooks/useSettings";
import { observeResize } from "../lib/observeResize";
import { cn } from "../lib/utils";
import { resizePanes } from "./arrangement";
import { useMaximizedPaneId, useMaximizedPaneStore } from "./maximize";
import { panesSlot, type PanesPanel } from "../whichKey/handles";
import { usePanesHost, usePanesLayoutKey, type PaneArrangementSnapshot } from "./panesHost";
import { PaneView } from "./PaneView";
import { setPaneOpenBeside, setPanesWidthPx } from "./placement";
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
 * and its top-left strip clears a collapsed sidebar's controls. `panel` is the thread's right
 * panel holding the panes, for the keyboard menu's full screen.
 */
export function PaneTree({
  snapshot,
  panelMaximized,
  panel,
}: {
  snapshot: PaneArrangementSnapshot;
  panelMaximized: boolean;
  panel?: PanesPanel;
}) {
  const { arrangement } = snapshot;
  const maximizedId = useMaximizedPaneId();
  // The keyboard menu and the ex line act on the panes on screen (see `panesSlot`).
  const { controller, tabs } = usePanesHost();
  const layoutKey = usePanesLayoutKey();
  const root = useRef<HTMLDivElement>(null);
  // Not while the thread sits inert under Settings or Usage.
  const background = useContext(BackgroundThreadContext);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this pane tree with the keyboard menu's panes slot while it is in front
  useEffect(() => {
    if (background) return;
    return panesSlot.register({
      controller,
      tabs,
      layoutKey,
      element: () => root.current,
      ...(panel ? { panel } : {}),
    });
  }, [background, controller, layoutKey, panel, tabs]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the panes for the placement rule, which runs outside React
  useEffect(() => {
    const element = root.current;
    if (background || !element) return;
    // The last width stays while the panes are away (Settings), for placements still pending.
    return observeResize(element, () => setPanesWidthPx(element.clientWidth));
  }, [background]);
  const openBeside = useClientSettings((settings) => settings.paneOpenBeside);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the setting to the placement rule, which runs outside React
  useEffect(() => setPaneOpenBeside(openBeside), [openBeside]);
  // Maximizing ends once the pane is gone or the last one left, so a later split shows every
  // pane rather than maximizing again.
  const maximized =
    maximizedId !== null &&
    findLeaf(arrangement.root, maximizedId) &&
    leaves(arrangement.root).length > 1
      ? maximizedId
      : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the maximized-pane store once the maximized pane is gone or the last one left
  useEffect(() => {
    if (maximizedId !== null && maximized === null) useMaximizedPaneStore.getState().restore();
  }, [maximized, maximizedId]);
  return (
    <div
      ref={root}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 overflow-y-hidden",
        maximized === null ? "overflow-x-auto" : "overflow-x-hidden",
      )}
      data-panes-root
    >
      <PaneNode
        node={arrangement.root}
        focused={arrangement.focused}
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
  maximized,
  atTop,
  atLeft,
  atRight,
}: {
  node: SplitNode;
  focused: string;
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
        maximized={maximized === null ? null : maximized === node.id}
        // A pane beneath a maximized one holds no title bar, nor any drag regions over its strip.
        atTop={maximized === null ? atTop : maximized === node.id}
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
              maximized={maximized}
              atTop={atTop && (node.direction === "row" || index === 0)}
              // A maximized pane starts at the panel's left edge, wherever it sits in the tree.
              atLeft={atLeft && (maximized !== null || node.direction === "column" || index === 0)}
              atRight={
                atRight && (node.direction === "column" || index === node.children.length - 1)
              }
            />
          </div>
          {index < node.children.length - 1 ? (
            <Divider
              index={index}
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
 * colour while hovered, dragged or focused. Dragging captures the pointer and turns the drag into
 * the branch's new weights; focused, the arrow keys along it move it by a twentieth.
 */
function Divider({
  index,
  branchId,
  direction,
  weights,
  resize,
}: {
  index: number;
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
  const extentOf = (element: Element) => {
    const branch = element.parentElement?.parentElement?.getBoundingClientRect();
    return branch ? (row ? branch.width : branch.height) : 0;
  };
  // Its place between the two panes it divides, as their first one's share of them.
  const pair = (weights[index] ?? 0) + (weights[index + 1] ?? 0) || 1;
  return (
    <div className={row ? "relative w-px shrink-0 bg-border" : "relative h-px shrink-0 bg-border"}>
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize panes"
        aria-orientation={row ? "vertical" : "horizontal"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(((weights[index] ?? 0) / pair) * 100)}
        data-active={active || undefined}
        className={
          row
            ? "absolute inset-y-0 -left-px z-10 w-[3px] cursor-col-resize touch-none outline-none transition-colors hover:bg-primary focus-visible:bg-primary data-active:bg-primary"
            : "absolute inset-x-0 -top-px z-10 h-[3px] cursor-row-resize touch-none outline-none transition-colors hover:bg-primary focus-visible:bg-primary data-active:bg-primary"
        }
        onKeyDown={(event) => {
          const back = row ? "ArrowLeft" : "ArrowUp";
          const forward = row ? "ArrowRight" : "ArrowDown";
          if (event.key !== back && event.key !== forward) return;
          event.preventDefault();
          const extent = extentOf(event.currentTarget);
          const step = (event.key === forward ? 1 : -1) * extent * 0.05;
          const next = resize(weights, step, extent);
          controller.update((arrangement) => resizePanes(arrangement, branchId, next));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            start: weights,
            origin: along(event),
            extent: extentOf(event.currentTarget),
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

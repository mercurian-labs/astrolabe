import type { ContextMenuItem } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Columns2, Maximize2, Minimize2, MoreHorizontal, Rows2, SquareX } from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import { observeResize } from "~/lib/observeResize";
import { cn, isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import {
  activateTab,
  focusPane,
  isEmptyTab,
  moveTabs,
  splitTab,
  splitTabs,
  splitWithTabs,
  tabsToClose,
} from "./arrangement";
import {
  currentDrag,
  endDrag,
  insertIndex,
  insertionLineX,
  paneDropZone,
  startDrag,
  useDragging,
  type DropZone,
} from "./drag";
import {
  canClosePane,
  canSplitPane,
  closePane,
  splitPane,
  toggleMaximizedPane,
} from "./paneCommands";
import {
  usePanesHost,
  usePanesLayoutKey,
  type PaneArrangementStore,
  type PaneTabs,
} from "./panesHost";
import {
  NO_TAB_SELECTION,
  anchorAt,
  selectRange,
  tabsActedOn,
  toggleTab,
  useTabSelectionStore,
} from "./tabSelection";
import { TabCloseButton, TabTitle } from "./TabParts";
import { findLeaf, leaves, type Leaf } from "./tree";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

/**
 * The right-click menu for a selection of tabs: closing them, and moving them together into a
 * new pane beside their own. Either ends the selection.
 */
async function showSelectionMenu(
  api: NonNullable<ReturnType<typeof readLocalApi>>,
  controller: PaneArrangementStore,
  tabs: PaneTabs,
  keys: readonly string[],
  position: { x: number; y: number },
) {
  type Action = "close" | "split-right" | "split-down";
  const items: ContextMenuItem<Action>[] = [
    { id: "close", label: `Close (${keys.length})` },
    { id: "split-right", label: `Split right (${keys.length})` },
    { id: "split-down", label: `Split down (${keys.length})` },
  ];
  const action = await api.contextMenu.show(items, position);
  if (action === null || action === undefined) return;
  useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
  if (action === "close") {
    for (const key of keys) tabs.close(key);
    return;
  }
  controller.update((arrangement) =>
    splitTabs(arrangement, keys, action === "split-right" ? "right" : "bottom"),
  );
}

const TabPill = memo(function TabPill({
  tabKey,
  paneId,
  active,
  paneFocused,
  only,
  last,
  draggableInTitlebar,
}: {
  tabKey: string;
  paneId: string;
  active: boolean;
  paneFocused: boolean;
  /** Whether this is its pane's only tab. */
  only: boolean;
  /** Whether no tab follows it in the strip. */
  last: boolean;
  /** Whether its strip is part of the window's title bar, which drags the window. */
  draggableInTitlebar: boolean;
}) {
  const { controller, tabs } = usePanesHost();
  const { title, icon } = tabs.useLabel(tabKey);
  const navigate = useNavigate();
  const dragging = useDragging(tabKey);
  // A lone pane's lone empty tab is what an empty panel shows; there is nothing to close.
  const closable = !(only && isEmptyTab(tabKey));
  const activate = () => controller.update((arrangement) => activateTab(arrangement, tabKey));
  const selected = useTabSelectionStore(
    (store) => store.selection.paneId === paneId && store.selection.keys.includes(tabKey),
  );
  const changeSelection = useTabSelectionStore((store) => store.change);
  /** This tab's pane as it stands now, for ranges and for what an action covers. */
  const currentLeaf = () => {
    const snapshot = controller.getSnapshot();
    return snapshot ? findLeaf(snapshot.arrangement.root, paneId) : undefined;
  };
  const actedOn = () => {
    const leaf = currentLeaf();
    return leaf ? tabsActedOn(useTabSelectionStore.getState().selection, leaf, tabKey) : [tabKey];
  };
  // As the sidebar's threads: ⌘/Ctrl-click toggles, Shift-click selects a range, a plain click
  // opens the tab and anchors the next range there.
  const select = (event: MouseEvent) => {
    const toggling = isMacPlatform(navigator.platform) ? event.metaKey : event.ctrlKey;
    const leaf = currentLeaf();
    if (toggling) {
      changeSelection((selection) => toggleTab(selection, paneId, tabKey));
      return;
    }
    if (event.shiftKey && leaf) {
      changeSelection((selection) => selectRange(selection, leaf, tabKey));
      return;
    }
    changeSelection(() => anchorAt(paneId, tabKey));
    activate();
  };

  const showContextMenu = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api) return;
    const keys = actedOn();
    if (keys.length > 1) {
      await showSelectionMenu(api, controller, tabs, keys, { x: event.clientX, y: event.clientY });
      return;
    }
    type Action =
      | "open-elsewhere"
      | "close"
      | "close-others"
      | "close-to-right"
      | "split-right"
      | "split-down";
    // Astrolabe: a tab outside its own section opens in it.
    const elsewhere = tabs.openElsewhere?.(tabKey) ?? null;
    const items: ContextMenuItem<Action>[] = [
      ...(elsewhere ? [{ id: "open-elsewhere" as const, label: elsewhere.label }] : []),
      { id: "close", label: "Close", disabled: !closable },
      { id: "close-others", label: "Close others", disabled: only },
      { id: "close-to-right", label: "Close tabs to the right", disabled: last },
      // A pane's only tab stays: splitting it off would leave its pane empty.
      { id: "split-right", label: "Split right", disabled: only },
      { id: "split-down", label: "Split down", disabled: only },
    ];
    const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    const snapshot = controller.getSnapshot();
    switch (action) {
      case "open-elsewhere":
        elsewhere?.run(navigate);
        break;
      case "close":
        tabs.close(tabKey);
        break;
      case "close-others":
      case "close-to-right":
        if (!snapshot) break;
        for (const key of tabsToClose(
          snapshot.arrangement,
          tabKey,
          action === "close-others" ? "others" : "after",
        )) {
          tabs.close(key);
        }
        break;
      case "split-right":
      case "split-down":
        controller.update((arrangement) =>
          splitTab(arrangement, tabKey, action === "split-right" ? "right" : "bottom"),
        );
        break;
      default:
        break;
    }
  };

  return (
    <div
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={title}
      draggable
      data-pane-tab
      data-key={tabKey}
      className={cn(
        // Astrolabe: Chrome's tabs. 240px wide, and short of room they shrink together to 96px,
        // then the strip scrolls. The tab in front, outlined as Obsidian's, joins the pane below
        // from the others' top to the strip's foot (its curved feet and the rules between tabs
        // are `index.css`'s); the others are bare until hovered.
        "group/tab relative flex w-60 min-w-24 shrink cursor-pointer items-center gap-1.5 border border-transparent ps-2.25 pe-1.5 text-xs font-medium transition-colors duration-75 outline-none select-none focus-visible:inset-ring focus-visible:inset-ring-ring focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/24",
        draggableInTitlebar && "[-webkit-app-region:no-drag]",
        active
          ? cn(
              "z-10 mt-1.5 self-stretch rounded-t-md border-border border-b-0 bg-(--tab-join)",
              paneFocused ? "text-foreground" : "text-muted-foreground",
            )
          : selected
            ? "h-7 rounded-md border-primary/45 bg-primary/14 text-foreground"
            : "h-7 rounded-md text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
        dragging && "opacity-50",
      )}
      data-selected={selected || undefined}
      onClick={select}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
      onMouseDown={(event) => {
        // Middle-click closes; keep the browser from starting its autoscroll.
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1 && closable) tabs.close(tabKey);
      }}
      onContextMenu={(event) => void showContextMenu(event)}
      onDragStart={(event) => {
        const keys = actedOn();
        startDrag(event, { key: tabKey, keys }, title);
      }}
      onDragEnd={endDrag}
    >
      <span
        data-tab-icon
        className={cn(
          "flex size-4 shrink-0 items-center justify-center",
          active ? "opacity-100" : "opacity-85 group-hover/tab:opacity-100",
        )}
      >
        {icon}
      </span>
      <TabTitle title={title} />
      {closable ? (
        <TabCloseButton
          label={`Close ${title}`}
          onClick={(event) => {
            event.stopPropagation();
            tabs.close(tabKey);
          }}
        />
      ) : null}
    </div>
  );
});

/** Keeps this much of the neighbouring tabs in view when scrolling the active tab into view. */
const SCROLL_MARGIN = 6;

/** Scrolls a strip the least that shows `pill` whole; a pill already whole stays put. */
function scrollIntoStrip(strip: HTMLElement, pill: HTMLElement | undefined) {
  if (!pill) return;
  const box = strip.getBoundingClientRect();
  const rect = pill.getBoundingClientRect();
  const left = rect.left - box.left - strip.clientLeft + strip.scrollLeft;
  const start = left - SCROLL_MARGIN;
  const end = left + rect.width + SCROLL_MARGIN;
  if (start < strip.scrollLeft) strip.scrollLeft = start;
  else if (end > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = end - strip.clientWidth;
}

/**
 * A pane's strip of tabs. A strip along the panel's top is part of the window's title bar: it
 * drags the window on desktop, the top-right one leaves room for the panel controls ChatView
 * pins there and the window's own controls, and with the panel maximized the top-left one clears
 * a collapsed sidebar's controls.
 */
function TabStrip({
  leaf,
  focused,
  maximized,
  atTop,
  atLeft,
  atRight,
}: {
  leaf: Leaf;
  focused: boolean;
  maximized: boolean;
  atTop: boolean;
  atLeft: boolean;
  atRight: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const titlebar = isElectron && atTop;
  const { active } = leaf;
  const { controller, tabs } = usePanesHost();
  const NewTab = tabs.NewTab;
  // A lone pane already fills the panel: there is nothing to maximize it over.
  const alone = useSyncExternalStore(controller.subscribe, () => {
    const snapshot = controller.getSnapshot();
    return snapshot === null || leaves(snapshot.arrangement.root).length === 1;
  });
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const show = () =>
      scrollIntoStrip(
        element,
        [...element.querySelectorAll<HTMLElement>(":scope > [data-pane-tab]")].find(
          (pill) => pill.dataset.key === active,
        ),
      );
    show();
    return observeResize(element, show);
  }, [active]);

  return (
    <div
      data-pane-strip
      className={cn(
        "relative flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1.5 border-b border-border bg-muted px-2 [--tab-join:var(--background)]",
        titlebar && "drag-region",
        atTop && atRight && tabs.reservesTopRight && "pe-20",
        titlebar && atRight && "wco:pe-(--workspace-native-controls-inset)",
        atTop && atLeft && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
    >
      <div
        ref={strip}
        role="tablist"
        aria-orientation="horizontal"
        aria-multiselectable
        data-pane-tabs
        // Past the strip's padding on each side, so the joined tab's curved feet and a tab's
        // focus ring stay whole; down over the strip's bottom border, which the joined tab covers.
        className="-mx-2 -mb-px flex min-w-0 items-center gap-1 self-stretch overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(event) => {
          // A vertical wheel scrolls the tabs sideways.
          if (event.deltaX === 0 && event.deltaY !== 0) {
            event.currentTarget.scrollLeft += event.deltaY;
          }
        }}
      >
        {leaf.tabs.map((key, index) => (
          <TabPill
            key={key}
            tabKey={key}
            paneId={leaf.id}
            active={key === active}
            paneFocused={focused}
            only={leaf.tabs.length === 1}
            last={index === leaf.tabs.length - 1}
            draggableInTitlebar={titlebar}
          />
        ))}
      </div>
      <NewTab paneId={leaf.id} />
      {alone ? null : <MaximizeButton paneId={leaf.id} maximized={maximized} />}
      <PaneMenu leaf={leaf} alone={alone} />
    </div>
  );
}

/**
 * Fills the panel with the pane, or puts the other panes back while it does. Shown only beside
 * other panes: a lone pane already fills the panel.
 */
function MaximizeButton({ paneId, maximized }: { paneId: string; maximized: boolean }) {
  const { controller } = usePanesHost();
  const layoutKey = usePanesLayoutKey();
  const label = maximized ? "Restore pane" : "Maximize pane";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="ms-auto shrink-0"
            size="icon-sm"
            variant="ghost-muted"
            onClick={() => toggleMaximizedPane(controller, layoutKey, paneId)}
          />
        }
      >
        {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The pane's own menu, ending its strip as Obsidian's pane header ends with one: what acts on
 * the whole pane. Moving the tab in front into a new pane beside it (a pane's only tab stays, as
 * splitting would leave the pane empty), and closing it. What acts on one tab stays on the tab.
 */
function PaneMenu({ leaf, alone }: { leaf: Leaf; alone: boolean }) {
  const { controller, tabs } = usePanesHost();
  const split = (side: "right" | "bottom") => splitPane(controller, leaf, side);
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label="Pane actions"
            className={cn("shrink-0", alone && "ms-auto")}
            size="icon-sm"
            variant="ghost-muted"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" sideOffset={6}>
        <MenuItem disabled={!canSplitPane(leaf)} onClick={() => split("right")}>
          <Columns2 />
          Split right
        </MenuItem>
        <MenuItem disabled={!canSplitPane(leaf)} onClick={() => split("bottom")}>
          <Rows2 />
          Split down
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!canClosePane(leaf, alone)} onClick={() => closePane(tabs, leaf)}>
          <SquareX />
          Close pane
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

interface DropTarget {
  readonly zone: DropZone;
  /** Where a tab joining this pane's strip goes. */
  readonly index: number;
  /** The highlighted region, or the insertion line joining the strip, in pixels within the pane. */
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.zone === b.zone &&
      a.index === b.index &&
      a.top === b.top &&
      a.left === b.left &&
      a.width === b.width &&
      a.height === b.height)
  );
}

/**
 * Where tabs (`keys`) dragged over `pane` at (clientX, clientY) would land: over the strip they
 * join the pane's tabs at the insertion line, over the content they divide the pane on the
 * nearest half. Null for every tab of a pane over its own pane.
 */
function dropTargetAt(
  pane: HTMLElement,
  leaf: Leaf,
  keys: readonly string[],
  clientX: number,
  clientY: number,
): DropTarget | null {
  // Every tab of a pane dragged over that pane has nowhere to go.
  if (leaf.tabs.every((key) => keys.includes(key))) return null;
  const rect = pane.getBoundingClientRect();
  const stripSize = pane.querySelector("[data-pane-strip]")?.getBoundingClientRect().height ?? 0;
  const zone = paneDropZone(
    clientX - rect.left,
    clientY - rect.top,
    rect.width,
    rect.height,
    stripSize,
  );
  if (zone === "center") return stripTargetAt(pane, rect, clientX);
  const halfWidth = Math.round(rect.width / 2);
  const content = rect.height - stripSize;
  const halfHeight = Math.round(content / 2);
  return {
    zone,
    index: leaf.tabs.length,
    top: zone === "bottom" ? stripSize + halfHeight : stripSize,
    left: zone === "right" ? halfWidth : 0,
    width: zone === "left" || zone === "right" ? halfWidth : rect.width,
    height: zone === "top" || zone === "bottom" ? halfHeight : content,
  };
}

/**
 * Joining the strip: the index among its tabs, and the insertion line in the gap before it, as
 * tall as a rule between tabs and centred on the strip.
 */
function stripTargetAt(pane: HTMLElement, rect: DOMRect, clientX: number): DropTarget | null {
  const list = pane.querySelector<HTMLElement>("[data-pane-tabs]");
  if (!list) return null;
  const listRect = list.getBoundingClientRect();
  const tabs = [...list.querySelectorAll(":scope > [data-pane-tab]")].map((tab) =>
    tab.getBoundingClientRect(),
  );
  const index = insertIndex(
    tabs.map((box) => box.left + box.width / 2),
    clientX,
  );
  const gap = Number.parseFloat(getComputedStyle(list).gap) || 0;
  const at = insertionLineX(tabs, index, gap, listRect.left + gap);
  return {
    zone: "center",
    index,
    top: Math.round(listRect.top + (listRect.height - INSERTION_LINE_HEIGHT) / 2 - rect.top),
    left: Math.round(at - rect.left - 1),
    width: 2,
    height: INSERTION_LINE_HEIGHT,
  };
}

/** The insertion line's height, a little over a rule's between tabs (`index.css`). */
const INSERTION_LINE_HEIGHT = 20;

/** Covers the pane's content with what the overlay draws; collapses when it draws nothing. */
function PaneOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col overflow-auto bg-background empty:hidden">
      {children}
    </div>
  );
}

/**
 * One pane: its strip of tabs across the top and its active tab's content beneath. Tab contents
 * render once into containers that move into the pane showing them (see `PaneTabs.place`),
 * so a tab moving between panes never remounts what it shows. Dragging a tab over the pane shows where it
 * would land (see `dropTargetAt`).
 */
export const PaneView = memo(function PaneView({
  leaf,
  focused,
  hosting,
  maximized,
  atTop,
  atLeft,
  atRight,
  minWidth,
}: {
  leaf: Leaf;
  focused: boolean;
  /** Whether this pane holds content that renders in one place only (see `PaneArrangementSnapshot`). */
  hosting: boolean;
  /**
   * Whether this pane fills the panel (true), or another does and this one waits, mounted,
   * beneath it (false); null when every pane shows.
   */
  maximized: boolean | null;
  /** Whether the pane's top, left or right edge is the window's title bar's. */
  atTop: boolean;
  atLeft: boolean;
  atRight: boolean;
  minWidth: number;
}) {
  const { controller, tabs } = usePanesHost();
  const Overlay = tabs.Overlay;
  const slot = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);

  useLayoutEffect(() => {
    if (slot.current) tabs.place(slot.current, leaf, hosting);
  }, [tabs, leaf, hosting]);

  // A drag that ends anywhere else, or is cancelled, clears the highlight.
  const dragging = target !== null;
  useEffect(() => {
    if (!dragging) return;
    const clear = () => setTarget(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [dragging]);

  // The active surface renders through a portal, so React's drag events from it follow the
  // React tree and never reach this pane. Native listeners see the drag where it happens in the
  // DOM, and capturing it here keeps a dragged tab from reaching a surface's own drop handling.
  const section = useRef<HTMLElement>(null);
  const latest = useRef({ leaf, target, focused });
  useLayoutEffect(() => {
    latest.current = { leaf, target, focused };
  });
  // Pressing or focusing anything in the pane focuses it. Native listeners for the same reason
  // as the drag's: content portaled into the pane sends React's events elsewhere.
  useEffect(() => {
    const pane = section.current;
    if (!pane) return;
    const take = () => {
      const { focused: isFocused, leaf: current } = latest.current;
      if (!isFocused) controller.update((arrangement) => focusPane(arrangement, current.id));
    };
    pane.addEventListener("pointerdown", take, true);
    pane.addEventListener("focusin", take, true);
    return () => {
      pane.removeEventListener("pointerdown", take, true);
      pane.removeEventListener("focusin", take, true);
    };
  }, [controller]);
  useEffect(() => {
    const pane = section.current;
    if (!pane) return;
    const onDragEnter = (event: globalThis.DragEvent) => {
      if (currentDrag()) event.stopPropagation();
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      const item = currentDrag();
      if (!item) return;
      event.stopPropagation();
      const next = dropTargetAt(pane, latest.current.leaf, item.keys, event.clientX, event.clientY);
      if (!next) {
        if (latest.current.target) setTarget(null);
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      if (!sameTarget(latest.current.target, next)) setTarget(next);
    };
    const onDragLeave = (event: globalThis.DragEvent) => {
      if (!pane.contains(event.relatedTarget as Node | null)) setTarget(null);
    };
    const onDrop = (event: globalThis.DragEvent) => {
      const item = currentDrag();
      if (!item) return;
      event.stopPropagation();
      const { leaf: current } = latest.current;
      const drop = dropTargetAt(pane, current, item.keys, event.clientX, event.clientY);
      setTarget(null);
      if (!drop) return;
      event.preventDefault();
      endDrag();
      // Astrolabe: a sidebar's rows open where they land.
      if (item.place) {
        item.place(current.id, {
          side: drop.zone === "center" ? null : drop.zone,
          index: drop.index,
        });
        return;
      }
      controller.update((arrangement) =>
        drop.zone === "center"
          ? moveTabs(arrangement, item.keys, current.id, drop.index, item.key)
          : splitWithTabs(arrangement, item.keys, current.id, drop.zone, item.key),
      );
      // The tabs moved together; their selection ends with the move.
      useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
    };
    pane.addEventListener("dragenter", onDragEnter, true);
    pane.addEventListener("dragover", onDragOver, true);
    pane.addEventListener("dragleave", onDragLeave);
    pane.addEventListener("drop", onDrop, true);
    return () => {
      pane.removeEventListener("dragenter", onDragEnter, true);
      pane.removeEventListener("dragover", onDragOver, true);
      pane.removeEventListener("dragleave", onDragLeave);
      pane.removeEventListener("drop", onDrop, true);
    };
  }, [controller]);

  return (
    <section
      ref={section}
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        maximized ? "absolute inset-0 z-30" : "relative",
      )}
      style={maximized ? undefined : { minWidth }}
      inert={maximized === false}
      data-pane-id={leaf.id}
      data-focused={focused || undefined}
    >
      <TabStrip
        leaf={leaf}
        focused={focused}
        maximized={maximized === true}
        atTop={atTop}
        atLeft={atLeft}
        atRight={atRight}
      />
      {/* Layout containment keeps a surface's fixed-position controls inside the pane. */}
      <div className="relative min-h-0 flex-1 [contain:layout_paint]">
        <div ref={slot} className="absolute inset-0" />
        <PaneOverlay>
          <Overlay leaf={leaf} hosting={hosting} />
        </PaneOverlay>
      </div>
      {target ? (
        <div
          className={cn(
            "pointer-events-none absolute z-50",
            target.zone === "center"
              ? "rounded-xs bg-primary"
              : "p-0.75 transition-[top,left,width,height] duration-100 ease-in-out",
          )}
          style={{ top: target.top, left: target.left, width: target.width, height: target.height }}
        >
          {target.zone === "center" ? null : <div className="size-full rounded-md bg-primary/50" />}
        </div>
      ) : null}
    </section>
  );
});

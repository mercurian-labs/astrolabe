import type { ContextMenuItem } from "@t3tools/contracts";
import {
  Files,
  FileDiff,
  Globe2,
  MessageSquareText,
  Plus,
  Smartphone,
  SquareDashed,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
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

import { useBrowserDefaults } from "~/browser/browserDefaults";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import {
  SurfaceIcon,
  surfaceShortcutActionForKey,
  surfaceTitle,
} from "~/components/RightPanelTabs";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { PanelTabCloseButton } from "~/components/ui/panel-tab-close-button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "~/rightPanelStore";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import {
  CONVERSATION,
  activateTab,
  closeTab,
  focusPane,
  isEmptyTab,
  moveTab,
  openTab,
  splitTab,
  splitWithTab,
  surfaceIdOf,
  surfaceKey,
  tabsToClose,
} from "./arrangement";
import { currentDrag, endDrag, insertIndex, paneDropZone, startDrag, type DropZone } from "./drag";
import type { PanelProps, PanesController } from "./panesController";
import { usePanesHost, usePanesThreadRef } from "./PaneSurfaceHost";
import type { Leaf } from "./tree";

/** Re-renders when what the strip draws from ChatView's panel props changes. */
function usePanel(controller: PanesController): PanelProps | null {
  return useSyncExternalStore(controller.subscribePanel, controller.getPanelSnapshot);
}

function useSurface(surfaceId: string | null) {
  const ref = usePanesThreadRef();
  return useRightPanelStore((state) =>
    surfaceId === null || ref === null
      ? null
      : (selectThreadRightPanelState(state.byThreadKey, ref).surfaces.find(
          (surface) => surface.id === surfaceId,
        ) ?? null),
  );
}

/** A tab's title and icon: the conversation, an empty tab, or one of T3 Code's surfaces. */
function useTabLabel(tabKey: string): { title: string; icon: ReactNode } {
  const { controller } = usePanesHost();
  const panel = usePanel(controller);
  const surface = useSurface(surfaceIdOf(tabKey));
  const { resolvedTheme } = useTheme();
  if (tabKey === CONVERSATION) {
    return { title: "Conversation", icon: <MessageSquareText className="size-3 shrink-0" /> };
  }
  if (!surface) return { title: "New tab", icon: <SquareDashed className="size-3 shrink-0" /> };
  return {
    title: surfaceTitle(
      surface,
      panel?.previewSessions ?? {},
      panel?.terminalLabelsById ?? new Map(),
    ),
    icon: (
      <SurfaceIcon
        surface={surface}
        sessions={panel?.previewSessions ?? {}}
        desktopByTabId={panel?.desktopByTabId ?? {}}
        theme={resolvedTheme}
        environmentId={panel?.environmentId ?? null}
        pullRequestStatusSeeds={panel?.pullRequestStatusSeeds}
      />
    ),
  };
}

/** Closes a tab: a surface through ChatView's own close, which may ask first. */
function closeTabOf(controller: PanesController, tabKey: string) {
  const surfaceId = surfaceIdOf(tabKey);
  const ref = controller.threadRef();
  if (surfaceId === null || ref === null) {
    controller.update((arrangement) => closeTab(arrangement, tabKey));
    return;
  }
  const surface = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    ref,
  ).surfaces.find((entry) => entry.id === surfaceId);
  if (!surface) {
    controller.update((arrangement) => closeTab(arrangement, tabKey));
    return;
  }
  const panel = controller.getPanel();
  if (panel) panel.onCloseSurface(surface);
  else useRightPanelStore.getState().closeSurface(ref, surface.id);
}

interface AddAction {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut: string;
  readonly available: boolean;
  /** The surface this opens when the record already holds it, which then moves here instead. */
  readonly singleton: RightPanelSurface["id"] | null;
  /** Adds the surface through ChatView, given its current panel props. */
  readonly invoke: (panel: PanelProps) => void;
}

/** The surfaces a pane can open, as ChatView offers them in its panel's New tab menu. */
function addActions(panel: PanelProps | null): AddAction[] {
  if (!panel) return [];
  return [
    {
      label: "Browser",
      icon: Globe2,
      shortcut: "B",
      available: panel.browserAvailable,
      singleton: null,
      invoke: (current) => current.onAddBrowser(),
    },
    {
      label: "Terminal",
      icon: TerminalSquare,
      shortcut: "T",
      available: panel.terminalAvailable,
      singleton: null,
      invoke: (current) => current.onAddTerminal(),
    },
    {
      label: "Files",
      icon: Files,
      shortcut: "F",
      available: panel.filesAvailable,
      singleton: "files",
      invoke: (current) => current.onAddFiles(),
    },
    {
      label: "Diff",
      icon: FileDiff,
      shortcut: "D",
      available: panel.diffAvailable,
      singleton: "diff",
      invoke: (current) => current.onAddDiff(),
    },
    {
      label: "Pull request",
      icon: PullRequestGlyph.pullRequest,
      shortcut: "P",
      available: panel.pullRequestAvailable,
      singleton: null,
      invoke: (current) => current.onAddPullRequest(),
    },
    {
      label: "Linked pull requests",
      icon: PullRequestGlyph.link,
      shortcut: "L",
      available: panel.pullRequestsAvailable,
      singleton: "pull-requests",
      invoke: (current) => current.onAddPullRequests(),
    },
    {
      label: "Device",
      icon: Smartphone,
      shortcut: "M",
      available: panel.deviceAvailable,
      singleton: null,
      invoke: (current) => current.onAddDevice(),
    },
  ];
}

/**
 * Opens a surface in a pane. One the record already holds moves here, as a view open in
 * another pane does; anything else is added through ChatView, and lands here when it arrives.
 */
function runAddAction(controller: PanesController, paneId: string, action: AddAction) {
  const ref = controller.threadRef();
  const held =
    action.singleton !== null && ref !== null
      ? selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces.some(
          (surface) => surface.id === action.singleton,
        )
      : false;
  if (held && action.singleton !== null) {
    const key = surfaceKey(action.singleton);
    controller.update((arrangement) => openTab(arrangement, key, paneId));
    return;
  }
  const panel = controller.getPanel();
  if (!panel) return;
  controller.targetPane(paneId);
  action.invoke(panel);
}

function NewTabMenu({ paneId }: { paneId: string }) {
  const { controller } = usePanesHost();
  const panel = usePanel(controller);
  const [open, setOpen] = useState(false);
  const profiles = useBrowserDefaults().profiles;
  const actions = addActions(panel);
  const ref = usePanesThreadRef();
  const hiddenCount = useRightPanelStore((state) => {
    if (!ref) return 0;
    const record = selectThreadRightPanelState(state.byThreadKey, ref);
    return record.isOpen ? 0 : record.surfaces.length;
  });
  const run = (action: AddAction) => {
    setOpen(false);
    runAddAction(controller, paneId, action);
  };
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button aria-label="New tab" className="shrink-0" size="icon-xs" variant="ghost-muted" />
        }
      >
        <Plus className="size-3.5" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        side="bottom"
        sideOffset={6}
        onKeyDownCapture={(event) => {
          const action = surfaceShortcutActionForKey(actions, event.nativeEvent);
          if (!action) return;
          event.preventDefault();
          event.stopPropagation();
          run(action);
        }}
      >
        {actions.map((action) => {
          const Icon = action.icon;
          if (action.label === "Browser" && action.available && profiles.length > 1) {
            return (
              <MenuSub key={action.label}>
                <MenuSubTrigger className="[&>svg:last-child]:ms-0" onClick={() => run(action)}>
                  <Icon />
                  {action.label}
                  <MenuShortcut>{action.shortcut}</MenuShortcut>
                </MenuSubTrigger>
                <MenuSubPopup className="max-w-56">
                  {profiles.map((profile) => (
                    <MenuItem
                      key={profile.id}
                      onClick={() => {
                        setOpen(false);
                        const current = controller.getPanel();
                        if (!current) return;
                        controller.targetPane(paneId);
                        current.onAddBrowserInProfile(profile.id);
                      }}
                    >
                      <span className="min-w-0 truncate">{profile.name}</span>
                    </MenuItem>
                  ))}
                </MenuSubPopup>
              </MenuSub>
            );
          }
          return (
            <MenuItem key={action.label} disabled={!action.available} onClick={() => run(action)}>
              <Icon />
              {action.label}
              <MenuShortcut>{action.shortcut}</MenuShortcut>
            </MenuItem>
          );
        })}
        {hiddenCount > 0 && ref ? (
          <>
            <MenuSeparator />
            <MenuItem
              onClick={() => {
                setOpen(false);
                useRightPanelStore.getState().show(ref);
              }}
            >
              Show hidden tabs ({hiddenCount})
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

const TabPill = memo(function TabPill({
  tabKey,
  active,
  paneFocused,
  only,
  last,
  draggableInTitlebar,
}: {
  tabKey: string;
  active: boolean;
  paneFocused: boolean;
  /** Whether this is its pane's only tab. */
  only: boolean;
  /** Whether no tab follows it in the strip. */
  last: boolean;
  draggableInTitlebar: boolean;
}) {
  const { controller } = usePanesHost();
  const { title, icon } = useTabLabel(tabKey);
  const [dragging, setDragging] = useState(false);
  const closable = tabKey !== CONVERSATION;
  const activate = () => controller.update((arrangement) => activateTab(arrangement, tabKey));

  const showContextMenu = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const api = readLocalApi();
    if (!api) return;
    type Action = "close" | "close-others" | "close-to-right" | "split-right" | "split-down";
    const items: ContextMenuItem<Action>[] = [
      { id: "close", label: "Close", disabled: !closable },
      { id: "close-others", label: "Close others", disabled: only },
      { id: "close-to-right", label: "Close tabs to the right", disabled: last },
      { id: "split-right", label: "Split right" },
      { id: "split-down", label: "Split down" },
    ];
    const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
    const snapshot = controller.getSnapshot();
    switch (action) {
      case "close":
        closeTabOf(controller, tabKey);
        break;
      case "close-others":
      case "close-to-right":
        if (!snapshot) break;
        for (const key of tabsToClose(
          snapshot.arrangement,
          tabKey,
          action === "close-others" ? "others" : "after",
        )) {
          closeTabOf(controller, key);
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
        "group/tab flex h-6 max-w-44 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-md pr-2 pl-1.5 text-xs select-none",
        draggableInTitlebar && "[-webkit-app-region:no-drag]",
        active
          ? paneFocused
            ? "bg-accent text-foreground"
            : "bg-accent/50 text-foreground/80"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        dragging && "opacity-50",
      )}
      onClick={activate}
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
        if (event.button === 1 && closable) closeTabOf(controller, tabKey);
      }}
      onContextMenu={(event) => void showContextMenu(event)}
      onDragStart={(event) => {
        startDrag(event, { key: tabKey }, title);
        // Restyle after the browser has taken its snapshot of the drag.
        setTimeout(() => setDragging(true));
      }}
      onDragEnd={() => {
        endDrag();
        setDragging(false);
      }}
    >
      {closable ? (
        <PanelTabCloseButton
          label={`Close ${title}`}
          onClick={() => closeTabOf(controller, tabKey)}
        >
          {icon}
        </PanelTabCloseButton>
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      )}
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 truncate">{title}</span>} />
        <TooltipPopup>{title}</TooltipPopup>
      </Tooltip>
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

function TabStrip({
  leaf,
  focused,
  atTop,
  atLeft,
  atRight,
}: {
  leaf: Leaf;
  focused: boolean;
  atTop: boolean;
  atLeft: boolean;
  atRight: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const titlebar = isElectron && atTop;
  const { active } = leaf;
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
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(show);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  return (
    <div
      data-pane-strip
      className={cn(
        "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 border-b border-border px-2",
        titlebar && "drag-region",
        titlebar && atRight && "wco:pr-(--workspace-native-controls-inset)",
        atTop && atLeft && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
    >
      <div
        ref={strip}
        role="tablist"
        aria-orientation="horizontal"
        data-pane-tabs
        className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
            active={key === active}
            paneFocused={focused}
            only={leaf.tabs.length === 1}
            last={index === leaf.tabs.length - 1}
            draggableInTitlebar={titlebar}
          />
        ))}
      </div>
      <NewTabMenu paneId={leaf.id} />
    </div>
  );
}

/** An empty tab: nothing yet, and the surfaces it can open in its place. */
function EmptyTab({ paneId }: { paneId: string }) {
  const { controller } = usePanesHost();
  const panel = usePanel(controller);
  const actions = addActions(panel).filter((action) => action.available);
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-56 flex-col gap-1">
        <div className="px-2.5 pb-2 text-sm font-medium text-foreground">Open a tab</div>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-(--control-radius) px-2.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => runAddAction(controller, paneId, action)}
            >
              <Icon className="size-4" />
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A surface's tab shown while another surface is the one T3 Code renders: T3 Code keeps one
 * surface live per thread, so this one waits for its pane to take focus.
 */
function WaitingSurface({ tabKey }: { tabKey: string }) {
  const { title, icon } = useTabLabel(tabKey);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      <span className="flex items-center gap-1.5 text-foreground [&_svg]:size-4">
        {icon}
        {title}
      </span>
      <span>Click to show</span>
    </div>
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
 * Where a tab dragged over `pane` at (clientX, clientY) would land: over the strip it joins the
 * pane's tabs at the insertion line, over the content it divides the pane on the nearest half.
 * Null while no tab is dragged, or for a pane's only tab over its own pane.
 */
function dropTargetAt(
  pane: HTMLElement,
  leaf: Leaf,
  clientX: number,
  clientY: number,
): DropTarget | null {
  const item = currentDrag();
  if (!item) return null;
  if (leaf.tabs.length === 1 && leaf.tabs[0] === item.key) return null;
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

/** Joining the strip: the index among its tabs, and the insertion line in the gap before it. */
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
  const before = tabs[index];
  const last = tabs.at(-1);
  const near = before ?? last;
  const at = before ? before.left - gap / 2 : last ? last.right + gap / 2 : listRect.left;
  return {
    zone: "center",
    index,
    top: Math.round((near?.top ?? listRect.top) - rect.top),
    left: Math.round(at - rect.left - 1),
    width: 2,
    height: Math.round(near?.height ?? listRect.height),
  };
}

/**
 * One pane: its strip of tabs across the top and its active tab's content beneath. The
 * conversation and the active surface render once each into containers that move into the pane
 * showing them (see `PanesHost`), so a tab moving between panes never remounts them. Dragging a
 * tab over the pane shows where it would land (see `dropTargetAt`).
 */
export const PaneView = memo(function PaneView({
  leaf,
  focused,
  hosting,
  atTop,
  atLeft,
  atRight,
  minWidth,
}: {
  leaf: Leaf;
  focused: boolean;
  /** Whether this pane shows the surface T3 Code renders. */
  hosting: boolean;
  atTop: boolean;
  atLeft: boolean;
  atRight: boolean;
  minWidth: number;
}) {
  const host = usePanesHost();
  const { controller } = host;
  const slot = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const holdsConversation = leaf.tabs.includes(CONVERSATION);
  const showsConversation = leaf.active === CONVERSATION;

  useLayoutEffect(() => {
    if (slot.current && holdsConversation)
      host.place("conversation", slot.current, showsConversation);
  }, [holdsConversation, host, showsConversation]);

  useLayoutEffect(() => {
    if (slot.current && hosting) host.place("surface", slot.current, true);
  }, [host, hosting]);

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

  // The conversation and the active surface render through portals, so React's drag events
  // from them follow the React tree and never reach this pane. Native listeners see the drag
  // where it happens in the DOM, and capturing it here keeps a dragged tab from reaching the
  // conversation's file drop.
  const section = useRef<HTMLElement>(null);
  const latest = useRef({ leaf, target });
  useLayoutEffect(() => {
    latest.current = { leaf, target };
  });
  useEffect(() => {
    const pane = section.current;
    if (!pane) return;
    const onDragEnter = (event: globalThis.DragEvent) => {
      if (currentDrag()) event.stopPropagation();
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!currentDrag()) return;
      event.stopPropagation();
      const next = dropTargetAt(pane, latest.current.leaf, event.clientX, event.clientY);
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
      const drop = dropTargetAt(pane, current, event.clientX, event.clientY);
      setTarget(null);
      if (!drop) return;
      event.preventDefault();
      endDrag();
      controller.update((arrangement) =>
        drop.zone === "center"
          ? moveTab(arrangement, item.key, current.id, drop.index)
          : splitWithTab(arrangement, item.key, current.id, drop.zone),
      );
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

  const surfaceId = surfaceIdOf(leaf.active);
  const content = isEmptyTab(leaf.active) ? (
    <EmptyTab paneId={leaf.id} />
  ) : surfaceId !== null && !hosting ? (
    <WaitingSurface tabKey={leaf.active} />
  ) : null;

  return (
    <section
      ref={section}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
      style={{ minWidth }}
      data-pane-id={leaf.id}
      data-focused={focused || undefined}
      onPointerDownCapture={() => {
        if (!focused) controller.update((arrangement) => focusPane(arrangement, leaf.id));
      }}
      onFocusCapture={() => {
        if (!focused) controller.update((arrangement) => focusPane(arrangement, leaf.id));
      }}
    >
      <TabStrip leaf={leaf} focused={focused} atTop={atTop} atLeft={atLeft} atRight={atRight} />
      {/* Layout containment keeps the thread view's fixed-position controls inside the pane. */}
      <div className="relative min-h-0 flex-1 [contain:layout_paint]">
        <div ref={slot} className="absolute inset-0" />
        {content ? (
          <div className="absolute inset-0 overflow-auto bg-background">{content}</div>
        ) : null}
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
          {target.zone === "center" ? null : <div className="size-full rounded-lg bg-primary/40" />}
        </div>
      ) : null}
    </section>
  );
});

import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import {
  Columns2,
  Files,
  FileDiff,
  Globe2,
  Maximize2,
  MessagesSquare,
  Minimize2,
  MoreHorizontal,
  Plus,
  Rows2,
  Smartphone,
  SquareDashed,
  SquareX,
  TerminalSquare,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { useBrowserDefaults } from "~/browser/browserDefaults";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import {
  RightPanelEmptyState,
  previewFaviconOf,
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
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { cn, isMacPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "~/rightPanelStore";
import {
  THREAD_CONTEXT_DROP_EVENT,
  threadContextDropTargetProps,
  useThreadContextDragGhost,
} from "~/components/chat/threadContextDrag";
import { useThreadShell, useThreadShells } from "~/state/entities";
import { useEnvironmentIdentities } from "~/state/environments";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { guestCandidates, useGuestWorkspaceRequest, workspaceNote } from "./guestWorkspace";
import {
  CONVERSATION,
  activateTab,
  addGuests,
  closeTab,
  dropGuests,
  focusPane,
  guestKey,
  guestThreadOf,
  guestThreads,
  isEmptyTab,
  moveTabs,
  openTab,
  splitTab,
  splitTabs,
  splitWithTabs,
  surfaceIdOf,
  surfaceKey,
  tabsToClose,
} from "./arrangement";
import {
  currentDrag,
  endDrag,
  insertIndex,
  paneDropZone,
  startDrag,
  useDragging,
  type DropZone,
} from "./drag";
import { useToggleMaximized } from "./maximize";
import type { PanelProps, PanesController } from "./panesController";
import { usePanesHost, usePanesThreadRef } from "./PaneSurfaceHost";
import {
  NO_TAB_SELECTION,
  anchorAt,
  selectRange,
  tabsActedOn,
  toggleTab,
  useTabSelectionStore,
} from "./tabSelection";
import { findLeaf, leaves, type Leaf } from "./tree";

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
function useTabLabel(tabKey: string): { title: string; icon: ReactNode; note?: string } {
  const { controller } = usePanesHost();
  const panel = usePanel(controller);
  const surface = useSurface(surfaceIdOf(tabKey));
  const { resolvedTheme } = useTheme();
  const guest = useGuestLabel(guestThreadOf(tabKey));
  if (tabKey === CONVERSATION) {
    return { title: "Main Thread", icon: <MessagesSquare className="size-3 shrink-0" /> };
  }
  if (guest) return guest;
  if (!surface) return { title: "New tab", icon: <SquareDashed className="size-3 shrink-0" /> };
  const favicon = previewFaviconOf(
    surface,
    panel?.previewSessions ?? {},
    panel?.desktopByTabId ?? {},
  );
  return {
    title: surfaceTitle(
      surface,
      panel?.previewSessions ?? {},
      panel?.terminalLabelsById ?? new Map(),
    ),
    icon: (
      <SurfaceIcon
        surface={surface}
        previewUrl={favicon.url}
        previewCapturedUrl={favicon.capturedUrl}
        theme={resolvedTheme}
        environmentId={panel?.environmentId ?? null}
        pullRequestStatusSeed={panel?.pullRequestStatusSeeds?.[surface.id]}
      />
    ),
  };
}

/**
 * A guest tab's label: its thread's title, and where it works when that differs from the host's
 * (see `workspaceNote`). Null for any other tab.
 */
function useGuestLabel(
  guest: string | null,
): { title: string; icon: ReactNode; note?: string } | null {
  const guestRef = useMemo(() => (guest === null ? null : parseScopedThreadKey(guest)), [guest]);
  const guestShell = useThreadShell(guestRef);
  const hostShell = useThreadShell(usePanesThreadRef());
  const machines = useEnvironmentIdentities();
  if (guest === null) return null;
  const note =
    guestShell && hostShell
      ? workspaceNote(
          guestShell,
          hostShell,
          machines.find((machine) => machine.environmentId === guestShell.environmentId)?.label ??
            null,
        )
      : null;
  return {
    // A thread not yet sent has no title of its own.
    title: guestShell?.title ?? "New thread",
    icon: <MessagesSquare className="size-3 shrink-0" />,
    ...(note ? { note } : {}),
  };
}

/** Closes a tab: a surface through ChatView's own close, which may ask first. */
export function closeTabOf(controller: PanesController, tabKey: string) {
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

/** How many threads a pane's New tab menu offers as guests. */
const GUEST_CANDIDATES = 12;

/**
 * "Thread" in a pane's New tab menu: another thread to open here as a guest, from those the
 * sidebar lists, most recently active first.
 */
function GuestThreadMenu({ onPick }: { onPick: (threadKey: string) => void }) {
  const { controller } = usePanesHost();
  const hostRef = usePanesThreadRef();
  const shells = useThreadShells();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const present = new Set([
    ...(hostRef ? [scopedThreadKey(hostRef)] : []),
    ...(snapshot ? guestThreads(snapshot.arrangement) : []),
  ]);
  const candidates = guestCandidates(
    shells.map((shell) => ({
      key: scopedThreadKey(scopeThreadRef(shell.environmentId, shell.id)),
      title: shell.title,
      archivedAt: shell.archivedAt,
      updatedAt: shell.updatedAt,
      lineage: shell.lineage,
    })),
    present,
    GUEST_CANDIDATES,
  );
  return (
    <MenuSub>
      <MenuSubTrigger disabled={candidates.length === 0}>
        <MessagesSquare />
        Thread
      </MenuSubTrigger>
      <MenuSubPopup className="max-w-72">
        {candidates.map((thread) => (
          <MenuItem key={thread.key} onClick={() => onPick(thread.key)}>
            <span className="min-w-0 truncate">{thread.title}</span>
          </MenuItem>
        ))}
      </MenuSubPopup>
    </MenuSub>
  );
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
          <Button aria-label="New tab" className="shrink-0" size="icon-sm" variant="ghost-muted" />
        }
      >
        <Plus className="size-4" />
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
        <MenuSeparator />
        <GuestThreadMenu
          onPick={(guest) => {
            setOpen(false);
            controller.update((arrangement) =>
              addGuests(arrangement, [guest], { paneId, show: true }),
            );
          }}
        />
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

/**
 * The right-click menu for a selection of tabs: closing them (the conversation never closes) and
 * moving them together into a new pane beside their own. Either ends the selection.
 */
async function showSelectionMenu(
  api: NonNullable<ReturnType<typeof readLocalApi>>,
  controller: PanesController,
  keys: readonly string[],
  position: { x: number; y: number },
) {
  const closable = keys.filter((key) => key !== CONVERSATION);
  type Action = "close" | "split-right" | "split-down";
  const items: ContextMenuItem<Action>[] = [
    { id: "close", label: `Close (${closable.length})`, disabled: closable.length === 0 },
    { id: "split-right", label: `Split right (${keys.length})` },
    { id: "split-down", label: `Split down (${keys.length})` },
  ];
  const action = await api.contextMenu.show(items, position);
  if (action === null || action === undefined) return;
  useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
  if (action === "close") {
    for (const key of closable) closeTabOf(controller, key);
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
  draggableInTitlebar: boolean;
}) {
  const { controller } = usePanesHost();
  const { title, icon, note } = useTabLabel(tabKey);
  const guest = guestThreadOf(tabKey);
  const dragging = useDragging(tabKey);
  const closable = tabKey !== CONVERSATION;
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
      await showSelectionMenu(api, controller, keys, { x: event.clientX, y: event.clientY });
      return;
    }
    type Action =
      | "own-workspace"
      | "close"
      | "close-others"
      | "close-to-right"
      | "split-right"
      | "split-down";
    const items: ContextMenuItem<Action>[] = [
      ...(guest === null
        ? []
        : [{ id: "own-workspace" as const, label: "Open in its own workspace" }]),
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
      case "own-workspace":
        if (guest !== null) useGuestWorkspaceRequest.getState().open(guest);
        break;
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
        // A pill as wide as its title up to 260px; short of room the pills shrink together to
        // 96px, then the strip scrolls. `--pill` is its fill, which the close control fades to.
        "group/tab relative flex h-7 max-w-[260px] min-w-24 shrink cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-(--pill) px-2.25 text-xs font-medium transition-colors duration-75 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        draggableInTitlebar && "[-webkit-app-region:no-drag]",
        active
          ? cn(
              "border-border shadow-xs/5 [--pill:var(--card)]",
              paneFocused ? "text-foreground" : "text-muted-foreground",
            )
          : selected
            ? "text-foreground [--pill:color-mix(in_oklch,var(--muted),var(--primary)_14%)]"
            : "text-muted-foreground [--pill:color-mix(in_oklch,var(--muted),black_4%)] hover:text-foreground hover:[--pill:color-mix(in_oklch,var(--muted),var(--foreground)_7%)] dark:[--pill:color-mix(in_oklch,var(--muted),black_22%)] dark:hover:[--pill:color-mix(in_oklch,var(--muted),var(--foreground)_7%)]",
        selected && "border-primary/45",
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
        if (event.button === 1 && closable) closeTabOf(controller, tabKey);
      }}
      onContextMenu={(event) => void showContextMenu(event)}
      onDragStart={(event) => {
        const keys = actedOn();
        startDrag(event, { key: tabKey, keys }, title);
      }}
      onDragEnd={endDrag}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center",
          active ? "opacity-100" : "opacity-85 group-hover/tab:opacity-100",
        )}
      >
        {icon}
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 truncate">
              {title}
              {note ? (
                <span className="ms-1.5 font-normal text-muted-foreground">{note}</span>
              ) : null}
            </span>
          }
        />
        <TooltipPopup>{note ? `${title} · ${note}` : title}</TooltipPopup>
      </Tooltip>
      {closable ? (
        // Over the pill's end while it is hovered or focus is inside it, on a backdrop that fades
        // the title out before it, so the pill keeps its width. Only the 16px ✕ takes clicks.
        // Transparent rather than hidden at rest, so the ✕ stays in the keyboard's Tab order.
        <span className="pointer-events-none absolute inset-y-0 end-0 flex items-center opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100">
          <span className="h-full w-6 bg-linear-to-r from-transparent to-(--pill)" />
          <span className="flex h-full items-center rounded-e-md bg-(--pill) pe-1.5">
            <button
              type="button"
              aria-label={`Close ${title}`}
              className="pointer-events-auto flex size-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => {
                event.stopPropagation();
                closeTabOf(controller, tabKey);
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        </span>
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
        "relative flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1.5 border-b border-border bg-muted px-2",
        titlebar && "drag-region",
        titlebar && atRight && "wco:pr-(--workspace-native-controls-inset)",
        atTop && atLeft && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
    >
      <div
        ref={strip}
        role="tablist"
        aria-orientation="horizontal"
        aria-multiselectable
        data-pane-tabs
        // 2px past the strip's box on each side, so a pill's shadow and focus ring stay whole.
        className="-mx-0.5 flex min-w-0 items-center gap-1.5 overflow-x-auto px-0.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
      <NewTabMenu paneId={leaf.id} />
      {maximized ? <RestoreButton paneId={leaf.id} /> : null}
      <PaneMenu leaf={leaf} maximized={maximized} />
    </div>
  );
}

/** Shown while the pane fills the main area: it says so, and puts the other panes back. */
function RestoreButton({ paneId }: { paneId: string }) {
  const toggleMaximized = useToggleMaximized();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Restore pane"
            className="ms-auto shrink-0"
            size="icon-sm"
            variant="ghost-muted"
            onClick={() => toggleMaximized(paneId)}
          />
        }
      >
        <Minimize2 className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">Restore pane</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The pane's own menu, ending its strip as Obsidian's pane header ends with one: what acts on
 * the whole pane. Filling the main area with it, moving the tab in front into a new pane beside
 * it (a pane's only tab stays, as splitting would leave the pane empty), and closing it. What
 * acts on one tab stays on the tab. The pane holding the main thread never closes whole, as the
 * main thread never closes.
 */
function PaneMenu({ leaf, maximized }: { leaf: Leaf; maximized: boolean }) {
  const { controller } = usePanesHost();
  const toggleMaximized = useToggleMaximized();
  // A lone pane already fills the main area: there is nothing to maximize it over.
  const alone = useSyncExternalStore(controller.subscribe, () => {
    const snapshot = controller.getSnapshot();
    return snapshot === null || leaves(snapshot.arrangement.root).length === 1;
  });
  const { active } = leaf;
  const split = (side: "right" | "bottom") =>
    controller.update((arrangement) => splitTab(arrangement, active, side));
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            aria-label="Pane actions"
            className={cn("shrink-0", !maximized && "ms-auto")}
            size="icon-sm"
            variant="ghost-muted"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" sideOffset={6}>
        <MenuItem
          disabled={alone}
          onClick={() => {
            if (!maximized) controller.update((arrangement) => focusPane(arrangement, leaf.id));
            toggleMaximized(leaf.id);
          }}
        >
          {maximized ? <Minimize2 /> : <Maximize2 />}
          {maximized ? "Restore pane" : "Maximize pane"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={leaf.tabs.length === 1} onClick={() => split("right")}>
          <Columns2 />
          Split right
        </MenuItem>
        <MenuItem disabled={leaf.tabs.length === 1} onClick={() => split("bottom")}>
          <Rows2 />
          Split down
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          disabled={leaf.tabs.includes(CONVERSATION)}
          onClick={() => {
            for (const key of leaf.tabs) closeTabOf(controller, key);
          }}
        >
          <SquareX />
          Close pane
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

/** An empty tab: nothing yet, and T3 Code's own launcher for the surfaces it can open. */
function EmptyTab({ paneId }: { paneId: string }) {
  const { controller } = usePanesHost();
  const panel = usePanel(controller);
  const profiles = useBrowserDefaults().profiles;
  const actions = addActions(panel);
  const available = (label: string) =>
    actions.find((action) => action.label === label)?.available ?? false;
  // Each opens in this pane, as the New tab menu's do; one already open elsewhere moves here.
  const run = (label: string) => () => {
    const action = actions.find((candidate) => candidate.label === label);
    if (action) runAddAction(controller, paneId, action);
  };
  return (
    <RightPanelEmptyState
      onAddBrowser={run("Browser")}
      onAddBrowserInProfile={(profileId) => {
        const current = controller.getPanel();
        if (!current) return;
        controller.targetPane(paneId);
        current.onAddBrowserInProfile(profileId);
      }}
      browserProfiles={profiles}
      onAddTerminal={run("Terminal")}
      onAddDiff={run("Diff")}
      onAddFiles={run("Files")}
      onAddPullRequest={run("Pull request")}
      onAddPullRequests={run("Linked pull requests")}
      onAddDevice={run("Device")}
      browserAvailable={available("Browser")}
      terminalAvailable={available("Terminal")}
      diffAvailable={available("Diff")}
      filesAvailable={available("Files")}
      pullRequestAvailable={available("Pull request")}
      pullRequestsAvailable={available("Linked pull requests")}
      deviceAvailable={available("Device")}
    />
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

/** Set by T3 Code's thread drag on the drop target under the pointer (`threadContextDrag.ts`). */
const THREAD_CONTEXT_OVER = "data-thread-context-over";

/**
 * Follows threads dragged from T3 Code's sidebar, which drags with pointer events rather than
 * the browser's drag and drop, and reports where they would land on `pane` as tabs would.
 * The pane is a drop target of that drag, but the composer inside it lights up under any
 * target marked over, so the pane takes the mark off itself before paint and tests for the
 * pointer itself; over the composer, the composer is the target.
 */
function SidebarDropFollower({
  pane,
  leaf,
  onTarget,
}: {
  pane: RefObject<HTMLElement | null>;
  leaf: Leaf;
  onTarget: (target: DropTarget | null) => void;
}) {
  const ghost = useThreadContextDragGhost();
  const over = useRef(false);
  useLayoutEffect(() => {
    const element = pane.current;
    if (!element) return;
    element.removeAttribute(THREAD_CONTEXT_OVER);
    const hit =
      ghost !== null &&
      document.elementFromPoint(ghost.x, ghost.y)?.closest("[data-thread-context-drop]") ===
        element;
    if (!hit && !over.current) return;
    over.current = hit;
    onTarget(hit ? dropTargetAt(element, leaf, [], ghost.x, ghost.y) : null);
  }, [ghost, leaf, onTarget, pane]);
  return null;
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
  maximized,
  atTop,
  atLeft,
  atRight,
  minWidth,
}: {
  leaf: Leaf;
  focused: boolean;
  /** Whether this pane shows the surface T3 Code renders. */
  hosting: boolean;
  /**
   * Whether this pane fills the main area (true), or another does and this one waits, mounted,
   * beneath it (false); null when every pane shows.
   */
  maximized: boolean | null;
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

  // Each guest this pane holds lives in its slot, shown while its tab is active.
  const guests = leaf.tabs.flatMap((key) => guestThreadOf(key) ?? []).join("\n");
  useLayoutEffect(() => {
    const element = slot.current;
    if (!element || guests === "") return;
    for (const guest of guests.split("\n")) {
      const container = host.guest(guest);
      if (container.parentNode !== element) element.appendChild(container);
      container.style.display = leaf.active === guestKey(guest) ? "" : "none";
    }
  }, [guests, host, leaf.active]);

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
  const hostRef = usePanesThreadRef();
  const hostKey = hostRef ? scopedThreadKey(hostRef) : null;
  const latest = useRef({ leaf, target, hostKey });
  useLayoutEffect(() => {
    latest.current = { leaf, target, hostKey };
  });
  const followSidebarDrag = useCallback((next: DropTarget | null) => {
    if (!sameTarget(latest.current.target, next)) setTarget(next);
  }, []);
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
      controller.update((arrangement) =>
        drop.zone === "center"
          ? moveTabs(arrangement, item.keys, current.id, drop.index, item.key)
          : splitWithTabs(arrangement, item.keys, current.id, drop.zone, item.key),
      );
      // The tabs moved together; their selection ends with the move.
      useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
    };
    // Threads dropped from T3 Code's sidebar where the pane showed they would land (see
    // `SidebarDropFollower`) join as guests; the host's own thread brings its conversation
    // forward. A drop on a composer inside the pane is the composer's, as context.
    const onThreadDrop = (event: Event) => {
      const { target: drop, leaf: current, hostKey: hostThread } = latest.current;
      setTarget(null);
      const threads = (event as CustomEvent<readonly ScopedThreadRef[]>).detail;
      if (!drop || !Array.isArray(threads)) return;
      const keys = threads.map(scopedThreadKey);
      const guests = keys.filter((key) => key !== hostThread);
      controller.update((arrangement) =>
        guests.length === 0
          ? activateTab(arrangement, CONVERSATION)
          : dropGuests(
              arrangement,
              guests,
              current.id,
              drop.zone === "center" ? { index: drop.index } : { side: drop.zone },
            ),
      );
    };
    pane.addEventListener(THREAD_CONTEXT_DROP_EVENT, onThreadDrop);
    pane.addEventListener("dragenter", onDragEnter, true);
    pane.addEventListener("dragover", onDragOver, true);
    pane.addEventListener("dragleave", onDragLeave);
    pane.addEventListener("drop", onDrop, true);
    return () => {
      pane.removeEventListener(THREAD_CONTEXT_DROP_EVENT, onThreadDrop);
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
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        maximized ? "absolute inset-0 z-30" : "relative",
      )}
      style={maximized ? undefined : { minWidth }}
      inert={maximized === false}
      data-pane-id={leaf.id}
      data-focused={focused || undefined}
      {...threadContextDropTargetProps()}
      onPointerDownCapture={() => {
        if (!focused) controller.update((arrangement) => focusPane(arrangement, leaf.id));
      }}
      onFocusCapture={() => {
        if (!focused) controller.update((arrangement) => focusPane(arrangement, leaf.id));
      }}
    >
      <SidebarDropFollower pane={section} leaf={leaf} onTarget={followSidebarDrag} />
      <TabStrip
        leaf={leaf}
        focused={focused}
        maximized={maximized === true}
        atTop={atTop}
        atLeft={atLeft}
        atRight={atRight}
      />
      {/* Layout containment keeps the thread view's fixed-position controls inside the pane. */}
      <div className="relative min-h-0 flex-1 [contain:layout_paint]">
        <div ref={slot} className="absolute inset-0" />
        {content ? (
          <div className="absolute inset-0 flex flex-col overflow-auto bg-background">
            {content}
          </div>
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
          {target.zone === "center" ? null : <div className="size-full rounded-md bg-primary/50" />}
        </div>
      ) : null}
    </section>
  );
});

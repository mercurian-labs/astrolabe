import { repositoryMoveOfSurface } from "~/components/repositories/openInRepositories";
import {
  Files,
  FileDiff,
  FileText,
  GitFork,
  Globe2,
  Link2,
  Plus,
  Smartphone,
  SquareDashed,
  SquarePlus,
  TerminalSquare,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { Volume2, VolumeOff } from "lucide";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import { useBrowserDefaults } from "~/browser/browserDefaults";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { MorphIcon } from "~/components/MorphIcon";
import { previewBridge } from "~/components/preview/previewBridge";
import {
  DeviceTabTooltip,
  LAUNCHER_SHORTCUT_BLOCKING_LAYERS,
  RightPanelEmptyState,
  SURFACE_DISABLED_REASONS,
  SurfaceMenuItem,
  previewFaviconOf,
  previewTabIdOf,
  SurfaceIcon,
  surfaceShortcutActionForKey,
  surfaceTitle,
  tabAudioState,
  tabMuteMenuItem,
} from "~/components/RightPanelTabs";
import { followLocalGraph, pinLocalGraph } from "~/components/repositories/localGraph";
import { RepositoryTabHeader } from "~/components/repositories/RepositoryTabHeader";
import { parseRepositoryTabKey } from "~/components/repositories/repositoryTabs";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useWikiOverviews } from "~/components/wiki/wikiEnvironment";
import { WikiFinder } from "~/components/wiki/WikiFinder";
import { closeAskingFirst } from "~/components/wiki/WikiTabView";
import { wikiTabKey } from "~/components/wiki/wikiTabs";
import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { resolveShortcutCommand } from "~/keybindings";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { cn } from "~/lib/utils";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { sectionTabMove, useSectionTabLabel } from "~/sectionTabs/SectionTabContent";
import {
  parseChatSurfaceKey,
  parseChatTabKey,
  tabSection,
  chatSurfaceKey,
} from "~/sectionTabs/sectionTabs";
import { primaryServerKeybindingsAtom } from "~/state/server";
import {
  isRepositoriesPath,
  isWikisPath,
  useSectionPathname,
} from "~/components/sidebar/mainAppLocation";
import { followedGraphFiles, linkMarkKeyOf, linkMarkOf } from "./linkMarks";
import { closeTab, focusedPane, isEmptyTab, newTab, openTab } from "./arrangement";
import type { PanelProps } from "./panesController";
import type { PaneTabLabel, PaneTabLabelProps, PaneTabMenuItem, PaneTabs } from "./panesHost";
import type { WorkspaceHost } from "./PaneSurfaceHost";
import { TabIconButton } from "./TabParts";
import type { Leaf } from "./tree";
import { useChatTabLabel } from "~/chatTabs/chatTabLabel";
import { surfaceOfKey, useTabOwner, useWorkspaceFront, workspace } from "./workspace";

/**
 * Astrolabe: the shared panes' tabs. Chats, files, documents and pull requests each render once
 * into their own container; a chat's surfaces are T3 Code's, and the front chat's live one
 * renders into a container that moves into the pane showing it (`LinkedPanel`).
 */
export function createWorkspaceHost(): WorkspaceHost {
  const surface = document.createElement("div");
  surface.className = "absolute inset-0 flex min-h-0 min-w-0 flex-col";
  surface.dataset.panesContent = "surface";
  const routeNode = document.createElement("div");
  routeNode.className = "absolute inset-0 flex min-h-0 min-w-0 flex-col";
  routeNode.dataset.routeChat = "";
  const containers = new Map<string, HTMLDivElement>();
  const containerFor = (key: string) => {
    let container = containers.get(key);
    if (!container) {
      container = document.createElement("div");
      container.className = "absolute inset-0 flex min-h-0 min-w-0 flex-col bg-background";
      container.dataset.workspaceTab = key;
      containers.set(key, container);
    }
    return container;
  };
  const tabs: PaneTabs = {
    Label: TabLabel,
    Marker: LinkMarker,
    menuItems: tabMenuItems,
    link: linkAction,
    close: closeWorkspaceTab,
    NewTab: NewTabMenu,
    place: (slot, leaf, hosting) => {
      if (hosting) {
        if (surface.parentNode !== slot) slot.appendChild(surface);
        surface.style.display = "";
      } else if (surface.parentNode === slot) {
        surface.style.display = "none";
      }
      for (const key of leaf.tabs) {
        if (isEmptyTab(key) || parseChatSurfaceKey(key) !== null) continue;
        const container = containerFor(key);
        // Moving a node that is already in place would still detach and reattach it.
        if (container.parentNode !== slot) slot.appendChild(container);
        container.style.display = key === leaf.active ? "" : "none";
      }
    },
    Overlay: SurfaceOverlay,
    reservesTopRight: true,
    openElsewhere: (tabKey) => {
      const parsed = parseChatSurfaceKey(tabKey);
      if (parsed !== null) {
        return repositoryMoveOfSurface(parseChatTabKey(parsed.chatKey), parsed.surfaceId);
      }
      // Changes keeps panes of its own; everything else is here already.
      return tabSection(tabKey) === "change-requests"
        ? sectionTabMove(tabKey, "threads", closeWorkspaceTab)
        : null;
    },
  };
  return {
    controller: workspace.store,
    tabs,
    surface,
    routeNode,
    containerFor,
    prune(open) {
      for (const [key, container] of containers) {
        if (open.has(key)) continue;
        container.remove();
        containers.delete(key);
      }
    },
  };
}

/** The front chat's panel props, re-rendering when what the tabs draw from them changes. */
function usePanel(): PanelProps | null {
  return useSyncExternalStore(workspace.subscribePanel, workspace.getPanelSnapshot);
}

/** The panel props of `chatKey`'s ChatView, while it is the chat in front. */
function panelOf(chatKey: string): PanelProps | null {
  return workspace.linked().front === chatKey ? workspace.getPanel() : null;
}

function useSurface(tabKey: string): RightPanelSurface | null {
  const parsed = parseChatSurfaceKey(tabKey);
  const ref = parsed ? parseChatTabKey(parsed.chatKey) : null;
  return useRightPanelStore((state) =>
    parsed === null || ref === null
      ? null
      : (selectThreadRightPanelState(state.byThreadKey, ref).surfaces.find(
          (surface) => surface.id === parsed.surfaceId,
        ) ?? null),
  );
}

/**
 * What a tab's menu offers of its own: a workspace file's Copy path and a browser tab's Mute or
 * Unmute, as T3 Code's panel tabs do; then linking it to the chat in front, or unlinking it. A
 * thread's surfaces stay linked to their thread, which renders them.
 */
function tabMenuItems(tabKey: string): PaneTabMenuItem[] {
  const link = linkAction(tabKey);
  return [...surfaceMenuItems(tabKey), ...(link ? [link] : [])];
}

/**
 * Unlinks a linked tab, or links one to the chat in front. A following local graph unlinks by
 * pinning to the file it shows, and links again by following.
 */
function linkAction(tabKey: string): PaneTabMenuItem | null {
  if (parseChatSurfaceKey(tabKey) !== null || parseChatTabKey(tabKey) !== null) return null;
  if (isEmptyTab(tabKey)) return null;
  const graph = graphLinkAction(tabKey);
  if (graph !== undefined) return graph;
  const linked = workspace.linked();
  if (linked.owners[tabKey] !== undefined) {
    return { label: "Unlink tab", run: () => workspace.unlink(tabKey) };
  }
  if (linked.front === null) return null;
  return { label: "Link to the chat in front", run: () => workspace.link(tabKey) };
}

/** A local graph's link: following is linked, pinned is not. Undefined for any other tab. */
function graphLinkAction(tabKey: string): PaneTabMenuItem | null | undefined {
  const graph = parseRepositoryTabKey(tabKey);
  if (graph?.kind !== "graph") return undefined;
  if (graph.path !== null) {
    return {
      label: "Link to the file in front",
      run: () => workspace.update((arrangement) => followLocalGraph(arrangement, tabKey, graph)),
    };
  }
  const followed = parseRepositoryTabKey(followedGraphFiles.fileOf(tabKey) ?? "");
  if (followed?.kind !== "file") return null;
  return {
    label: "Unlink tab",
    run: () =>
      workspace.update((arrangement) => pinLocalGraph(arrangement, tabKey, graph, followed.path)),
  };
}

function surfaceMenuItems(tabKey: string): PaneTabMenuItem[] {
  const surface = surfaceOfKey(tabKey);
  const parsed = parseChatSurfaceKey(tabKey);
  const panel = parsed ? panelOf(parsed.chatKey) : null;
  if (!surface || !panel) return [];
  if (surface.kind === "file" && surface.attachment === undefined) {
    return [{ label: "Copy path", run: () => panel.onCopyFilePath(surface.relativePath) }];
  }
  if (surface.kind !== "preview") return [];
  const previewTabId = previewTabIdOf(surface, panel.previewSessions);
  const overlay = previewTabId ? (panel.desktopByTabId[previewTabId] ?? null) : null;
  const item = tabMuteMenuItem({
    overlay,
    canResolveRuntimeTabId: panel.previewRuntimeTabId !== undefined,
  });
  return [
    {
      ...item,
      run: () => {
        const runtimeTabId =
          previewTabId && overlay ? (panel.previewRuntimeTabId?.(previewTabId) ?? null) : null;
        if (!runtimeTabId) return;
        void previewBridge
          ?.setAudioMuted(runtimeTabId, !(overlay?.audioMuted ?? false))
          .catch(() => undefined);
      },
    },
  ];
}

/**
 * Closes a tab: a thread's surface through its ChatView's own close, which may ask first; a tab
 * with unsaved edits asks first too.
 */
export function closeWorkspaceTab(tabKey: string) {
  const parsed = parseChatSurfaceKey(tabKey);
  const ref = parsed ? parseChatTabKey(parsed.chatKey) : null;
  if (parsed === null || ref === null) {
    closeAskingFirst(tabKey, () => workspace.close(tabKey));
    return;
  }
  const surface = surfaceOfKey(tabKey);
  if (!surface) {
    workspace.update((arrangement) => closeTab(arrangement, tabKey));
    return;
  }
  const panel = panelOf(parsed.chatKey);
  if (panel) panel.onCloseSurface(surface);
  else useRightPanelStore.getState().closeSurface(ref, surface.id);
}

function TabLabel({ tabKey, children }: PaneTabLabelProps) {
  return children(useTabLabel(tabKey));
}

/**
 * A tab's label: a chat's, as its sidebar row draws it; a document's, file's or pull request's;
 * or one of a thread's surfaces, drawn as T3 Code's panel tab is. A file still saving shows a dot
 * on its icon, a playing browser tab its speaker, and a device tab names its machine on hover and
 * can be renamed.
 */
function useTabLabel(tabKey: string): PaneTabLabel {
  const parsed = parseChatSurfaceKey(tabKey);
  const front = useWorkspaceFront();
  const livePanel = usePanel();
  const panel = parsed !== null && parsed.chatKey === front ? livePanel : null;
  const surface = useSurface(tabKey);
  const chat = useChatTabLabel(tabKey);
  const section = useSectionTabLabel(tabKey);
  const { resolvedTheme } = useTheme();
  if (chat !== null) return chat;
  if (parsed === null && section !== null) return section;
  if (!surface) return { title: "New tab", icon: <SquareDashed className="size-3 shrink-0" /> };
  const sessions = panel?.previewSessions ?? {};
  const favicon = previewFaviconOf(surface, sessions, panel?.desktopByTabId ?? {});
  const title = surfaceTitle(surface, sessions, panel?.terminalLabelsById ?? new Map());
  const environmentId = panel?.environmentId ?? null;
  const previewTabId = previewTabIdOf(surface, sessions);
  const audio = tabAudioState(previewTabId ? (panel?.desktopByTabId[previewTabId] ?? null) : null);
  return {
    title,
    icon: (
      <span className="relative flex">
        <SurfaceIcon
          surface={surface}
          previewUrl={favicon.url}
          previewCapturedUrl={favicon.capturedUrl}
          theme={resolvedTheme}
          environmentId={environmentId}
          pullRequestStatusSeed={panel?.pullRequestStatusSeeds?.[surface.id]}
        />
        {panel?.pendingSurfaceIds.has(surface.id) ? (
          <span
            className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
            aria-hidden
          />
        ) : null}
      </span>
    ),
    ...(previewTabId && audio !== "none" && panel?.previewRuntimeTabId
      ? {
          accessory: (
            <TabAudioButton previewTabId={previewTabId} muted={audio === "muted"} title={title} />
          ),
        }
      : {}),
    ...(surface.kind === "device"
      ? {
          tooltip: (
            <DeviceTabTooltip surface={surface} environmentId={environmentId} title={title} />
          ),
          ...(panel?.onRenameDevice
            ? {
                rename: (next: string) => workspace.getPanel()?.onRenameDevice?.(surface.id, next),
              }
            : {}),
        }
      : {}),
  };
}

/**
 * The link marker: a chain on a linked tab and on its owner, in the owner's ink, so which tab a
 * terminal or a following graph belongs to reads at a glance, even with two owners on screen. It
 * names the owner (or what the owner keeps) on hover. Quiet and still: no motion.
 */
function LinkMarker({ tabKey }: { readonly tabKey: string }) {
  const owner = useTabOwner(tabKey);
  const followed = useSyncExternalStore(followedGraphFiles.subscribe, () =>
    followedGraphFiles.fileOf(tabKey),
  );
  const markKey = useSyncExternalStore(subscribeMarks, () => linkMarkKeyOf(tabKey));
  const ownerKey = owner ?? followed;
  const ownerLabel = useSectionTabLabel(ownerKey ?? "");
  const chatLabel = useChatTabLabel(ownerKey ?? "");
  const mark = markKey === null ? null : linkMarkOf(tabKey);
  if (mark === null) return null;
  const name = chatLabel?.title ?? ownerLabel?.title ?? "its owner";
  const tooltip = mark.owns
    ? `${mark.count} linked ${mark.count === 1 ? "tab" : "tabs"} follow this tab`
    : `Linked to ${name}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-link-mark={mark.ink}
            aria-label={tooltip}
            className={cn(
              "flex size-3.5 shrink-0 items-center justify-center",
              LINK_INKS[mark.ink % LINK_INKS.length],
            )}
          />
        }
      >
        <Link2 className="size-3" aria-hidden />
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

function subscribeMarks(listener: () => void) {
  const stopPanes = workspace.store.subscribe(listener);
  const stopGraphs = followedGraphFiles.subscribe(listener);
  return () => {
    stopPanes();
    stopGraphs();
  };
}

/** Each owner on screen inks its marks its own way, quietly; the first takes the primary colour. */
const LINK_INKS = [
  "text-(--link-ink-1)",
  "text-(--link-ink-2)",
  "text-(--link-ink-3)",
  "text-(--link-ink-4)",
];

/** Mutes or unmutes a playing browser tab, as T3 Code's panel tab's speaker does. */
function TabAudioButton({
  previewTabId,
  muted,
  title,
}: {
  previewTabId: string;
  muted: boolean;
  title: string;
}) {
  const label = muted ? "Unmute tab" : "Mute tab";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TabIconButton
            label={muted ? `Unmute ${title}` : `Mute ${title}`}
            onClick={(event) => {
              event.stopPropagation();
              const runtimeTabId = workspace.getPanel()?.previewRuntimeTabId?.(previewTabId);
              if (!runtimeTabId) return;
              void previewBridge?.setAudioMuted(runtimeTabId, !muted).catch(() => undefined);
            }}
          />
        }
      >
        <MorphIcon className="size-3" icon={muted ? VolumeOff : Volume2} />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

interface AddAction {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut: string;
  readonly available: boolean;
  /** Why it is unavailable, shown on hovering it then. */
  readonly disabledReason: string;
  /** The surface this opens when the record already holds it, which then moves here instead. */
  readonly singleton: RightPanelSurface["id"] | null;
  /** Adds the surface through ChatView, given its current panel props. */
  readonly invoke: (panel: PanelProps) => void;
}

/** The surfaces a pane can open for the chat in front, as ChatView offers them in its panel. */
function addActions(panel: PanelProps | null): AddAction[] {
  if (!panel) return [];
  return [
    {
      label: "Browser",
      icon: Globe2,
      shortcut: "B",
      available: panel.browserAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.browser,
      singleton: null,
      invoke: (current) => current.onAddBrowser(),
    },
    {
      label: "Terminal",
      icon: TerminalSquare,
      shortcut: "T",
      available: panel.terminalAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.terminal,
      singleton: null,
      invoke: (current) => current.onAddTerminal(),
    },
    {
      label: "Files",
      icon: Files,
      shortcut: "F",
      available: panel.filesAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.files,
      singleton: "files",
      invoke: (current) => current.onAddFiles(),
    },
    {
      label: "Diff",
      icon: FileDiff,
      shortcut: "D",
      available: panel.diffAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.diff,
      singleton: "diff",
      invoke: (current) => current.onAddDiff(),
    },
    {
      label: "Pull request",
      icon: PullRequestGlyph.pullRequest,
      shortcut: "P",
      available: panel.pullRequestAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.pullRequest,
      singleton: null,
      invoke: (current) => current.onAddPullRequest(),
    },
    {
      label: "Linked pull requests",
      icon: PullRequestGlyph.link,
      shortcut: "L",
      available: panel.pullRequestsAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.pullRequests,
      singleton: "pull-requests",
      invoke: (current) => current.onAddPullRequests(),
    },
    {
      label: "Device",
      icon: Smartphone,
      shortcut: "M",
      available: panel.deviceAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.device,
      singleton: null,
      invoke: (current) => current.onAddDevice(),
    },
    {
      label: "Graph",
      icon: Waypoints,
      shortcut: "G",
      available: panel.graphAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.graph,
      singleton: "graph",
      invoke: (current) => current.onAddGraph(),
    },
    {
      label: "Lineage",
      icon: GitFork,
      shortcut: "I",
      available: panel.lineageAvailable,
      disabledReason: SURFACE_DISABLED_REASONS.lineage,
      singleton: "lineage",
      invoke: (current) => current.onAddLineage(),
    },
  ];
}

/**
 * Opens one of the front chat's surfaces in a pane. One its record already holds moves here, as
 * a tab open in another pane does; anything else is added through ChatView, and lands here when
 * it arrives. Opening it opens the chat's panel.
 */
function runAddAction(paneId: string, action: AddAction) {
  const linked = workspace.linked();
  const front = linked.front;
  const ref = workspace.frontRef();
  if (front === null || ref === null) return;
  const held =
    action.singleton !== null &&
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces.some(
      (surface) => surface.id === action.singleton,
    );
  if (held && action.singleton !== null) {
    const key = chatSurfaceKey(front, action.singleton);
    workspace.update((arrangement) => openTab(arrangement, key, paneId));
    return;
  }
  const panel = workspace.getPanel();
  if (!panel) return;
  workspace.targetPane(paneId);
  action.invoke(panel);
}

function shortcutContext() {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    modelPickerOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

/**
 * A pane's New tab menu: the chat in front's surfaces, as T3 Code's panel offers them, a
 * document, or an empty tab. Mod+T (`rightPanel.new`) opens the focused pane's menu.
 */
function NewTabMenu({ paneId }: { paneId: string }) {
  const panel = usePanel();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const profiles = useBrowserDefaults().profiles;
  const actions = addActions(panel);
  const run = (action: AddAction) => {
    setOpen(false);
    runAddAction(paneId, action);
  };
  const onNewTabShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (focusedPane(workspace.arrangement()).id !== paneId) return;
    const current = workspace.getPanel();
    const keybindings = current?.keybindings ?? appAtomRegistry.get(primaryServerKeybindingsAtom);
    const context = current ? current.getShortcutContext() : shortcutContext();
    if (
      resolveShortcutCommand(event, keybindings, {
        context: { ...context, rightPanelOpen: true },
      }) !== "rightPanel.new"
    )
      return;
    if (!open && document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    trigger.current?.focus();
    setOpen(true);
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- Mod+T is a window shortcut each pane's menu answers while focused
  useEffect(() => {
    document.addEventListener("keydown", onNewTabShortcut, true);
    return () => document.removeEventListener("keydown", onNewTabShortcut, true);
  }, []);
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        ref={trigger}
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
          const key = event.key.toLowerCase();
          if ((key === "o" || key === "n") && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            if (key === "o") setFinding(true);
            else workspace.update((arrangement) => newTab(arrangement, paneId));
            return;
          }
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
                        const current = workspace.getPanel();
                        if (!current) return;
                        workspace.targetPane(paneId);
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
            <SurfaceMenuItem
              key={action.label}
              available={action.available}
              disabledReason={action.disabledReason}
              shortcut={action.shortcut}
              onClick={() => run(action)}
            >
              <Icon />
              {action.label}
            </SurfaceMenuItem>
          );
        })}
        <MenuItem
          onClick={() => {
            setOpen(false);
            setFinding(true);
          }}
        >
          <FileText />
          Document
          <MenuShortcut>O</MenuShortcut>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setOpen(false);
            workspace.update((arrangement) => newTab(arrangement, paneId));
          }}
        >
          <SquarePlus />
          Empty tab
          <MenuShortcut>N</MenuShortcut>
        </MenuItem>
      </MenuPopup>
      {finding ? (
        <PaneDocumentFinder
          onClose={() => setFinding(false)}
          onPick={(key) => workspace.update((arrangement) => openTab(arrangement, key, paneId))}
        />
      ) : null}
    </Menu>
  );
}

/** A wiki's document, opened in the pane asked from, as the Wikis finder finds or writes one. */
function PaneDocumentFinder({
  onClose,
  onPick,
}: {
  readonly onClose: () => void;
  readonly onPick: (key: string) => void;
}) {
  const { overviews } = useWikiOverviews();
  return (
    <WikiFinder
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overviews={overviews}
      scope={null}
      mode="find"
      onPick={(tab) => {
        onClose();
        onPick(wikiTabKey(tab));
      }}
    />
  );
}

/**
 * What covers a pane's content: an empty tab's launcher, or a surface waiting its turn to be the
 * one T3 Code renders. Nothing while the pane shows its tab's own content.
 */
function SurfaceOverlay({ leaf, hosting }: { leaf: Leaf; hosting: boolean }) {
  if (isEmptyTab(leaf.active)) return <EmptyTab paneId={leaf.id} tabKey={leaf.active} />;
  if (parseChatSurfaceKey(leaf.active) !== null && !hosting) {
    return <WaitingSurface tabKey={leaf.active} />;
  }
  return null;
}

/**
 * An empty tab: beside a chat (linked to it, or in Agents), T3 Code's own launcher for the
 * surfaces it can open; in Wikis, a way to find or write a document; in Repositories, a reminder
 * that files open from the sidebar.
 */
function EmptyTab({ paneId, tabKey }: { paneId: string; tabKey: string }) {
  const owner = useTabOwner(tabKey);
  const pathname = useSectionPathname();
  const panel = usePanel();
  if (isWikisPath(pathname) && owner === null) return <EmptyDocumentTab paneId={paneId} />;
  if ((isRepositoriesPath(pathname) && owner === null) || panel === null) {
    return (
      <>
        <RepositoryTabHeader.Root>
          <RepositoryTabHeader.Path />
        </RepositoryTabHeader.Root>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing open</EmptyTitle>
            <EmptyDescription>
              Open a thread, file or document from the sidebar, or add one with the + above.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </>
    );
  }
  return <EmptyLauncher paneId={paneId} panel={panel} />;
}

function EmptyLauncher({ paneId, panel }: { paneId: string; panel: PanelProps }) {
  const profiles = useBrowserDefaults().profiles;
  const actions = addActions(panel);
  const available = (label: string) =>
    actions.find((action) => action.label === label)?.available ?? false;
  // Each opens in this pane, as the New tab menu's do; one already open elsewhere moves here.
  const run = (label: string) => () => {
    const action = actions.find((candidate) => candidate.label === label);
    if (action) runAddAction(paneId, action);
  };
  return (
    <RightPanelEmptyState
      onAddBrowser={run("Browser")}
      onAddBrowserInProfile={(profileId) => {
        const current = workspace.getPanel();
        if (!current) return;
        workspace.targetPane(paneId);
        current.onAddBrowserInProfile(profileId);
      }}
      browserProfiles={profiles}
      onAddTerminal={run("Terminal")}
      onAddDiff={run("Diff")}
      onAddFiles={run("Files")}
      onAddPullRequest={run("Pull request")}
      onAddPullRequests={run("Linked pull requests")}
      onAddDevice={run("Device")}
      onAddGraph={run("Graph")}
      onAddLineage={run("Lineage")}
      browserAvailable={available("Browser")}
      terminalAvailable={available("Terminal")}
      diffAvailable={available("Diff")}
      filesAvailable={available("Files")}
      pullRequestAvailable={available("Pull request")}
      pullRequestsAvailable={available("Linked pull requests")}
      deviceAvailable={available("Device")}
      graphAvailable={available("Graph")}
      lineageAvailable={available("Lineage")}
    />
  );
}

/** An empty tab in Wikis: one way to put a document in it, found or written. */
function EmptyDocumentTab({ paneId }: { readonly paneId: string }) {
  const { overviews, loading } = useWikiOverviews();
  const [finding, setFinding] = useState(false);
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          {overviews.length === 0 && !loading ? "No wikis yet" : "No document open"}
        </EmptyTitle>
        <EmptyDescription>
          {overviews.length === 0 && !loading
            ? "Add a wiki from the wiki filter in the sidebar: a folder of notes you already keep in git, or a new one."
            : "Open a document from the sidebar, or find or write one here."}
        </EmptyDescription>
      </EmptyHeader>
      {overviews.length > 0 ? (
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={() => setFinding(true)}>
            <FileText />
            Find or create a document
          </Button>
        </EmptyContent>
      ) : null}
      <WikiFinder
        open={finding}
        onOpenChange={setFinding}
        overviews={overviews}
        scope={null}
        mode="find"
        paneId={paneId}
      />
    </Empty>
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

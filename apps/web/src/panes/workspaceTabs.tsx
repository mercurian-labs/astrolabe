import { repositoryMoveOfSurface } from "~/components/repositories/openInRepositories";
import { Link2, Plus, SquareDashed } from "lucide-react";
import { Volume2, VolumeOff } from "lucide";
import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

import { useBrowserDefaults } from "~/browser/browserDefaults";
import { MorphIcon } from "~/components/MorphIcon";
import { previewBridge } from "~/components/preview/previewBridge";
import {
  DeviceTabTooltip,
  LAUNCHER_SHORTCUT_BLOCKING_LAYERS,
  RightPanelEmptyState,
  previewFaviconOf,
  previewTabIdOf,
  SurfaceIcon,
  surfaceTitle,
  tabAudioState,
  tabMuteMenuItem,
} from "~/components/RightPanelTabs";
import { followLocalGraph, pinLocalGraph } from "~/components/repositories/localGraph";
import { parseRepositoryTabKey } from "~/components/repositories/repositoryTabs";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { closeAskingFirst } from "~/components/wiki/WikiTabView";
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
import { followedGraphFiles, linkMarkKeyOf, linkMarkOf } from "./linkMarks";
import { closeTab, focusedPane, isEmptyTab, newTab } from "./arrangement";
import type { PanelProps } from "./panesController";
import type { PaneTabLabel, PaneTabLabelProps, PaneTabMenuItem, PaneTabs } from "./panesHost";
import type { WorkspaceHost } from "./PaneSurfaceHost";
import { TabIconButton } from "./TabParts";
import type { Leaf } from "./tree";
import { useChatTabLabel } from "~/chatTabs/chatTabLabel";
import { TabLauncher } from "./TabLauncher";
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
    NewTab: NewTabButton,
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
    reservesTopRight: false,
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
export function useTabLabel(tabKey: string): PaneTabLabel {
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
  const markKey = useSyncExternalStore(subscribeMarks, () => linkMarkKeyOf(tabKey));
  return markKey === null ? null : <LinkMark tabKey={tabKey} />;
}

function LinkMark({ tabKey }: { readonly tabKey: string }) {
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
  readonly available: boolean;
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
      available: panel.browserAvailable,
      singleton: null,
      invoke: (current) => current.onAddBrowser(),
    },
    {
      label: "Terminal",
      available: panel.terminalAvailable,
      singleton: null,
      invoke: (current) => current.onAddTerminal(),
    },
    {
      label: "Files",
      available: panel.filesAvailable,
      singleton: "files",
      invoke: (current) => current.onAddFiles(),
    },
    {
      label: "Diff",
      available: panel.diffAvailable,
      singleton: "diff",
      invoke: (current) => current.onAddDiff(),
    },
    {
      label: "Pull request",
      available: panel.pullRequestAvailable,
      singleton: null,
      invoke: (current) => current.onAddPullRequest(),
    },
    {
      label: "Linked pull requests",
      available: panel.pullRequestsAvailable,
      singleton: "pull-requests",
      invoke: (current) => current.onAddPullRequests(),
    },
    {
      label: "Device",
      available: panel.deviceAvailable,
      singleton: null,
      invoke: (current) => current.onAddDevice(),
    },
    {
      label: "Graph",
      available: panel.graphAvailable,
      singleton: "graph",
      invoke: (current) => current.onAddGraph(),
    },
    {
      label: "Lineage",
      available: panel.lineageAvailable,
      singleton: "lineage",
      invoke: (current) => current.onAddLineage(),
    },
  ];
}

/**
 * Opens one of the front chat's surfaces in place of the linked New tab `blank`. One its record
 * already holds moves here, as a tab open in another pane does; anything else is added through
 * ChatView, and takes the New tab's place when it arrives.
 */
function runAddAction(paneId: string, blank: string, action: AddAction) {
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
    workspace.fill(blank, chatSurfaceKey(front, action.singleton));
    return;
  }
  const panel = workspace.getPanel();
  if (!panel) return;
  workspace.targetPane(paneId, blank);
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
 * The + after a pane's tabs: a New tab there, standing on its own, as a browser's + opens one.
 * Mod+T (`rightPanel.new`) does the same in the focused pane.
 */
function NewTabButton({ paneId }: { paneId: string }) {
  const open = () => workspace.update((arrangement) => newTab(arrangement, paneId));
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
    if (document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) open();
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- Mod+T is a window shortcut each pane's + answers while focused
  useEffect(() => {
    document.addEventListener("keydown", onNewTabShortcut, true);
    return () => document.removeEventListener("keydown", onNewTabShortcut, true);
  }, []);
  return (
    <Button
      aria-label="New tab"
      className="shrink-0"
      size="icon-sm"
      variant="ghost-muted"
      onClick={open}
    >
      <Plus className="size-4" />
    </Button>
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
 * A New tab: linked to the chat in front, T3 Code's own launcher for the surfaces it can open;
 * standing on its own, the launcher of things that stand on their own (`TabLauncher`).
 */
function EmptyTab({ paneId, tabKey }: { paneId: string; tabKey: string }) {
  const owner = useTabOwner(tabKey);
  const panel = usePanel();
  if (owner !== null && panel !== null) {
    return <EmptyLauncher paneId={paneId} tabKey={tabKey} panel={panel} />;
  }
  return <TabLauncher paneId={paneId} tabKey={tabKey} />;
}

function EmptyLauncher({
  paneId,
  tabKey,
  panel,
}: {
  paneId: string;
  tabKey: string;
  panel: PanelProps;
}) {
  const profiles = useBrowserDefaults().profiles;
  const actions = addActions(panel);
  const available = (label: string) =>
    actions.find((action) => action.label === label)?.available ?? false;
  // Each takes this New tab's place; one already open elsewhere moves here.
  const run = (label: string) => () => {
    const action = actions.find((candidate) => candidate.label === label);
    if (action) runAddAction(paneId, tabKey, action);
  };
  return (
    <RightPanelEmptyState
      onAddBrowser={run("Browser")}
      onAddBrowserInProfile={(profileId) => {
        const current = workspace.getPanel();
        if (!current) return;
        workspace.targetPane(paneId, tabKey);
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

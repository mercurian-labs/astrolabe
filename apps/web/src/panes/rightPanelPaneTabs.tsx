import {
  Files,
  FileDiff,
  FileText,
  Globe2,
  Plus,
  Smartphone,
  SquareDashed,
  TerminalSquare,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useTheme } from "~/hooks/useTheme";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
} from "~/rightPanelStore";
import { useWikiOverviews } from "~/components/wiki/wikiEnvironment";
import { WikiFinder } from "~/components/wiki/WikiFinder";
import { parseWikiTabKey, wikiTabKey } from "~/components/wiki/wikiTabs";
import {
  closeSectionTab,
  SectionTabContent,
  sectionTabMove,
  useSectionTabLabel,
} from "~/sectionTabs/SectionTabContent";
import {
  allTabs,
  closeTab,
  focusedPane,
  isEmptyTab,
  openTab,
  surfaceIdOf,
  surfaceKey,
} from "./arrangement";
import type { PanelProps, PanesController } from "./panesController";
import type { PaneTabs } from "./panesHost";
import { useRightPanelHost, usePanesThreadRef, type RightPanelHost } from "./PaneSurfaceHost";
import type { Leaf } from "./tree";

/**
 * The right panel's panes: their tabs are the thread's surfaces, mirrored from T3 Code's
 * right-panel record (see `surfaceMirror.ts`), and its one live surface renders into a container
 * that moves into the pane showing it.
 */
export function createRightPanelHost(controller: PanesController): RightPanelHost {
  const surface = document.createElement("div");
  surface.className = "absolute inset-0 flex min-h-0 min-w-0 flex-col";
  surface.dataset.panesContent = "surface";
  const place = (slot: HTMLElement, visible: boolean) => {
    // Moving a node that is already in place would still detach and reattach it.
    if (surface.parentNode !== slot) slot.appendChild(surface);
    surface.style.display = visible ? "" : "none";
  };
  // Astrolabe: documents opened beside the thread, each in its own container.
  const sectionTabs = new Map<string, HTMLDivElement>();
  const sectionTabContainer = (key: string) => {
    let container = sectionTabs.get(key);
    if (!container) {
      container = document.createElement("div");
      container.className = "absolute inset-0 flex min-h-0 min-w-0 flex-col bg-background";
      container.dataset.sectionTab = key;
      sectionTabs.set(key, container);
    }
    return container;
  };
  const close = (tabKey: string) => closeTabOf(controller, tabKey);
  const tabs: PaneTabs = {
    useLabel: useTabLabel,
    close,
    NewTab: NewTabMenu,
    place: (slot, leaf, hosting) => {
      if (hosting) place(slot, true);
      for (const key of leaf.tabs) {
        const container = sectionTabs.get(key);
        if (!container) continue;
        if (container.parentNode !== slot) slot.appendChild(container);
        container.style.display = key === leaf.active ? "" : "none";
      }
      // A document in front covers what the pane showed before it.
      if (!hosting && surface.parentNode === slot && sectionTabs.has(leaf.active)) {
        surface.style.display = "none";
      }
    },
    Overlay: SurfaceOverlay,
    reservesTopRight: true,
    openElsewhere: (tabKey) =>
      sectionTabMove(tabKey, "threads", close, pullRequestOfSurface(controller, tabKey)),
  };
  return {
    controller,
    surface,
    place,
    hide() {
      surface.style.display = "none";
    },
    tabs,
    sectionTabContainer,
    pruneSectionTabs(open) {
      for (const [key, container] of sectionTabs) {
        if (open.has(key)) continue;
        container.remove();
        sectionTabs.delete(key);
      }
    },
  };
}

/**
 * Astrolabe: a pull request beside the thread, named in full to open in Change Requests; its key
 * leaves out the server, which is the thread's.
 */
function pullRequestOfSurface(controller: PanesController, tabKey: string) {
  const ref = controller.threadRef();
  const surfaceId = surfaceIdOf(tabKey);
  if (ref === null || surfaceId === null) return null;
  const surface = selectThreadRightPanelState(
    useRightPanelStore.getState().byThreadKey,
    ref,
  ).surfaces.find((entry) => entry.id === surfaceId);
  if (surface?.kind !== "pull-request") return null;
  return {
    environmentId: surface.environmentId ?? ref.environmentId,
    projectId: surface.projectId,
    repository: surface.repository,
    number: surface.number,
    ...(surface.host ? { host: surface.host } : {}),
    ...(surface.url ? { url: surface.url } : {}),
  };
}

/**
 * Astrolabe: the documents open beside the thread, each rendered once into its container. A
 * change request's thread link goes to the thread, rather than opening a chat inside a chat.
 */
export function RightPanelSectionTabs() {
  const host = useRightPanelHost();
  const { controller } = host;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const keys = useMemo(
    () => (snapshot ? allTabs(snapshot.arrangement).filter((key) => parseWikiTabKey(key)) : []),
    [snapshot],
  );
  const focusedKey = snapshot ? focusedPane(snapshot.arrangement).active : null;
  useEffect(() => {
    host.pruneSectionTabs(new Set(keys));
  }, [host, keys]);
  return (
    <>
      {keys.map((key) =>
        createPortal(
          <SectionTabContent
            tabKey={key}
            store={controller}
            active={key === focusedKey}
            chats={false}
            openPullRequest={(target) => {
              // Beside a thread, its pull requests are the thread's own surfaces.
              const ref = controller.threadRef();
              if (!ref) return;
              const { environmentId, ...rest } = target;
              useRightPanelStore
                .getState()
                .openPullRequest(ref, environmentId === ref.environmentId ? rest : target);
            }}
          />,
          host.sectionTabContainer(key),
          key,
        ),
      )}
    </>
  );
}

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

/** A tab's title and icon: an empty tab, a document, or one of T3 Code's surfaces. */
function useTabLabel(tabKey: string): { title: string; icon: ReactNode } {
  const { controller } = useRightPanelHost();
  const panel = usePanel(controller);
  const surface = useSurface(surfaceIdOf(tabKey));
  const document = useSectionTabLabel(tabKey);
  const { resolvedTheme } = useTheme();
  if (!surface && surfaceIdOf(tabKey) === null && document !== null) return document;
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

/** Closes a tab: a surface through ChatView's own close, which may ask first. */
function closeTabOf(controller: PanesController, tabKey: string) {
  const surfaceId = surfaceIdOf(tabKey);
  const ref = controller.threadRef();
  if (surfaceId === null || ref === null) {
    closeSectionTab(controller, tabKey);
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
    {
      label: "Graph",
      icon: Waypoints,
      shortcut: "G",
      available: panel.graphAvailable,
      singleton: "graph",
      invoke: (current) => current.onAddGraph(),
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
  const { controller } = useRightPanelHost();
  const panel = usePanel(controller);
  const [open, setOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const profiles = useBrowserDefaults().profiles;
  const actions = addActions(panel);
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
          if (
            event.key.toLowerCase() === "o" &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setFinding(true);
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
      </MenuPopup>
      {finding ? (
        <PaneDocumentFinder
          onClose={() => setFinding(false)}
          onPick={(key) => controller.update((arrangement) => openTab(arrangement, key, paneId))}
        />
      ) : null}
    </Menu>
  );
}

/**
 * Astrolabe: a wiki's document, opened beside the thread in the pane asked from, as the Wikis
 * finder finds or writes one.
 */
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
 * one T3 Code renders. Nothing while the pane shows the live surface.
 */
function SurfaceOverlay({ leaf, hosting }: { leaf: Leaf; hosting: boolean }) {
  if (isEmptyTab(leaf.active)) return <EmptyTab paneId={leaf.id} />;
  if (surfaceIdOf(leaf.active) !== null && !hosting) return <WaitingSurface tabKey={leaf.active} />;
  return null;
}

/** An empty tab: nothing yet, and T3 Code's own launcher for the surfaces it can open. */
function EmptyTab({ paneId }: { paneId: string }) {
  const { controller } = useRightPanelHost();
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
      onAddGraph={run("Graph")}
      browserAvailable={available("Browser")}
      terminalAvailable={available("Terminal")}
      diffAvailable={available("Diff")}
      filesAvailable={available("Files")}
      pullRequestAvailable={available("Pull request")}
      pullRequestsAvailable={available("Linked pull requests")}
      deviceAvailable={available("Device")}
      graphAvailable={available("Graph")}
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

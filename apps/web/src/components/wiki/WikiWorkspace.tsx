import type { WikiId } from "@t3tools/contracts";
import { Plus, SearchIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { closeTab, focusedPane, isEmptyTab, newTab, surfaceKey } from "~/panes/arrangement";
import { pullRequestSurface } from "~/rightPanelStore";
import {
  PanesHostContext,
  PanesLayoutKeyContext,
  type PaneTabLabelProps,
  type PaneTabs,
  type PanesHost,
} from "~/panes/panesHost";
import { PaneTree } from "~/panes/PaneTree";
import { NO_TAB_SELECTION, useTabSelectionStore } from "~/panes/tabSelection";
import { leaves, type Leaf } from "~/panes/tree";
import { chatTabKey, parseChatTabKey } from "~/sectionTabs/sectionTabs";
import {
  SectionTabContent,
  sectionTabMove,
  showKeyIn,
  useSectionTabLabel,
} from "~/sectionTabs/SectionTabContent";
import { tabHistorySlot } from "~/whichKey/handles";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { WikiSearch } from "./wiki.logic";
import { useWikiEnvironment, useWikiOverviews } from "./wikiEnvironment";
import { WikiFinder } from "./WikiFinder";
import {
  openWikiTab,
  replaceWikiTab,
  showWikiTab,
  stepWikiTab,
  useOpenWikiTabKeys,
  useWikiArrangement,
  useWikiTabHistory,
  wikiPanes,
} from "./wikiPanes";
import { parseWikiTabKey } from "./wikiTabs";
import { closeAskingFirst, useWikiTabLabel, WikiTabView, type WikiTabNav } from "./WikiTabView";

const LAYOUT_KEY = "wikis";

/**
 * The Wikis area: documents in tabs that split, as Obsidian arranges them, filling the main area
 * beside the Wikis sidebar. The arrangement is the device's (see `wikiPanes`). `deepLink` opens a
 * document a link points at, such as one a thread's Graph tab names.
 */
export function WikiWorkspace({
  deepLink,
}: {
  readonly deepLink: (WikiSearch & { readonly wikiId: WikiId }) | null;
}) {
  const [{ host, containerFor, prune }] = useState(createWikiPanesHost);
  const snapshot = useSyncExternalStore(wikiPanes.subscribe, wikiPanes.getSnapshot);

  useDeepLink(deepLink);

  // Astrolabe: the sidebar header's arrows and `navigation.back`/`forward` walk the focused
  // pane's tab in front.
  const { canGoBack, canGoForward } = useWikiTabHistory();
  useEffect(
    () => tabHistorySlot.register({ canGoBack, canGoForward, go: stepWikiTab }),
    [canGoBack, canGoForward],
  );

  // A selection of tabs belongs to the panes it was made in.
  useEffect(() => {
    useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
    const clear = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (useTabSelectionStore.getState().selection.keys.length === 0) return;
      useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
    };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);

  useEffect(() => {
    const save = () => wikiPanes.flush();
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <PanesHostContext.Provider value={host}>
        <PanesLayoutKeyContext.Provider value={LAYOUT_KEY}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
            {snapshot ? <PaneTree snapshot={snapshot} panelMaximized /> : null}
          </div>
          <WikiTabContents containerFor={containerFor} prune={prune} />
        </PanesLayoutKeyContext.Provider>
      </PanesHostContext.Provider>
    </SidebarInset>
  );
}

/**
 * The panes' host. Each open tab renders once into its own container, which the pane showing
 * the tab takes in, shown while the tab is in front. A tab moving between panes moves its
 * container, so an open note keeps its unsaved edits and editor state.
 */
function createWikiPanesHost() {
  const containers = new Map<string, HTMLDivElement>();
  const containerFor = (key: string) => {
    let container = containers.get(key);
    if (!container) {
      container = document.createElement("div");
      container.className = "absolute inset-0 flex min-h-0 min-w-0 flex-col";
      container.dataset.wikiTab = key;
      containers.set(key, container);
    }
    return container;
  };
  const prune = (open: ReadonlySet<string>) => {
    for (const [key, container] of containers) {
      if (open.has(key)) continue;
      container.remove();
      containers.delete(key);
    }
  };
  const tabs: PaneTabs = {
    Label: WikiAreaTabLabel,
    close: closeWikiTab,
    openElsewhere: (tabKey) => sectionTabMove(tabKey, "wikis", closeWikiTab),
    NewTab: NewTabButton,
    place(slot: HTMLElement, leaf: Leaf) {
      for (const key of leaf.tabs) {
        if (isEmptyTab(key)) continue;
        const container = containerFor(key);
        // Moving a node that is already in place would still detach and reattach it.
        if (container.parentNode !== slot) slot.appendChild(container);
        container.style.display = key === leaf.active ? "" : "none";
      }
    },
    Overlay: EmptyTabOverlay,
    reservesTopRight: false,
  };
  const host: PanesHost = { controller: wikiPanes, tabs };
  return { host, containerFor, prune };
}

/**
 * Every open tab's content, each portaled into its container. A chat mounts only while its tab is
 * in front, since a conversation listens to the whole window's keys and pastes.
 */
function WikiTabContents({
  containerFor,
  prune,
}: {
  readonly containerFor: (key: string) => HTMLDivElement;
  readonly prune: (open: ReadonlySet<string>) => void;
}) {
  const keys = useOpenWikiTabKeys();
  const arrangement = useWikiArrangement();
  const fronts = new Set(leaves(arrangement.root).map((leaf) => leaf.active));
  const focusedFront = focusedPane(arrangement).active;
  const shown = keys.filter(
    (key) => !isEmptyTab(key) && (fronts.has(key) || !parseChatTabKey(key)),
  );
  useEffect(() => {
    prune(new Set(shown));
  }, [prune, shown]);
  return (
    <>
      {shown.map((key) => {
        const tab = parseWikiTabKey(key);
        return createPortal(
          tab ? (
            <WikiTabView tabKey={key} tab={tab} nav={wikiAreaNav} />
          ) : (
            <SectionTabContent tabKey={key} store={wikiPanes} active={key === focusedFront} />
          ),
          containerFor(key),
          key,
        );
      })}
    </>
  );
}

/** The Wikis area's way for a document's links: into its own panes, with history. */
const wikiAreaNav: WikiTabNav = {
  open(key, placement = "tab") {
    const tab = parseWikiTabKey(key);
    if (tab) openWikiTab(tab, placement);
    else wikiPanes.update((arrangement) => showKeyIn(arrangement, key, placement));
  },
  replace(from, key, options) {
    const tab = parseWikiTabKey(key);
    if (tab) replaceWikiTab(from, tab, options);
  },
  openThread: (ref) =>
    wikiPanes.update((arrangement) => showKeyIn(arrangement, chatTabKey(ref), "beside")),
  openPullRequest: (target) =>
    wikiPanes.update((arrangement) =>
      showKeyIn(arrangement, surfaceKey(pullRequestSurface(target).id), "beside"),
    ),
};

function WikiAreaTabLabel({ tabKey, children }: PaneTabLabelProps) {
  return children(useWikiAreaTabLabel(tabKey));
}

/** A tab's title and icon: a document's or change request's, or a chat's or pull request's. */
function useWikiAreaTabLabel(tabKey: string): { title: string; icon: ReactNode } {
  const wiki = useWikiTabLabel(tabKey);
  const other = useSectionTabLabel(tabKey);
  return parseWikiTabKey(tabKey) === null && other !== null ? other : wiki;
}

/** Closes a tab, asking first when it holds unsaved edits. */
function closeWikiTab(tabKey: string) {
  closeAskingFirst(tabKey, () => wikiPanes.update((arrangement) => closeTab(arrangement, tabKey)));
}

/** Opens an empty tab in the pane, which offers documents to open there. */
function NewTabButton({ paneId }: { readonly paneId: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="New tab"
            className="shrink-0"
            size="icon-sm"
            variant="ghost-muted"
            onClick={() => wikiPanes.update((arrangement) => newTab(arrangement, paneId))}
          />
        }
      >
        <Plus className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">New tab</TooltipPopup>
    </Tooltip>
  );
}

function EmptyTabOverlay({ leaf }: { readonly leaf: Leaf }) {
  return isEmptyTab(leaf.active) ? <EmptyTab paneId={leaf.id} /> : null;
}

/** An empty tab: one way to put a document in it, found or written. */
function EmptyTab({ paneId }: { readonly paneId: string }) {
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
            <SearchIcon />
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
 * Shows the document a `/wikis/$wikiId` link names, once per link, in the focused pane's tab in
 * front, as a sidebar row's click does.
 */
function useDeepLink(deepLink: (WikiSearch & { readonly wikiId: WikiId }) | null) {
  const { environmentId } = useWikiEnvironment(deepLink?.environmentId);
  const wikiId = deepLink?.wikiId;
  const note = deepLink?.note;
  const changeRequest = deepLink?.changeRequest;
  useEffect(() => {
    if (environmentId === null || wikiId === undefined) return;
    if (note !== undefined) {
      showWikiTab({
        kind: "note",
        environmentId,
        wikiId,
        name: note,
        changeRequestId: changeRequest,
      });
    } else if (changeRequest !== undefined) {
      showWikiTab({
        kind: "change-request",
        environmentId,
        wikiId,
        changeRequestId: changeRequest,
      });
    }
  }, [changeRequest, environmentId, note, wikiId]);
}

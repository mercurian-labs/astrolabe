import type { EnvironmentId, WikiChangeRequestId, WikiId } from "@t3tools/contracts";
import { FilePenLineIcon, FileTextIcon, Plus, SearchIcon, SquareDashed } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { ensureLocalApi } from "~/localApi";
import { closeTab, isEmptyTab, newTab } from "~/panes/arrangement";
import {
  PanesHostContext,
  PanesLayoutKeyContext,
  type PaneTabs,
  type PanesHost,
} from "~/panes/panesHost";
import { PaneTree } from "~/panes/PaneTree";
import { NO_TAB_SELECTION, useTabSelectionStore } from "~/panes/tabSelection";
import type { Leaf } from "~/panes/tree";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { WikiSearch } from "./wiki.logic";
import { WikiChangeRequestView } from "./WikiChangeRequestView";
import { useWikiEnvironment, useWikiOverviews } from "./wikiEnvironment";
import { WikiFinder } from "./WikiFinder";
import { WikiNoteView } from "./WikiNoteView";
import {
  hasUnsavedEdits,
  openWikiTab,
  registerUnsavedCheck,
  replaceWikiTab,
  useOpenWikiTabKeys,
  wikiPanes,
} from "./wikiPanes";
import { parseWikiTabKey, type WikiTab } from "./wikiTabs";

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
    useLabel: useWikiTabLabel,
    close: closeWikiTab,
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

/** Every open tab's content, each portaled into its container. */
function WikiTabContents({
  containerFor,
  prune,
}: {
  readonly containerFor: (key: string) => HTMLDivElement;
  readonly prune: (open: ReadonlySet<string>) => void;
}) {
  const keys = useOpenWikiTabKeys();
  const tabs = useMemo(
    () =>
      keys.flatMap((key) => {
        const tab = parseWikiTabKey(key);
        return tab ? [{ key, tab }] : [];
      }),
    [keys],
  );
  useEffect(() => {
    prune(new Set(keys));
  }, [keys, prune]);
  return (
    <>
      {tabs.map(({ key, tab }) =>
        createPortal(<WikiTabView tabKey={key} tab={tab} />, containerFor(key), key),
      )}
    </>
  );
}

function WikiTabView({ tabKey, tab }: { readonly tabKey: string; readonly tab: WikiTab }) {
  return tab.kind === "note" ? (
    <NoteTab tabKey={tabKey} tab={tab} />
  ) : (
    <ChangeRequestTab tab={tab} />
  );
}

function useChangeRequests(environmentId: EnvironmentId, wikiId: WikiId) {
  const list = useEnvironmentQuery(
    wikiEnvironment.changeRequests({ environmentId, input: { wikiId } }),
  );
  return list.data?.changeRequests ?? null;
}

function NoteTab({
  tabKey,
  tab,
}: {
  readonly tabKey: string;
  readonly tab: Extract<WikiTab, { kind: "note" }>;
}) {
  const all = useChangeRequests(tab.environmentId, tab.wikiId);
  const openChangeRequests = useMemo(
    () => (all ?? []).filter((changeRequest) => changeRequest.status === "open"),
    [all],
  );
  const registerUnsaved = useCallback(
    (check: () => boolean) => registerUnsavedCheck(tabKey, check),
    [tabKey],
  );
  return (
    <WikiNoteView
      environmentId={tab.environmentId}
      wikiId={tab.wikiId}
      name={tab.name}
      changeRequestId={tab.changeRequestId}
      openChangeRequests={openChangeRequests}
      onOpenNote={(name) => {
        const next: WikiTab = { ...tab, name };
        // A link opens in place, as in Obsidian, unless that would drop unsaved edits.
        if (hasUnsavedEdits(tabKey)) openWikiTab(next);
        else replaceWikiTab(tabKey, next);
      }}
      onSaved={(savedTo: WikiChangeRequestId) => {
        // Saved from main, the note now reads inside the change request it was saved to.
        if (savedTo !== tab.changeRequestId) {
          replaceWikiTab(tabKey, { ...tab, changeRequestId: savedTo });
        }
      }}
      registerUnsaved={registerUnsaved}
    />
  );
}

function ChangeRequestTab({ tab }: { readonly tab: Extract<WikiTab, { kind: "change-request" }> }) {
  const all = useChangeRequests(tab.environmentId, tab.wikiId);
  const status = all?.find((entry) => entry.changeRequestId === tab.changeRequestId)?.status;
  return (
    <WikiChangeRequestView
      environmentId={tab.environmentId}
      wikiId={tab.wikiId}
      changeRequestId={tab.changeRequestId}
      onOpenNote={(name) =>
        // An open change request's files read inside it; a merged or closed one's from main.
        openWikiTab({
          kind: "note",
          environmentId: tab.environmentId,
          wikiId: tab.wikiId,
          name,
          changeRequestId: status === "open" ? tab.changeRequestId : undefined,
        })
      }
    />
  );
}

/** A tab's title and icon: a note's name, or a change request's title. */
function useWikiTabLabel(tabKey: string): { title: string; icon: ReactNode } {
  const tab = parseWikiTabKey(tabKey);
  const changeRequests = useEnvironmentQuery(
    tab?.kind === "change-request"
      ? wikiEnvironment.changeRequests({
          environmentId: tab.environmentId,
          input: { wikiId: tab.wikiId },
        })
      : null,
  );
  if (!tab) return { title: "New tab", icon: <SquareDashed className="size-3 shrink-0" /> };
  if (tab.kind === "note") {
    return {
      title: tab.name,
      icon:
        tab.changeRequestId === undefined ? (
          <FileTextIcon className="size-3.5 shrink-0" />
        ) : (
          <FilePenLineIcon className="size-3.5 shrink-0" />
        ),
    };
  }
  const title =
    changeRequests.data?.changeRequests.find(
      (entry) => entry.changeRequestId === tab.changeRequestId,
    )?.title ?? "Change request";
  return { title, icon: <PullRequestGlyph.pullRequest className="size-3.5 shrink-0" /> };
}

/** Closes a tab, asking first when it holds unsaved edits. */
function closeWikiTab(tabKey: string) {
  const close = () => wikiPanes.update((arrangement) => closeTab(arrangement, tabKey));
  if (!hasUnsavedEdits(tabKey)) {
    close();
    return;
  }
  const tab = parseWikiTabKey(tabKey);
  void ensureLocalApi()
    .dialogs.confirm(
      `Close ${tab?.kind === "note" ? tab.name : "this tab"}? Your unsaved edits will be lost.`,
      { variant: "destructive" },
    )
    .then((confirmed) => {
      if (confirmed) close();
    });
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

/** Opens the document a `/wikis/$wikiId` link names, once per link. */
function useDeepLink(deepLink: (WikiSearch & { readonly wikiId: WikiId }) | null) {
  const { environmentId } = useWikiEnvironment(deepLink?.environmentId);
  const wikiId = deepLink?.wikiId;
  const note = deepLink?.note;
  const changeRequest = deepLink?.changeRequest;
  useEffect(() => {
    if (environmentId === null || wikiId === undefined) return;
    if (note !== undefined) {
      openWikiTab({
        kind: "note",
        environmentId,
        wikiId,
        name: note,
        changeRequestId: changeRequest,
      });
    } else if (changeRequest !== undefined) {
      openWikiTab({
        kind: "change-request",
        environmentId,
        wikiId,
        changeRequestId: changeRequest,
      });
    }
  }, [changeRequest, environmentId, note, wikiId]);
}

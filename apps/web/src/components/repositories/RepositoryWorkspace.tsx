import { Plus } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { focusedPane, isEmptyTab, newTab } from "~/panes/arrangement";
import {
  PanesHostContext,
  PanesLayoutKeyContext,
  type PaneTabs,
  type PanesHost,
} from "~/panes/panesHost";
import { PaneTree } from "~/panes/PaneTree";
import { NO_TAB_SELECTION, useTabSelectionStore } from "~/panes/tabSelection";
import { leaves, type Leaf } from "~/panes/tree";
import { parseChatTabKey } from "~/sectionTabs/sectionTabs";
import {
  SectionTabContent,
  sectionTabMove,
  useSectionTabLabel,
} from "~/sectionTabs/SectionTabContent";
import { tabHistorySlot } from "~/whichKey/handles";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { closeAskingFirst } from "../wiki/WikiTabView";
import {
  useSectionTabHistory,
  useSectionArrangement,
  useSectionOpenKeys,
} from "~/panes/sectionPanes";
import { repositoryPanes } from "./repositoryPanes";
import { parseRepositoryTabKey } from "./repositoryTabs";
import { RepositoryTabView, useRepositoryTabLabel } from "./RepositoryTabView";

const LAYOUT_KEY = "repositories";

/**
 * Astrolabe: the Repositories area: files and changes in tabs that split, as the Wikis area's
 * documents do, beside the Repositories sidebar. The arrangement is the device's
 * (`repositoryPanes`); chats, documents and pull requests can stand beside the files.
 */
export function RepositoryWorkspace() {
  const [{ host, containerFor, prune }] = useState(createRepositoryPanesHost);
  const arrangement = useSectionArrangement(repositoryPanes);
  const snapshot = useMemo(() => ({ arrangement, hostPaneId: null }), [arrangement]);

  const { canGoBack, canGoForward } = useSectionTabHistory(repositoryPanes);
  useEffect(
    () => tabHistorySlot.register({ canGoBack, canGoForward, go: repositoryPanes.step }),
    [canGoBack, canGoForward],
  );

  useEffect(() => {
    useTabSelectionStore.getState().change(() => NO_TAB_SELECTION);
  }, []);

  useEffect(() => {
    const save = () => repositoryPanes.store.flush();
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
            <PaneTree snapshot={snapshot} panelMaximized />
          </div>
          <RepositoryTabContents containerFor={containerFor} prune={prune} />
        </PanesLayoutKeyContext.Provider>
      </PanesHostContext.Provider>
    </SidebarInset>
  );
}

/** The panes' host: each open tab renders once into its own container, as in the Wikis area. */
function createRepositoryPanesHost() {
  const containers = new Map<string, HTMLDivElement>();
  const containerFor = (key: string) => {
    let container = containers.get(key);
    if (!container) {
      container = document.createElement("div");
      container.className = "absolute inset-0 flex min-h-0 min-w-0 flex-col";
      container.dataset.repositoryTab = key;
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
    useLabel: useRepositoryAreaTabLabel,
    close: closeRepositoryTab,
    openElsewhere: (tabKey) => sectionTabMove(tabKey, "repositories", closeRepositoryTab),
    NewTab: NewTabButton,
    place(slot: HTMLElement, leaf: Leaf) {
      for (const key of leaf.tabs) {
        if (isEmptyTab(key)) continue;
        const container = containerFor(key);
        if (container.parentNode !== slot) slot.appendChild(container);
        container.style.display = key === leaf.active ? "" : "none";
      }
    },
    Overlay: EmptyTabOverlay,
    reservesTopRight: false,
  };
  const host: PanesHost = { controller: repositoryPanes.store, tabs };
  return { host, containerFor, prune };
}

/** Every open tab's content, each portaled into its container; a chat only while in front. */
function RepositoryTabContents({
  containerFor,
  prune,
}: {
  readonly containerFor: (key: string) => HTMLDivElement;
  readonly prune: (open: ReadonlySet<string>) => void;
}) {
  const keys = useSectionOpenKeys(repositoryPanes);
  const arrangement = useSectionArrangement(repositoryPanes);
  const fronts = useMemo(
    () => new Set(leaves(arrangement.root).map((leaf) => leaf.active)),
    [arrangement],
  );
  const focusedFront = focusedPane(arrangement).active;
  const shown = useMemo(
    () => keys.filter((key) => !isEmptyTab(key) && (fronts.has(key) || !parseChatTabKey(key))),
    [fronts, keys],
  );
  useEffect(() => {
    prune(new Set(shown));
  }, [prune, shown]);
  return (
    <>
      {shown.map((key) => {
        const tab = parseRepositoryTabKey(key);
        return createPortal(
          tab ? (
            <RepositoryTabView tabKey={key} tab={tab} />
          ) : (
            <SectionTabContent
              tabKey={key}
              store={repositoryPanes.store}
              active={key === focusedFront}
            />
          ),
          containerFor(key),
          key,
        );
      })}
    </>
  );
}

function useRepositoryAreaTabLabel(tabKey: string): { title: string; icon: ReactNode } {
  const repository = useRepositoryTabLabel(tabKey);
  const other = useSectionTabLabel(tabKey);
  return repository ?? other ?? { title: "New tab", icon: null };
}

function closeRepositoryTab(tabKey: string) {
  closeAskingFirst(tabKey, () => repositoryPanes.close(tabKey));
}

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
            onClick={() =>
              repositoryPanes.store.update((arrangement) => newTab(arrangement, paneId))
            }
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
  return isEmptyTab(leaf.active) ? (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No file open</EmptyTitle>
        <EmptyDescription>
          Open a file from the sidebar, or search for one by name with the sidebar's search.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : null;
}

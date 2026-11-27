import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { FileTextIcon } from "lucide-react";
import { useContext, useEffect } from "react";

import { activateTab, closeTab, replaceTab } from "~/panes/arrangement";
import { PanesHostContext, type PaneArrangementStore, type PaneTabLabel } from "~/panes/panesHost";
import { openNear } from "~/panes/placement";
import { leafWithTab } from "~/panes/tree";
import { workspace } from "~/panes/workspace";
import { projectRootsEnvironment } from "~/state/projectRoots";
import { useEnvironmentQuery } from "~/state/query";
import { wikiEnvironment } from "~/state/wiki";
import { repositoryTabKey } from "../repositories/repositoryTabs";
import { Empty } from "../ui/empty";
import { Spinner } from "../ui/spinner";
import { legacyWikiRoot, projectRootFileTab } from "./projectRootFileTab";
import { documentTitle } from "./wiki.logic";
import { parseWikiTabKey, wikiTabKey, type WikiTab } from "./wikiTabs";

/**
 * Opens a document named by its root's wiki id: beside the chat, or in Projects where there is no
 * pane. It lands as its Projects file tab (`LegacyWikiTab`).
 */
export function useOpenWikiTab() {
  const panes = useContext(PanesHostContext);
  const navigate = useNavigate();
  return (tab: WikiTab) => {
    const key = wikiTabKey(tab);
    if (panes === null) {
      workspace.show(key);
      void navigate({ to: "/repositories" });
      return;
    }
    panes.controller.update((arrangement) =>
      leafWithTab(arrangement.root, key)
        ? activateTab(arrangement, key)
        : openNear(arrangement, key, arrangement.focused),
    );
  };
}

/** A tab the Wikis section saved, as it reads until it becomes its Projects tab; null for any other. */
export function useLegacyWikiTabLabel(key: string): PaneTabLabel | null {
  const gt = useGT();
  const tab = parseWikiTabKey(key);
  if (tab === null) return null;
  return {
    title: tab.kind === "note" ? documentTitle(tab.file) : gt("Opening…"),
    icon: <FileTextIcon className="size-3.5 shrink-0" />,
  };
}

/**
 * Astrolabe: a tab the Wikis section saved, or an old link opened. A document becomes its file tab
 * in Projects once the server says which project root the wiki became; a change request, or a
 * document it can't place, closes.
 */
export function LegacyWikiTab({
  tabKey,
  tab,
  store,
}: {
  readonly tabKey: string;
  readonly tab: WikiTab;
  readonly store: PaneArrangementStore;
}) {
  const { environmentId, wikiId } = tab;
  const note = tab.kind === "note";
  const known = legacyWikiRoot(wikiId, null);
  const index = useEnvironmentQuery(
    note && known === null ? wikiEnvironment.index({ environmentId, input: { wikiId } }) : null,
  );
  const root = legacyWikiRoot(wikiId, index.data?.wikiId ?? null);
  const roots = useEnvironmentQuery(
    root === null
      ? null
      : projectRootsEnvironment.list({ environmentId, input: { projectId: root.projectId } }),
  );
  const fileTab =
    note && root !== null && roots.data !== null
      ? projectRootFileTab({
          environmentId,
          projectId: root.projectId,
          roots: roots.data.roots,
          rootKey: root.rootKey,
          file: tab.file,
        })
      : null;
  const next = fileTab === null ? null : repositoryTabKey(fileTab);
  const settled =
    !note ||
    index.error !== null ||
    (index.data !== null && root === null) ||
    roots.error !== null ||
    roots.data !== null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a tab saved by the old Wikis section becomes its Projects tab once the server places it
  useEffect(() => {
    if (!settled) return;
    store.update((arrangement) => {
      if (next === null) return closeTab(arrangement, tabKey);
      if (leafWithTab(arrangement.root, next)) {
        return activateTab(closeTab(arrangement, tabKey), next);
      }
      return replaceTab(arrangement, tabKey, next);
    });
  }, [settled, next, store, tabKey]);

  return (
    <Empty>
      <Spinner size="md" tone="muted" />
    </Empty>
  );
}

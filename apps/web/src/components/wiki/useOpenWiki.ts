import type { EnvironmentId, WikiId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useContext } from "react";

import { activateTab, openBeside } from "~/panes/arrangement";
import { PanesHostContext } from "~/panes/panesHost";
import { leafWithTab } from "~/panes/tree";

import { storeWikiFilter } from "./wikiFilter";
import { showWikiTab } from "./wikiPanes";
import { type WikiTab, wikiScopeKey, wikiTabKey } from "./wikiTabs";

/** Opens the Wikis section narrowed to one wiki. */
export function useOpenWiki() {
  const navigate = useNavigate();
  return (environmentId: EnvironmentId, wikiId: WikiId) => {
    storeWikiFilter({
      wikis: [wikiScopeKey(environmentId, wikiId)],
      changed: false,
      hidden: [],
    });
    return navigate({ to: "/wikis" });
  };
}

/** Opens a wiki tab from a thread: beside the chat, or in the Wikis section where there's no pane. */
export function useOpenWikiTab() {
  const panes = useContext(PanesHostContext);
  const navigate = useNavigate();
  return (tab: WikiTab) => {
    if (panes === null) {
      showWikiTab(tab);
      void navigate({ to: "/wikis" });
      return;
    }
    const key = wikiTabKey(tab);
    panes.controller.update((arrangement) =>
      leafWithTab(arrangement.root, key)
        ? activateTab(arrangement, key)
        : openBeside(arrangement, key, arrangement.focused, "right"),
    );
  };
}

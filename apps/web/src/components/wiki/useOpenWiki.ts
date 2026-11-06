import type { EnvironmentId, WikiId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { storeWikiFilter } from "./wikiFilter";
import { wikiScopeKey } from "./wikiTabs";

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

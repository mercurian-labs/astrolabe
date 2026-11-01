import type { WikiId } from "@t3tools/contracts";
import { useEffect } from "react";

import type { WikiSearch } from "./wiki.logic";
import { useWikiEnvironment } from "./wikiEnvironment";
import { showWikiTab } from "./wikiPanes";

/**
 * Shows the document a `/wikis/$wikiId` link names, once per link, in the focused pane's tab in
 * front, as a sidebar row's click does. Renders nothing: the shared panes show it.
 */
export function WikiDeepLink({
  deepLink,
}: {
  readonly deepLink: WikiSearch & { readonly wikiId: WikiId };
}) {
  const { environmentId } = useWikiEnvironment(deepLink.environmentId);
  const { wikiId, note, changeRequest } = deepLink;
  useEffect(() => {
    if (environmentId === null) return;
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
  return null;
}

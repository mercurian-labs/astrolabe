import type { ProjectRootId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { documentFile, parseWikiSearch } from "../components/wiki/wiki.logic";
import { useWikiEnvironment } from "../components/wiki/wikiEnvironment";
import { wikiTabKey } from "../components/wiki/wikiTabs";
import { workspace } from "../panes/workspace";

/**
 * Astrolabe: an old link to a wiki's document, kept for one release. It lands on Projects with the
 * document's tab open, which becomes its Projects file once the server says where the wiki went
 * (`LegacyWikiTab`); a change request's link lands on Projects alone.
 */
export const Route = createFileRoute("/_chat/wikis_/$wikiId")({
  validateSearch: parseWikiSearch,
  component: LegacyWikiLink,
});

function LegacyWikiLink() {
  const { wikiId } = Route.useParams();
  const { environmentId: requested, note } = Route.useSearch();
  const { environmentId } = useWikiEnvironment(requested);
  const navigate = useNavigate();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an old link opens its document once, then leaves for Projects
  useEffect(() => {
    if (note !== undefined) {
      // Its server may still be connecting; the document waits for it.
      if (environmentId === null) return;
      workspace.show(
        wikiTabKey({
          kind: "note",
          environmentId,
          wikiId: wikiId as ProjectRootId,
          file: documentFile(note),
          changeRequestId: undefined,
        }),
      );
    }
    void navigate({ to: "/repositories", replace: true });
  }, [environmentId, navigate, note, wikiId]);
  return null;
}

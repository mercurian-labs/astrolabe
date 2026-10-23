import type { WikiId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { parseWikiSearch } from "../components/wiki/wiki.logic";
import { WikiWorkspace } from "../components/wiki/WikiWorkspace";

/** A link to a wiki's document or change request: it opens as a tab in the Wikis area. */
export const Route = createFileRoute("/_chat/wikis_/$wikiId")({
  validateSearch: parseWikiSearch,
  component: WikiRouteView,
});

function WikiRouteView() {
  const { wikiId } = Route.useParams();
  const search = Route.useSearch();
  return <WikiWorkspace deepLink={{ ...search, wikiId: wikiId as WikiId }} />;
}

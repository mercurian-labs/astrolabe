import type { WikiId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { parseWikiSearch } from "../components/wiki/wiki.logic";
import { WikiDeepLink } from "../components/wiki/WikiDeepLink";

/** A link to a wiki's document or change request: it opens as a tab of the shared panes. */
export const Route = createFileRoute("/_chat/wikis_/$wikiId")({
  validateSearch: parseWikiSearch,
  component: WikiRouteView,
});

function WikiRouteView() {
  const { wikiId } = Route.useParams();
  const search = Route.useSearch();
  return <WikiDeepLink deepLink={{ ...search, wikiId: wikiId as WikiId }} />;
}

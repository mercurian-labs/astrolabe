import { createFileRoute } from "@tanstack/react-router";

import { WikisSettings } from "../components/settings/WikisSettings";

export const Route = createFileRoute("/_chat/settings/wikis")({
  // The wiki whose page is open, by its scope key.
  validateSearch: (search: Record<string, unknown>): { wiki?: string } =>
    typeof search.wiki === "string" ? { wiki: search.wiki } : {},
  component: WikisSettingsRoute,
});

function WikisSettingsRoute() {
  const { wiki } = Route.useSearch();
  return <WikisSettings wikiKey={wiki} />;
}

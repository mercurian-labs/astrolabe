import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";

import { storedChoice } from "../projects/storedChoice";
import { wikiScopeKey } from "./wikiTabs";

/**
 * Astrolabe: the wiki a section's list is narrowed to (its `wikiScopeKey`), or none, kept on the
 * device. Change Requests keeps its own, so narrowing Wikis (`wikiFilter`) never narrows it.
 */
function wikiScopeStore(storageKey: string) {
  const store = storedChoice<string | null>({
    storageKey,
    fallback: null,
    parse: (stored) => stored,
    serialize: (scope) => scope ?? "",
  });
  /** The scope, read as none once its wiki is gone, and the setter. */
  const useScope = (overviews: ReadonlyArray<WikiOverview>) => {
    const stored = store.useValue();
    const exists =
      stored !== null &&
      overviews.some(
        (overview) => wikiScopeKey(overview.environmentId, overview.wiki.wikiId) === stored,
      );
    return [exists ? stored : null, store.set] as const;
  };
  return { ...store, useScope };
}

/** The wiki the Change Requests section's project filter picked. */
export const changeRequestWikiScope = wikiScopeStore("astrolabe:change-request-wiki-scope:v1");

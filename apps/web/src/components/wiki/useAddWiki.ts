import type { EnvironmentId, WikiSummary } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";

import { wikiEnvironment } from "~/state/wiki";
import { type WikiCommandOutcome, useWikiCommand } from "./wikiEnvironment";
import { useOpenWiki } from "./useOpenWiki";
import { wikiScopeKey } from "./wikiTabs";

/**
 * Astrolabe: the last step of the palette's add flow when it adds a wiki. Registers a folder or
 * creates an empty wiki, then opens the Wikis section narrowed to it, or its page when added from
 * Settings. Resolves to the wiki, or null when it failed.
 */
export function useAddWiki() {
  const router = useRouter();
  const openWiki = useOpenWiki();
  const register = useWikiCommand(wikiEnvironment.register, "Failed to add wiki");
  const create = useWikiCommand(wikiEnvironment.create, "Failed to create wiki");
  const show = async (
    environmentId: EnvironmentId,
    outcome: WikiCommandOutcome<WikiSummary>,
  ): Promise<WikiSummary | null> => {
    if (!outcome.ok) return null;
    const { wikiId } = outcome.value;
    await (router.state.location.pathname === "/settings/wikis"
      ? router.navigate({
          to: "/settings/wikis",
          search: { wiki: wikiScopeKey(environmentId, wikiId) },
        })
      : openWiki(environmentId, wikiId));
    return outcome.value;
  };
  return {
    register: async (environmentId: EnvironmentId, root: string) =>
      show(environmentId, await register({ environmentId, input: { root } })),
    create: async (environmentId: EnvironmentId, name: string) =>
      show(environmentId, await create({ environmentId, input: { name } })),
  };
}

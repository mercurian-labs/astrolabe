import { useMemo } from "react";

import { useWorkspaceState } from "../../state/workspace";
import { wikiCheckouts, type WikiCheckouts } from "../projects/threadsProjectFilter";
import { useWikiOverviews } from "./useWikiOverviews";

/** Astrolabe: the connected servers' wikis by their checkout, to list a wiki as the wiki. */
export function useWikiCheckouts(): WikiCheckouts {
  const { environments } = useWorkspaceState();
  const environmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connectionState === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const { overviews } = useWikiOverviews(environmentIds);
  return useMemo(() => wikiCheckouts(overviews), [overviews]);
}

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { MercurianCommitId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useForkLine } from "../../state/mercurian";
import { navigateToThreadRoute } from "../../threadRoutes";
import { useThreadSpace } from "./ThreadSpaceContext";

export function useForkHere(): (input: {
  parentCommitId: MercurianCommitId;
  seedText: string;
}) => Promise<void> {
  const router = useRouter();
  const { environmentId, planId } = useThreadSpace();
  const forkLine = useForkLine();

  return useCallback(
    async (input) => {
      if (planId === null) return;
      const forked = await forkLine({ planId, parentCommitId: input.parentCommitId });
      if (forked === null) return;

      const threadRef = scopeThreadRef(environmentId, forked.threadId);
      useComposerDraftStore.getState().setPrompt(threadRef, input.seedText);
      await navigateToThreadRoute(router, { kind: "server", threadRef, planId });
    },
    [environmentId, forkLine, planId, router],
  );
}

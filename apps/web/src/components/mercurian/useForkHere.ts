import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { recordedCheckpointForkInput } from "@t3tools/client-runtime/state/threads";
import type { MercurianCommitId, PlanCheckpointRecord } from "@t3tools/contracts";
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

/**
 * Continue from a captured checkpoint. The new line's conversation boundary and
 * restored files are both this checkpoint, never a later reply or the current
 * slot. Nothing is seeded into the composer: this is not a query edit.
 */
export function useContinueFromCheckpoint(): (record: PlanCheckpointRecord) => Promise<void> {
  const router = useRouter();
  const { environmentId, planId } = useThreadSpace();
  const forkLine = useForkLine();

  return useCallback(
    async (record) => {
      if (planId === null || record.planId !== planId) return;
      const forked = await forkLine(recordedCheckpointForkInput(record));
      if (forked === null) return;
      await navigateToThreadRoute(router, {
        kind: "server",
        threadRef: scopeThreadRef(environmentId, forked.threadId),
        planId,
      });
    },
    [environmentId, forkLine, planId, router],
  );
}

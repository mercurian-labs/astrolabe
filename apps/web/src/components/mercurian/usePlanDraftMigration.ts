import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { MercurianProject } from "@t3tools/contracts";
import { useEffect } from "react";

import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { hasExplicitComposerModelSelection } from "../../lib/chatThreadActions";
import { usePlanDraftStore } from "../../planDraftStore";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { usePlanningModel } from "../../state/mercurianWorkspace";
import { resolvePlanDraftMigrations } from "./planDraftMigration.logic";

export function usePlanDraftMigration(projects: ReadonlyArray<MercurianProject>): void {
  const environmentId = usePrimaryEnvironmentId();
  const draftsById = usePlanDraftStore((state) => state.draftsById);
  const providers = usePlanningModel().providers;

  useEffect(() => {
    if (environmentId === null) return;
    const migrations = resolvePlanDraftMigrations({ draftsById, projects, providers });
    for (const migration of migrations) {
      const draftId = DraftId.make(migration.draft.draftId);
      const composerStore = useComposerDraftStore.getState();
      composerStore.setProjectDraftThreadId(
        scopeProjectRef(environmentId, migration.orchestrationProjectId),
        draftId,
        { createdAt: migration.draft.createdAt },
      );
      const existingDraft = composerStore.getComposerDraft(draftId);
      if (!composerDraftHasUserContent(existingDraft)) {
        composerStore.setPrompt(draftId, migration.draft.text);
      }
      if (migration.modelSelection !== null && !hasExplicitComposerModelSelection(existingDraft)) {
        composerStore.setModelSelection(draftId, migration.modelSelection, {
          explicit: true,
          replaceOptions: true,
        });
      }
      usePlanDraftStore.getState().discardDraft(migration.draft.draftId);
    }
  }, [draftsById, environmentId, projects, providers]);
}

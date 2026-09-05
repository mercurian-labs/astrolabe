import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { MercurianProject } from "@t3tools/contracts";
import { useEffect } from "react";

import {
  composerDraftHasUserContent,
  DraftId,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { hasExplicitComposerModelSelection } from "../../lib/chatThreadActions";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { usePlanningModel } from "../../state/mercurianWorkspace";
import {
  readLegacyPlanDrafts,
  removeMigratedLegacyPlanDrafts,
  resolvePlanDraftMigrations,
} from "./planDraftMigration.logic";

export function usePlanDraftMigration(projects: ReadonlyArray<MercurianProject>): void {
  const environmentId = usePrimaryEnvironmentId();
  const providers = usePlanningModel().providers;

  useEffect(() => {
    if (environmentId === null) return;
    const draftsById = readLegacyPlanDrafts(window.localStorage);
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
    }
    if (migrations.length === 0) return;
    const migratedDraftIds = new Set(migrations.map(({ draft }) => draft.draftId));
    removeMigratedLegacyPlanDrafts(window.localStorage, migratedDraftIds);
  }, [environmentId, projects, providers]);
}

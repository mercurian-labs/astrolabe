import type {
  MercurianStartCodingSessionInput,
  ModelSelection,
  ServerProvider,
  UnifiedSettings,
} from "@t3tools/contracts";

import type { CodingSessionDraft } from "../../codingSessionDraftStore";
import { getAppModelOptionsForInstance } from "../../modelSelection";
import { sortModelsForProviderInstance } from "../../modelOrdering";
import { deriveProviderInstanceEntries } from "../../providerInstances";

export const CODING_SESSION_RUNTIME_MODES = [
  { value: "approval-required", label: "Supervised" },
  { value: "auto-accept-edits", label: "Auto-accept edits" },
  { value: "full-access", label: "Full access" },
] as const;

export function codingSessionModelGroups(
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
) {
  return deriveProviderInstanceEntries(providers)
    .filter((entry) => entry.isAvailable && entry.enabled && entry.installed)
    .map((entry) => ({
      instance: entry,
      models: sortModelsForProviderInstance(getAppModelOptionsForInstance(settings, entry)),
    }))
    .filter((group) => group.models.length > 0);
}

export function seedCodingSessionModelSelection(
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
  sticky?: ModelSelection,
): ModelSelection | null {
  const groups = codingSessionModelGroups(providers, settings);
  if (sticky !== undefined) {
    const group = groups.find((candidate) => candidate.instance.instanceId === sticky.instanceId);
    if (group?.models.some((model) => model.slug === sticky.model)) return sticky;
  }
  const first = groups[0];
  const model = first?.models[0];
  return first === undefined || model === undefined
    ? null
    : { instanceId: first.instance.instanceId, model: model.slug };
}

export function createCodingSessionDraft(input: {
  readonly draftId: string;
  readonly planId: string;
  readonly parentCommitId: string;
  readonly modelSelection: ModelSelection;
  readonly createdAt: string;
}): CodingSessionDraft {
  return {
    draftId: input.draftId,
    planId: input.planId,
    parentCommitId: input.parentCommitId,
    runtimeMode: "full-access",
    modelSelection: input.modelSelection,
    createdAt: input.createdAt,
  };
}

export function startCodingSessionPayload(
  draft: CodingSessionDraft,
): MercurianStartCodingSessionInput {
  return {
    planId: draft.planId as MercurianStartCodingSessionInput["planId"],
    parentCommitId: draft.parentCommitId as MercurianStartCodingSessionInput["parentCommitId"],
    runtimeMode: draft.runtimeMode,
    modelSelection: draft.modelSelection,
  };
}

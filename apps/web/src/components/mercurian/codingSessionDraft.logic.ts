import type {
  MercurianStartCodingSessionInput,
  ModelSelection,
  PlanImplementReady,
  ServerProvider,
  UnifiedSettings,
  VcsRef,
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

export function localBranchOptions(refs: ReadonlyArray<VcsRef>): ReadonlyArray<VcsRef> {
  return refs.filter((ref) => ref.isRemote !== true);
}

export function seedBaseRef(refs: ReadonlyArray<VcsRef>): string {
  const local = localBranchOptions(refs);
  return local.find((ref) => ref.isDefault)?.name ?? local.find((ref) => ref.current)?.name ?? "";
}

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
  readonly ready: PlanImplementReady;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly modelSelection: ModelSelection;
  readonly createdAt: string;
}): CodingSessionDraft {
  return {
    draftId: input.draftId,
    planId: input.planId,
    parentCommitId: input.ready.commitId,
    repositoryId: input.ready.repositoryId,
    repositoryName: input.ready.repositoryName,
    baseRef: input.baseRef,
    startFromOrigin: input.startFromOrigin,
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
    repositoryId: draft.repositoryId as MercurianStartCodingSessionInput["repositoryId"],
    baseRef: draft.baseRef,
    startFromOrigin: draft.startFromOrigin,
    runtimeMode: draft.runtimeMode,
    modelSelection: draft.modelSelection,
  };
}

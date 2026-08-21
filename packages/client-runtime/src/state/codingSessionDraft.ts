import type {
  MercurianStartCodingSessionInput,
  ModelSelection,
  PlanImplementReady,
  VcsRef,
} from "@t3tools/contracts";

export interface CodingSessionDraft {
  readonly draftId: string;
  readonly planId: string;
  readonly parentCommitId: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly runtimeMode: "approval-required" | "auto-accept-edits" | "full-access";
  readonly modelSelection: ModelSelection;
  readonly createdAt: string;
}

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

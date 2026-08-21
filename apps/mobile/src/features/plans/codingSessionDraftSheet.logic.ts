import type { CodingSessionDraft } from "@t3tools/client-runtime/state/coding-session-draft";
import type { ModelOption } from "../../lib/modelOptions";
import type { ModelSelection } from "@t3tools/contracts";

export const NO_SESSION_MODEL_REASON =
  "Install and enable an agent before starting a coding session.";

export function seedSessionModelSelection(
  options: ReadonlyArray<ModelOption>,
  sticky?: ModelSelection,
): ModelSelection | null {
  const stickyOption = options.find(
    (option) =>
      option.selection.instanceId === sticky?.instanceId && option.selection.model === sticky.model,
  );
  return (
    (
      stickyOption ??
      options.find((option) => option.isDefault && !option.isLegacy) ??
      options.find((option) => !option.isLegacy) ??
      options[0]
    )?.selection ?? null
  );
}

export function codingSessionStartDisabledReason(input: {
  readonly baseRef: string;
  readonly modelSelection: ModelSelection | null;
  readonly starting: boolean;
}): string | null {
  if (input.starting) return "Starting coding session…";
  if (input.modelSelection === null) return NO_SESSION_MODEL_REASON;
  if (input.baseRef.trim().length === 0) return "Choose a base branch before starting.";
  return null;
}

export function buildMobileCodingSessionDraft(input: {
  readonly planId: string;
  readonly parentCommitId: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly baseRef: string;
  readonly startFromOrigin: boolean;
  readonly runtimeMode: CodingSessionDraft["runtimeMode"];
  readonly modelSelection: ModelSelection;
}): CodingSessionDraft {
  return {
    draftId: `${input.planId}:${input.parentCommitId}`,
    planId: input.planId,
    parentCommitId: input.parentCommitId,
    repositoryId: input.repositoryId,
    repositoryName: input.repositoryName,
    baseRef: input.baseRef,
    startFromOrigin: input.startFromOrigin,
    runtimeMode: input.runtimeMode,
    modelSelection: input.modelSelection,
    createdAt: new Date().toISOString(),
  };
}

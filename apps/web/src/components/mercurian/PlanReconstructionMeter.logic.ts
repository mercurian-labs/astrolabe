import {
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type PlanReconstructionMeasure,
  type PlanningModelResolution,
  type PlanningModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { getProviderOptionCurrentValue, getProviderOptionDescriptors } from "@t3tools/shared/model";

/** Labels only; prompt elision itself remains exact character arithmetic. */
export const APPROXIMATE_CHARS_PER_TOKEN = 4;

export interface PlanReconstructionMeterState {
  readonly fillFraction: number;
  readonly approxUsedTokens: number;
  readonly approxMaxTokens: number | null;
  readonly willElide: boolean;
}

function contextWindowTokens(input: {
  readonly selection: PlanningModelSelection;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly resolution: Extract<PlanningModelResolution, { readonly _tag: "resolved" }>;
}): number | null {
  const provider = input.providers.find(
    (candidate) => candidate.instanceId === input.resolution.instanceId,
  );
  const model = provider?.models.find((candidate) => candidate.slug === input.resolution.model);
  const descriptors = getProviderOptionDescriptors({
    caps: model?.capabilities ?? {},
    selections: input.selection.options,
  });
  const descriptor = descriptors.find(
    (candidate) => candidate.id === "contextWindow" && candidate.type === "select",
  );
  const raw = getProviderOptionCurrentValue(descriptor);
  if (typeof raw !== "string") return null;

  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(raw.trim().replaceAll(",", ""));
  if (match === null) return null;
  const value = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1;
  const tokens = value * multiplier;
  return Number.isFinite(tokens) && tokens > 0 ? tokens : null;
}

/** Pure state for the position-derived gauge; draft changes require no read. */
export function reconstructionMeterState(input: {
  readonly measure: PlanReconstructionMeasure | null;
  readonly draftChars: number;
  readonly selection: PlanningModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly resolution: PlanningModelResolution;
}): PlanReconstructionMeterState | null {
  if (input.measure === null || input.selection === null || input.resolution._tag !== "resolved") {
    return null;
  }

  const draftChars = Math.max(0, input.draftChars);
  const transcriptChars = Math.max(0, input.measure.transcriptChars);
  const fixedReservedChars = Math.max(0, input.measure.fixedReservedChars);
  const usedChars = transcriptChars + fixedReservedChars + draftChars;
  const declaredWindowTokens = contextWindowTokens({
    selection: input.selection,
    providers: input.providers,
    resolution: input.resolution,
  });
  const declaredWindowChars =
    declaredWindowTokens === null ? null : declaredWindowTokens * APPROXIMATE_CHARS_PER_TOKEN;
  const boundChars = Math.min(
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
    declaredWindowChars ?? PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  );
  const transcriptBudget = Math.max(
    0,
    PROVIDER_SEND_TURN_MAX_INPUT_CHARS - fixedReservedChars - draftChars,
  );

  return {
    fillFraction: Math.max(0, Math.min(1, usedChars / boundChars)),
    approxUsedTokens: Math.ceil(usedChars / APPROXIMATE_CHARS_PER_TOKEN),
    approxMaxTokens:
      declaredWindowTokens === null ? null : Math.floor(boundChars / APPROXIMATE_CHARS_PER_TOKEN),
    willElide: input.measure.entryCount > 0 && transcriptChars > transcriptBudget,
  };
}

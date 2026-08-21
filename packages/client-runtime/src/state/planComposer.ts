import {
  type PlanInFlightTurn,
  type PlanStreamItem,
  type PlanningModelResolution,
  type PlanningModelSelection,
  type PlanTurnRefusalReason,
  PROVIDER_DISPLAY_NAMES,
  type ProviderDriverKind,
} from "@t3tools/contracts";

export interface PlanDraftModelChoice {
  readonly directive: PlanningModelSelection;
  readonly atHead: string | null;
}

export function modelChoiceForHead(
  draft: { readonly modelChoice?: PlanDraftModelChoice },
  head: string | null,
): PlanningModelSelection | undefined {
  return draft.modelChoice?.atHead === head ? draft.modelChoice.directive : undefined;
}

export function providerLabel(provider: ProviderDriverKind): string {
  return (
    PROVIDER_DISPLAY_NAMES[provider] ??
    provider
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

/**
 * The send↔stop↔gate state machine, kept pure so the composer component
 * stays a renderer of it.
 *
 * The contract, restated from the design: while this branch's reply streams
 * the send control *is* the stop control — one control, two faces, no
 * queueing — and a reply streaming on another branch never wears it.
 * While the planning model cannot run a turn on this machine, sending is
 * gated with the reason stated — typing stays legal, drafts are drafts.
 */

export type PlanComposerFace = "send" | "stop";

export interface PlanComposerControlState {
  readonly face: PlanComposerFace;
  readonly enabled: boolean;
}

export function resolveComposerControl(input: {
  /** A turn is live on this branch — streaming, or waiting on a question. */
  readonly turnActive: boolean;
  readonly hasContent: boolean;
  readonly isSending: boolean;
  readonly gateBlocked: boolean;
}): PlanComposerControlState {
  if (input.turnActive) return { face: "stop", enabled: true };
  return {
    face: "send",
    enabled: input.hasContent && !input.isSending && !input.gateBlocked,
  };
}

export function planningModelGateNotice(
  selection: PlanningModelSelection | null,
  resolution: PlanningModelResolution,
): string | null {
  switch (resolution._tag) {
    case "resolved":
      return null;
    case "unset":
      return "Choose a model to hear back from the assistant.";
    case "unresolved":
      switch (resolution.reason) {
        case "no-instance":
          return "No instance of this model's provider is available on this machine — choose another model or connect one in Settings.";
        case "not-signed-in": {
          const provider = selection === null ? "the provider" : providerLabel(selection.provider);
          return `Not signed in to ${provider} on this machine — sign in from Settings → Providers to hear back from the assistant.`;
        }
        case "model-unavailable":
          return "This model is not available on this machine's instance — choose another model.";
      }
  }
}

export function turnRefusalNotice(
  selection: PlanningModelSelection | null,
  reason: PlanTurnRefusalReason,
): string {
  switch (reason) {
    case "unset":
      return "The message was sent, but no planning model was chosen — choose one in the picker.";
    case "no-instance":
      return "The message was sent, but no instance of the planning model's provider is available on this machine.";
    case "not-signed-in": {
      const provider = selection === null ? "the provider" : providerLabel(selection.provider);
      return `The message was sent, but ${provider} isn't signed in on this machine.`;
    }
    case "model-unavailable":
      return "The message was sent, but the planning model is not available on this machine.";
    case "turn-active":
      return "The assistant is already replying on this branch.";
  }
}

export function implementFailureNotice(
  reason: Extract<PlanStreamItem, { readonly kind: "implement-failed" }>["reason"],
): string {
  switch (reason) {
    case "stopped":
      return "The implement analysis was stopped; nothing landed.";
    case "provider-error":
      return "The assistant could not finish the implement analysis; nothing landed.";
    case "no-proposal":
    case "invalid-proposal":
      return "The assistant couldn't produce a usable analysis; nothing landed.";
  }
}

export function turnAwaitsInput(turn: PlanInFlightTurn | undefined): boolean {
  return turn?.questions !== undefined && turn.questions.length > 0;
}

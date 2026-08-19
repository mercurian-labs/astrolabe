import type {
  PlanInFlightTurn,
  PlanStreamItem,
  PlanningModelResolution,
  PlanningModelSelection,
  PlanTurnRefusalReason,
} from "@t3tools/contracts";

import { providerLabel } from "./PlanningModel.logic";

/**
 * The send↔stop↔gate state machine, kept pure so the composer component
 * stays a renderer of it.
 *
 * The contract, restated from the design: while a reply streams the send
 * control *is* the stop control — one control, two faces, no queueing.
 * While the planning model cannot run a turn on this machine, sending is
 * gated with the reason stated — typing stays legal, drafts are drafts.
 */

export type PlanComposerFace = "send" | "stop";

export interface PlanComposerControlState {
  readonly face: PlanComposerFace;
  readonly enabled: boolean;
}

export function resolveComposerControl(input: {
  /** A turn is live in this plan — streaming, or waiting on a question. */
  readonly turnActive: boolean;
  readonly hasContent: boolean;
  readonly isSending: boolean;
  readonly gateBlocked: boolean;
}): PlanComposerControlState {
  if (input.turnActive) {
    return { face: "stop", enabled: true };
  }
  return {
    face: "send",
    enabled: input.hasContent && !input.isSending && !input.gateBlocked,
  };
}

/**
 * What the composer says when the displayed planning model cannot run a
 * turn on this machine. `null` means no gate: sending is live.
 *
 * Wording points back to the picker that owns the choice.
 */
export function planningModelGateNotice(
  selection: PlanningModelSelection | null,
  resolution: PlanningModelResolution,
): string | null {
  switch (resolution._tag) {
    case "resolved":
      return null;
    case "unset":
      return "Choose a model to hear back from the assistant.";
    case "unresolved": {
      switch (resolution.reason) {
        case "no-instance":
          return "No instance of this model's provider is available on this machine — choose another model or connect one in Settings.";
        case "not-signed-in": {
          const provider = selection === null ? "the provider" : providerLabel(selection.provider);
          return `Not signed in to ${provider} on this machine — sign in from Settings → Providers to hear back from the assistant.`;
        }
        case "model-unavailable":
          return "This model is not available on this machine's instance — choose another model.";
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

/**
 * The transient notice when a message landed and no reply started. The gate
 * makes these rare; they exist for the window that raced a settings change
 * or another send.
 */
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
      return "The assistant is already replying in this plan.";
    default:
      return "The message was sent, but the assistant could not reply.";
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

/** A turn is waiting on the person exactly while it has a question up. */
export function turnAwaitsInput(turn: PlanInFlightTurn | undefined): boolean {
  return turn?.questions !== undefined && turn.questions.length > 0;
}

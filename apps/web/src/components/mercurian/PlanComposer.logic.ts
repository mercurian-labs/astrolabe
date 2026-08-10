import type {
  PlanInFlightTurn,
  PlanStreamItem,
  PlanningModelResolution,
  PlanTurnRefusalReason,
} from "@t3tools/contracts";

type DerivationFailureReason = Extract<
  PlanStreamItem,
  { readonly kind: "derivation-failed" }
>["reason"];

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
 * What the composer says when the workspace planning model cannot run a
 * turn on this machine. `null` means no gate: sending is live.
 *
 * Wording follows the register M-97's settings row established; the
 * composer's version adds where to fix it, because unlike the settings row
 * it is not already there.
 */
export function planningModelGateNotice(resolution: PlanningModelResolution): string | null {
  switch (resolution._tag) {
    case "resolved":
      return null;
    case "unset":
      return "Choose a planning model in Settings to hear back from the assistant.";
    case "unresolved":
      return resolution.reason === "no-instance"
        ? "No instance of the planning model's provider on this machine — connect one in Settings."
        : "The planning model is not available on this machine's instance — pick another in Settings.";
    default:
      return null;
  }
}

/**
 * The transient notice when a message landed and no reply started. The gate
 * makes these rare; they exist for the window that raced a settings change
 * or another send.
 */
export function turnRefusalNotice(reason: PlanTurnRefusalReason): string {
  switch (reason) {
    case "unset":
      return "The message was sent, but no planning model is set — choose one in Settings.";
    case "no-instance":
      return "The message was sent, but no instance of the planning model's provider is available on this machine.";
    case "model-unavailable":
      return "The message was sent, but the planning model is not available on this machine.";
    case "turn-active":
      return "The assistant is already replying in this plan.";
    default:
      return "The message was sent, but the assistant could not reply.";
  }
}

/** A failed derivation never leaves a partial artifact, so the notice says so. */
export function derivationFailureNotice(reason: DerivationFailureReason): string {
  switch (reason) {
    case "no-technical-plan":
      return "The assistant finished without producing a technical plan; no artifact was saved.";
    case "stopped":
      return "Technical plan derivation was stopped; no artifact was saved.";
    case "provider-error":
      return "Technical plan derivation failed; no artifact was saved.";
    default:
      return "Technical plan derivation ended without an artifact.";
  }
}

/** A turn is waiting on the person exactly while it has a question up. */
export function turnAwaitsInput(turn: PlanInFlightTurn | undefined): boolean {
  return turn?.questions !== undefined && turn.questions.length > 0;
}

import type {
  PlanInFlightTurn,
  PlanStreamItem,
  PlanningModelResolution,
  PlanningModelSelection,
  PlanTurnRefusalReason,
  ProviderDriverKind,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { formatProviderSkillDisplayName } from "@t3tools/client-runtime/providerSkills";

import { detectComposerTrigger, type ComposerTrigger } from "../../composer-logic";
import type { ComposerCommandItem } from "../chat/ComposerCommandMenu";
import { resolveComposerMenuActiveItemId } from "../chat/composerMenuHighlight";
import { searchSlashCommandItems } from "../chat/composerSlashCommandSearch";
import { searchProviderSkills } from "../../providerSkillSearch";
import { providerLabel } from "./PlanningModel.logic";

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

export type PlanComposerSelectableMenuItem = Extract<
  ComposerCommandItem,
  { readonly type: "provider-slash-command" | "skill" }
>;

export interface PlanComposerMenuStatusItem {
  readonly id: "planning-model-gate" | "provider-empty";
  readonly type: "status";
  readonly status: "gate" | "empty";
  readonly label: string;
  readonly selectable: false;
}

export type PlanComposerMenuItem = PlanComposerSelectableMenuItem | PlanComposerMenuStatusItem;

/**
 * The planning composer's provider-owned command surface. Planning has no
 * built-ins: its model picker is already a standing control.
 */
export function planComposerMenuItems(input: {
  readonly trigger: ComposerTrigger | null;
  readonly provider: ProviderDriverKind | null;
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly gateNotice: string | null;
}): PlanComposerMenuItem[] {
  if (
    input.trigger === null ||
    (input.trigger.kind !== "slash-command" && input.trigger.kind !== "skill")
  ) {
    return [];
  }

  if (input.gateNotice !== null) {
    return [
      {
        id: "planning-model-gate",
        type: "status",
        status: "gate",
        label: input.gateNotice,
        selectable: false,
      },
    ];
  }

  if (input.trigger.kind === "slash-command") {
    if (input.slashCommands.length === 0 || input.provider === null) {
      return [
        {
          id: "provider-empty",
          type: "status",
          status: "empty",
          label: "This provider supplies no commands on this machine.",
          selectable: false,
        },
      ];
    }
    const provider = input.provider;
    const items = input.slashCommands.map(
      (command): PlanComposerSelectableMenuItem => ({
        id: `provider-slash-command:${provider}:${command.name}`,
        type: "provider-slash-command",
        provider,
        command,
        label: `/${command.name}`,
        description: command.description ?? command.input?.hint ?? "Run provider command",
      }),
    );
    return searchSlashCommandItems(items, input.trigger.query).filter(
      (item): item is PlanComposerSelectableMenuItem => item.type !== "slash-command",
    );
  }

  const enabledSkills = input.skills.filter((skill) => skill.enabled);
  if (enabledSkills.length === 0 || input.provider === null) {
    return [
      {
        id: "provider-empty",
        type: "status",
        status: "empty",
        label: "This provider supplies no skills on this machine.",
        selectable: false,
      },
    ];
  }
  const provider = input.provider;
  return searchProviderSkills(enabledSkills, input.trigger.query).map(
    (skill): PlanComposerSelectableMenuItem => ({
      id: `skill:${provider}:${skill.name}`,
      type: "skill",
      provider,
      skill,
      label: formatProviderSkillDisplayName(skill),
      description:
        skill.shortDescription ??
        skill.description ??
        (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
    }),
  );
}

export type PlanComposerTrigger =
  | ComposerTrigger
  | {
      readonly kind: "note";
      readonly query: string;
      readonly rangeStart: number;
      readonly rangeEnd: number;
    };

/** Planning's local wikilink trigger; ordinary thread composers never call this detector. */
export function detectPlanComposerTrigger(
  text: string,
  cursor: number,
): PlanComposerTrigger | null {
  const boundedCursor = Math.max(0, Math.min(text.length, cursor));
  const beforeCursor = text.slice(0, boundedCursor);
  const lineStart = beforeCursor.lastIndexOf("\n") + 1;
  const triggerStart = beforeCursor.lastIndexOf("[[");
  if (triggerStart >= lineStart) {
    const query = beforeCursor.slice(triggerStart + 2);
    if (!query.includes("[") && !query.includes("]")) {
      return { kind: "note", query, rangeStart: triggerStart, rangeEnd: boundedCursor };
    }
  }
  return detectComposerTrigger(text, boundedCursor);
}

export function routePlanComposerTrigger(trigger: PlanComposerTrigger | null): {
  readonly mentionTrigger: PlanComposerTrigger | null;
  readonly commandTrigger: ComposerTrigger | null;
} {
  return {
    mentionTrigger: trigger?.kind === "path" || trigger?.kind === "note" ? trigger : null,
    commandTrigger: trigger?.kind === "slash-command" || trigger?.kind === "skill" ? trigger : null,
  };
}

export function isPlanComposerSelectableMenuItem(
  item: PlanComposerMenuItem,
): item is PlanComposerSelectableMenuItem {
  return item.type !== "status";
}

export type PlanComposerMenuKeyResolution =
  | { readonly action: "none" }
  | { readonly action: "handled" }
  | { readonly action: "highlight"; readonly itemId: string }
  | { readonly action: "select"; readonly item: PlanComposerSelectableMenuItem };

/** The open menu owns arrows and commit keys, including an empty/gated row. */
export function resolvePlanComposerMenuKey(input: {
  readonly menuOpen: boolean;
  readonly key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab";
  readonly items: ReadonlyArray<PlanComposerSelectableMenuItem>;
  readonly activeItemId: string | null;
}): PlanComposerMenuKeyResolution {
  if (!input.menuOpen) return { action: "none" };
  if (input.items.length === 0) return { action: "handled" };

  const resolvedId = resolveComposerMenuActiveItemId({
    items: input.items,
    highlightedItemId: input.activeItemId,
    currentSearchKey: null,
    highlightedSearchKey: null,
  });
  const resolvedIndex = input.items.findIndex((item) => item.id === resolvedId);

  if (input.key === "Enter" || input.key === "Tab") {
    const item = input.items[resolvedIndex];
    return item === undefined ? { action: "handled" } : { action: "select", item };
  }

  const offset = input.key === "ArrowDown" ? 1 : -1;
  const item = input.items[(resolvedIndex + offset + input.items.length) % input.items.length];
  return item === undefined ? { action: "handled" } : { action: "highlight", itemId: item.id };
}

export function resolveComposerControl(input: {
  /** A turn is live on this branch — streaming, or waiting on a question. */
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
        case "option-unavailable":
          return "This model's recorded reasoning depth is not available on this machine's instance — choose another depth or update the agent.";
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
    case "option-unavailable":
      return "The message was sent, but the planning model's recorded reasoning depth is not available on this machine.";
    case "turn-active":
      return "The assistant is already replying on this branch.";
    default:
      return "The message was sent, but the assistant could not reply.";
  }
}

export function implementFailureNotice(
  reason:
    | Extract<PlanStreamItem, { readonly kind: "implement-failed" }>["reason"]
    | "line-branch-missing",
): string {
  switch (reason) {
    case "stopped":
      return "The implement analysis was stopped; nothing landed.";
    case "provider-error":
      return "The assistant could not finish the implement analysis; nothing landed.";
    case "line-branch-missing":
      return "The line's branch no longer exists in this repository.";
    case "no-proposal":
    case "invalid-proposal":
      return "The assistant couldn't produce a usable analysis; nothing landed.";
  }
}

export function memoryAmendmentFailureNotice(
  failure: Extract<PlanStreamItem, { readonly kind: "memory-amendment-failed" }>,
): string {
  return `The assistant couldn't produce a usable memory amendment; nothing landed. ${failure.reason}`;
}

/** A turn is waiting on the person exactly while it has a question up. */
export function turnAwaitsInput(turn: PlanInFlightTurn | undefined): boolean {
  return turn?.questions !== undefined && turn.questions.length > 0;
}

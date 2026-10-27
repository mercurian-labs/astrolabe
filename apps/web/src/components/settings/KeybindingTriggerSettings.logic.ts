import type {
  KeybindingCommand,
  ResolvedKeybindingTrigger,
  ServerRemoveKeybindingInput,
  ServerUpsertKeybindingInput,
} from "@t3tools/contracts";
import {
  DEFAULT_RESOLVED_TRIGGERS,
  compileKeybindingTrigger,
  formatKeybindingTrigger,
  keybindingRuleIssue,
} from "@t3tools/shared/keybindingTriggers";

import { aliasLabel } from "~/whichKey/exCommands";
import { menuKeysLabel } from "~/whichKey/leader";
import { commandLabel } from "./KeybindingsSettings.logic";

/**
 * Menu keys (the keyboard menu) and aliases (the Command Palette) beside the shortcuts. Defaults
 * live in code, so a `-command` rule removes one and deleting that rule restores it. A user rule
 * replaces every default of its command and kind, so writing one writes the command's other
 * defaults of that kind with it.
 */

export type KeybindingTriggerKind = ResolvedKeybindingTrigger["kind"];

export interface KeybindingTriggerRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly kind: KeybindingTriggerKind;
  /** The trigger as a rule writes it: `menu g w`, `:q[uit]`. */
  readonly key: string;
  /** The trigger as the table shows it: `g w`, `q[uit]`. */
  readonly label: string;
  readonly trigger: ResolvedKeybindingTrigger;
  /** Removed: a default a `-command` rule took away, shown so it can come back. */
  readonly source: "Default" | "Custom" | "Removed";
  /** The command's default keys of this kind, as rules write them. */
  readonly defaultKeys: readonly string[];
  /** The command's user rules of this kind, as rules write them. */
  readonly customKeys: readonly string[];
  /** Every key of this kind the command answers to now, defaults and user rules alike. */
  readonly slotKeys: readonly string[];
  readonly conflicts: readonly string[];
}

export const TRIGGER_KIND_LABELS: Readonly<Record<KeybindingTriggerKind, string>> = {
  menu: "Menu keys",
  alias: "Alias",
};

/** A trigger as the table shows it: menu keys without their `menu`, an alias without its colon. */
function triggerLabel(trigger: ResolvedKeybindingTrigger): string {
  return trigger.kind === "menu" ? menuKeysLabel(trigger.sequence) : aliasLabel(trigger);
}

const sameTrigger = (left: ResolvedKeybindingTrigger, right: ResolvedKeybindingTrigger) =>
  left.command === right.command &&
  formatKeybindingTrigger(left) === formatKeybindingTrigger(right);

const isDefault = (trigger: ResolvedKeybindingTrigger) =>
  DEFAULT_RESOLVED_TRIGGERS.some((candidate) => sameTrigger(candidate, trigger));

const inSlot = (trigger: ResolvedKeybindingTrigger, command: KeybindingCommand, kind: string) =>
  trigger.command === command && trigger.kind === kind;

/** Whether two triggers reach the same place: the same sequence or one leading into the other. */
function collides(left: ResolvedKeybindingTrigger, right: ResolvedKeybindingTrigger): boolean {
  if (left.kind === "alias" && right.kind === "alias") return left.name === right.name;
  if (left.kind !== "menu" || right.kind !== "menu") return false;
  const length = Math.min(left.sequence.length, right.sequence.length);
  return (
    left.sequence.slice(0, length).join("\u0000") === right.sequence.slice(0, length).join("\u0000")
  );
}

/** The labels of the other commands `trigger` collides with among `triggers`. */
function conflictLabels(
  triggers: ReadonlyArray<ResolvedKeybindingTrigger>,
  trigger: ResolvedKeybindingTrigger,
): readonly string[] {
  return [
    ...new Set(
      triggers
        .filter(
          (candidate) => candidate.command !== trigger.command && collides(candidate, trigger),
        )
        .map((candidate) => commandLabel(candidate.command)),
    ),
  ].toSorted();
}

/** Every menu and alias trigger in effect, and every default a removal took away. */
export function buildKeybindingTriggerRows(
  triggers: ReadonlyArray<ResolvedKeybindingTrigger>,
): ReadonlyArray<KeybindingTriggerRow> {
  const keysOf = (list: ReadonlyArray<ResolvedKeybindingTrigger>) =>
    list.map(formatKeybindingTrigger);
  const removed = DEFAULT_RESOLVED_TRIGGERS.filter(
    (trigger) =>
      !triggers.some((candidate) => sameTrigger(candidate, trigger)) &&
      // A user rule of the same command and kind replaced it: overridden, not removed.
      !triggers.some(
        (candidate) => inSlot(candidate, trigger.command, trigger.kind) && !isDefault(candidate),
      ),
  );
  const row = (
    trigger: ResolvedKeybindingTrigger,
    source: KeybindingTriggerRow["source"],
    index: number,
  ): KeybindingTriggerRow => {
    const slot = triggers.filter((candidate) => inSlot(candidate, trigger.command, trigger.kind));
    const key = formatKeybindingTrigger(trigger);
    return {
      id: `${trigger.command}\u0000${key}\u0000${source}\u0000${index}`,
      command: trigger.command,
      kind: trigger.kind,
      key,
      label: triggerLabel(trigger),
      trigger,
      source,
      defaultKeys: keysOf(
        DEFAULT_RESOLVED_TRIGGERS.filter((candidate) =>
          inSlot(candidate, trigger.command, trigger.kind),
        ),
      ),
      customKeys: keysOf(slot.filter((candidate) => !isDefault(candidate))),
      slotKeys: keysOf(slot),
      conflicts: source === "Removed" ? [] : conflictLabels(triggers, trigger),
    };
  };
  return [
    ...triggers.map((trigger, index) =>
      row(trigger, isDefault(trigger) ? "Default" : "Custom", index),
    ),
    ...removed.map((trigger, index) => row(trigger, "Removed", index)),
  ];
}

/** Why a draft key cannot be saved as a `kind` trigger; null when it can. */
export function triggerDraftIssue(kind: KeybindingTriggerKind, key: string): string | null {
  const trimmed = key.trim();
  if (trimmed === "") return "Unassigned";
  const rule = { key: trimmed, command: "chat.new" as const };
  const issue = keybindingRuleIssue(rule);
  if (issue) return issue;
  return compileKeybindingTrigger(rule)?.kind === kind ? null : "Not this kind of key";
}

/** The other commands a draft key for `command` would collide with; none while it is invalid. */
export function triggerDraftConflicts(
  triggers: ReadonlyArray<ResolvedKeybindingTrigger>,
  command: KeybindingCommand,
  key: string,
): readonly string[] {
  const trigger = compileKeybindingTrigger({ key: key.trim(), command });
  return trigger ? conflictLabels(triggers, trigger) : [];
}

/**
 * The rules to write for a row edited to `key`: the edit itself (in place of a user rule), and
 * for a default, the command's other defaults of this kind, which the new rule would replace.
 */
export function triggerEditInputs(
  row: KeybindingTriggerRow,
  key: string,
): ReadonlyArray<ServerUpsertKeybindingInput> {
  const next = { command: row.command, key: key.trim() };
  if (row.source === "Custom") {
    return [{ ...next, replace: { command: row.command, key: row.key } }];
  }
  const keep = row.defaultKeys.filter((other) => other !== row.key);
  return [...keep.map((other) => ({ command: row.command, key: other })), next];
}

/**
 * The rules to write to give `command` one more trigger, `key`: while only defaults of its kind
 * are in effect, those defaults too, which the new rule would otherwise replace.
 */
export function triggerAddInputs(
  rows: ReadonlyArray<KeybindingTriggerRow>,
  command: KeybindingCommand,
  key: string,
): ReadonlyArray<ServerUpsertKeybindingInput> {
  const next = { command, key: key.trim() };
  const kind = compileKeybindingTrigger(next)?.kind;
  const slot = rows.filter((row) => row.command === command && row.kind === kind);
  if (slot.some((row) => row.source === "Custom")) return [next];
  const defaults = slot.filter((row) => row.source === "Default" && row.key !== next.key);
  return [...defaults.map((row) => ({ command, key: row.key })), next];
}

/** What a row's menu does: remove a user rule, or add or delete a default's removal rule. */
export type KeybindingTriggerChange =
  | {
      readonly type: "remove";
      readonly target: ServerRemoveKeybindingInput;
      /** More rules to remove after it: the copies of defaults an edit wrote beside it. */
      readonly also?: ReadonlyArray<ServerRemoveKeybindingInput>;
    }
  | { readonly type: "upsert"; readonly input: ServerUpsertKeybindingInput };

export function triggerRowActions(row: KeybindingTriggerRow): ReadonlyArray<{
  readonly label: string;
  readonly destructive?: boolean;
  readonly change: KeybindingTriggerChange;
}> {
  const removal = { command: `-${row.command}` as const, key: row.key };
  switch (row.source) {
    case "Removed":
      return [
        { label: `Restore default ${row.label}`, change: { type: "remove", target: removal } },
      ];
    case "Default":
      return [
        {
          label: `Remove ${row.label}`,
          destructive: true,
          change: { type: "upsert", input: removal },
        },
      ];
    case "Custom": {
      const target = { command: row.command, key: row.key };
      // The last user rule of its kind gone, the command's defaults of that kind come back.
      const restores = row.customKeys.length === 1 && row.defaultKeys.length > 0;
      // While a user rule is in effect, a default-looking key of its kind is a copy the edit
      // wrote; left behind, it would replace the very defaults the reset brings back.
      const copies = row.slotKeys
        .filter((key) => key !== row.key && row.defaultKeys.includes(key))
        .map((key) => ({ command: row.command, key }));
      return [
        restores
          ? {
              label: `Reset ${row.label} to default`,
              change: { type: "remove", target, ...(copies.length > 0 ? { also: copies } : {}) },
            }
          : {
              label: `Remove ${row.label}`,
              destructive: true,
              change: { type: "remove", target },
            },
      ];
    }
  }
}

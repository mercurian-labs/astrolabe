import type {
  KeybindingCommand,
  KeybindingRule,
  ResolvedKeybindingRule,
  ResolvedKeybindingsConfig,
  ResolvedKeybindingTrigger,
  ResolvedKeybindingTriggers,
} from "@t3tools/contracts";
import { MAX_KEYBINDINGS_COUNT } from "@t3tools/contracts";

import {
  compileResolvedKeybindingsConfig,
  isKeybindingRemovalCommand,
  keybindingRemovalTarget,
  keybindingTriggerKind,
  mergeWithDefaultKeybindings,
  parseKeybindingShortcut,
  parseKeybindingWhenExpression,
} from "./keybindings.ts";

/**
 * Astrolabe: the triggers a keybinding rule can have beside a shortcut, and how rules of every
 * kind merge with their defaults. A rule's `key` says its kind:
 *
 * - `menu g w`: menu keys, pressed in the keyboard menu once ⌘K or the leader key opens it;
 * - `:q[uit]`: an alias, a short name typed in the Command Palette, in Vim's notation (the
 *   bracketed tail is optional, so `q`, `qu`, and `quit` all name it);
 * - anything else: a shortcut, as upstream reads it.
 *
 * A user rule replaces the defaults of its own command and kind only: a shortcut for `chat.new`
 * leaves its menu keys alone. A `-command` rule removes the matching rule instead.
 */

/** The keyboard menu's default keys and the Command Palette's default aliases. */
export const DEFAULT_TRIGGER_KEYBINDINGS: ReadonlyArray<KeybindingRule> = [
  { key: "menu :", command: "commandLine.open" },
  { key: "menu /", command: "commandPalette.toggle" },
  { key: "menu n", command: "section.new" },
  { key: "menu f", command: "filePicker.toggle" },
  { key: "menu g t", command: "section.threads" },
  { key: "menu g w", command: "section.wikis" },
  { key: "menu g p", command: "section.pullRequests" },
  { key: "menu g u", command: "section.usage" },
  { key: "menu g s", command: "section.settings" },
  { key: "menu t ]", command: "chatTab.next" },
  { key: "menu t [", command: "chatTab.previous" },
  { key: "menu t c", command: "chatTab.close" },
  { key: "menu t r", command: "view.reopenClosed" },
  { key: "menu p v", command: "pane.splitRight" },
  { key: "menu p s", command: "pane.splitDown" },
  { key: "menu p c", command: "pane.close" },
  { key: "menu p m", command: "pane.toggleMaximized" },
  { key: "menu s s", command: "sidebar.toggle" },
  { key: "menu w w", command: "section.wikis" },
  { key: "menu w f", command: "wiki.findDocument" },
  { key: "menu ,", command: "section.settings" },
  { key: ":q[uit]", command: "tab.close" },
  { key: ":w[rite]", command: "draft.write" },
  { key: ":e[dit]", command: "document.open" },
  { key: ":sp[lit]", command: "pane.splitDown" },
  { key: ":vs[plit]", command: "pane.splitRight" },
  { key: ":b[uffer]", command: "buffer.open" },
  { key: ":noh[lsearch]", command: "search.clearHighlight" },
];

/** The keys of a `menu …` rule, as `KeyboardEvent.key` names them; null when malformed. */
export function parseMenuKeys(key: string): string[] | null {
  const [word, ...tokens] = key.trim().split(/\s+/);
  if (word?.toLowerCase() !== "menu" || tokens.length === 0) return null;
  const sequence: string[] = [];
  for (const token of tokens) {
    if (token.toLowerCase() === "space") sequence.push(" ");
    else if (Array.from(token).length === 1) sequence.push(token);
    else return null;
  }
  return sequence;
}

/** Menu keys as a rule writes them: `menu g w`. */
export function formatMenuKeys(sequence: readonly string[]): string {
  return ["menu", ...sequence.map((key) => (key === " " ? "space" : key))].join(" ");
}

/** An alias in Vim's notation (`:q[uit]`), lowercased; null when malformed. */
export function parseAlias(key: string): { name: string; shortest: number } | null {
  const match = /^:([a-z]+)(?:\[([a-z]+)\])?$/i.exec(key.trim());
  if (!match) return null;
  const [, head = "", tail = ""] = match;
  return { name: `${head}${tail}`.toLowerCase(), shortest: head.length };
}

/** An alias as a rule writes it: `:q[uit]`. */
export function formatAlias(trigger: { name: string; shortest: number }): string {
  const head = trigger.name.slice(0, trigger.shortest);
  const tail = trigger.name.slice(trigger.shortest);
  return `:${head}${tail ? `[${tail}]` : ""}`;
}

/** A rule's trigger key as rules write it, for a resolved trigger. */
export function formatKeybindingTrigger(trigger: ResolvedKeybindingTrigger): string {
  return trigger.kind === "menu" ? formatMenuKeys(trigger.sequence) : formatAlias(trigger);
}

/** A menu or alias rule's trigger; null for a shortcut, a removal, or a malformed key. */
export function compileKeybindingTrigger(rule: KeybindingRule): ResolvedKeybindingTrigger | null {
  if (isKeybindingRemovalCommand(rule.command) || rule.when !== undefined) return null;
  const kind = keybindingTriggerKind(rule.key);
  if (kind === "menu") {
    const sequence = parseMenuKeys(rule.key);
    return sequence ? { kind, command: rule.command, sequence } : null;
  }
  if (kind === "alias") {
    const alias = parseAlias(rule.key);
    return alias ? { kind, command: rule.command, ...alias } : null;
  }
  return null;
}

/**
 * Why a rule is invalid, for what upstream does not validate itself: a menu or alias rule, or a
 * removal. Null when it is valid; undefined for a plain shortcut rule, which upstream checks.
 */
export function keybindingRuleIssue(rule: KeybindingRule): string | null | undefined {
  const kind = keybindingTriggerKind(rule.key);
  const removal = isKeybindingRemovalCommand(rule.command);
  if (kind === "shortcut") {
    if (!removal) return undefined;
    if (!parseKeybindingShortcut(rule.key)) return `Invalid shortcut "${rule.key}"`;
    if (rule.when !== undefined && !parseKeybindingWhenExpression(rule.when)) {
      return `Invalid when expression "${rule.when}"`;
    }
    return null;
  }
  if (rule.when !== undefined) return "Menu keys and aliases take no `when`";
  if (kind === "menu") {
    return parseMenuKeys(rule.key)
      ? null
      : `Invalid menu keys "${rule.key}": write "menu" and then single keys, spaced (menu g w)`;
  }
  return parseAlias(rule.key)
    ? null
    : `Invalid alias "${rule.key}": write a colon and letters, with an optional tail in brackets (:q[uit])`;
}

function sameTrigger(left: ResolvedKeybindingTrigger, right: ResolvedKeybindingTrigger) {
  if (left.command !== right.command) return false;
  if (left.kind === "menu" && right.kind === "menu") {
    return left.sequence.join("\u0000") === right.sequence.join("\u0000");
  }
  return left.kind === "alias" && right.kind === "alias" && left.name === right.name;
}

function sameShortcut(left: ResolvedKeybindingRule, right: ResolvedKeybindingRule) {
  const a = left.shortcut;
  const b = right.shortcut;
  return (
    a.key === b.key &&
    a.metaKey === b.metaKey &&
    a.ctrlKey === b.ctrlKey &&
    a.shiftKey === b.shiftKey &&
    a.altKey === b.altKey &&
    a.modKey === b.modKey
  );
}

const triggerSlot = (trigger: ResolvedKeybindingTrigger) =>
  `${trigger.command}\u0000${trigger.kind}`;

function compileTriggers(rules: ReadonlyArray<KeybindingRule>) {
  return rules.flatMap((rule) => {
    const trigger = compileKeybindingTrigger(rule);
    return trigger ? [trigger] : [];
  });
}

export const DEFAULT_RESOLVED_TRIGGERS: ReadonlyArray<ResolvedKeybindingTrigger> = compileTriggers(
  DEFAULT_TRIGGER_KEYBINDINGS,
);

/**
 * Every rule of a keybindings file merged with the defaults, as clients receive them. Shortcuts
 * merge as upstream merges them (a command's own shortcuts replace its default ones); menu keys
 * and aliases merge the same way, each kind on its own. Then each `-command` rule
 * removes the rules of that command with the same trigger (and the same `when`, if it gives
 * one), defaults and user rules alike.
 */
export function resolveKeybindingRules(rules: ReadonlyArray<KeybindingRule>): {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly keybindingTriggers: ResolvedKeybindingTriggers;
} {
  const removals = rules.filter((rule) => isKeybindingRemovalCommand(rule.command));

  const removedShortcuts = removals.flatMap((rule) => {
    if (keybindingTriggerKind(rule.key) !== "shortcut") return [];
    const command = keybindingRemovalTarget(rule.command);
    const [compiled] = compileResolvedKeybindingsConfig([
      rule.when === undefined
        ? { key: rule.key, command }
        : { key: rule.key, command, when: rule.when },
    ]);
    return compiled ? [{ binding: compiled, matchesWhen: rule.when !== undefined }] : [];
  });
  const merged = mergeWithDefaultKeybindings(compileResolvedKeybindingsConfig(rules));
  const keybindings = merged.filter(
    (binding) =>
      !removedShortcuts.some(
        (removed) =>
          removed.binding.command === binding.command &&
          sameShortcut(removed.binding, binding) &&
          (!removed.matchesWhen ||
            JSON.stringify(removed.binding.whenAst) === JSON.stringify(binding.whenAst)),
      ),
  );
  const unboundCommands = [
    ...new Set(removedShortcuts.map((removed) => removed.binding.command)),
  ].filter((command) => !keybindings.some((binding) => binding.command === command));

  const removedTriggers = compileTriggers(
    removals.map((rule) => ({ key: rule.key, command: keybindingRemovalTarget(rule.command) })),
  );
  const custom = compileTriggers(rules);
  const customSlots = new Set(custom.map(triggerSlot));
  const triggers = [
    ...DEFAULT_RESOLVED_TRIGGERS.filter((trigger) => !customSlots.has(triggerSlot(trigger))),
    ...custom,
  ]
    .filter((trigger) => !removedTriggers.some((removed) => sameTrigger(removed, trigger)))
    .slice(-MAX_KEYBINDINGS_COUNT);

  return { keybindings, keybindingTriggers: { triggers, unboundCommands } };
}

/**
 * The command a rule's shortcut belongs to, for a shortcut rule (a removal counts for its
 * command); null for a menu or alias rule. Startup backfills a default shortcut only for a command
 * with none of these.
 */
export function shortcutRuleCommand(rule: KeybindingRule): KeybindingCommand | null {
  if (keybindingTriggerKind(rule.key) !== "shortcut") return null;
  return keybindingRemovalTarget(rule.command);
}

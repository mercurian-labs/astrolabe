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
 * Astrolabe: a rule's `key` gives its kind: `menu g w` (keyboard-menu keys, after ⌘K or the leader),
 * `:q[uit]` (a Command Palette alias in Vim notation, bracketed tail optional), or a shortcut as
 * upstream reads it. A user rule replaces only its own command's defaults of the same kind; a
 * `-command` rule removes the matching rule instead.
 */

/** The keyboard menu's default keys and the Command Palette's default aliases. */
export const DEFAULT_TRIGGER_KEYBINDINGS: ReadonlyArray<KeybindingRule> = [
  { key: "menu :", command: "commandLine.open" },
  { key: "menu /", command: "commandPalette.toggle" },
  { key: "menu n", command: "section.new" },
  { key: "menu f", command: "filePicker.toggle" },
  // Focus moves sit at the root as the arrows and h/j/k/l, Vim's window keys; each arrow first,
  // so its row reads `← | h`. The root's cursor moves with Ctrl+N/Ctrl+P and the mouse instead.
  { key: "menu arrowleft", command: "focus.left" },
  { key: "menu h", command: "focus.left" },
  { key: "menu arrowdown", command: "focus.down" },
  { key: "menu j", command: "focus.down" },
  { key: "menu arrowup", command: "focus.up" },
  { key: "menu k", command: "focus.up" },
  { key: "menu arrowright", command: "focus.right" },
  { key: "menu l", command: "focus.right" },
  // Half a page of the focused place, as Vim's Ctrl-D and Ctrl-U.
  { key: "menu d", command: "scroll.down" },
  { key: "menu u", command: "scroll.up" },
  { key: "menu g t", command: "section.threads" },
  { key: "menu g w", command: "section.wikis" },
  { key: "menu g r", command: "section.repositories" },
  { key: "menu g p", command: "section.pullRequests" },
  { key: "menu g u", command: "section.usage" },
  { key: "menu g s", command: "section.settings" },
  { key: "menu t ]", command: "chatTab.next" },
  { key: "menu t [", command: "chatTab.previous" },
  { key: "menu t c", command: "chatTab.close" },
  { key: "menu t r", command: "view.reopenClosed" },
  // The tab in front's history, as h/l step left and right ([ and ] step between tabs).
  { key: "menu t h", command: "navigation.back" },
  { key: "menu t l", command: "navigation.forward" },
  { key: "menu p v", command: "pane.splitRight" },
  { key: "menu p s", command: "pane.splitDown" },
  { key: "menu p c", command: "pane.close" },
  { key: "menu p m", command: "pane.toggleMaximized" },
  { key: "menu p f", command: "pane.toggleFullScreen" },
  { key: "menu p r", command: "rightPanel.toggle" },
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

/**
 * The keys a menu rule names by word, as `KeyboardEvent.key` names them: `space`, and the arrows
 * as shortcuts spell them (`arrowup`).
 */
const NAMED_MENU_KEYS: Readonly<Record<string, string>> = {
  space: " ",
  arrowleft: "ArrowLeft",
  arrowdown: "ArrowDown",
  arrowup: "ArrowUp",
  arrowright: "ArrowRight",
};

const MENU_KEY_NAMES = new Map(Object.entries(NAMED_MENU_KEYS).map(([name, key]) => [key, name]));

/** Whether `key` (a `KeyboardEvent.key`) can be a menu key: one character, or a named key. */
export function isMenuKey(key: string): boolean {
  return Array.from(key).length === 1 || MENU_KEY_NAMES.has(key);
}

/** The keys of a `menu …` rule, as `KeyboardEvent.key` names them; null when malformed. */
export function parseMenuKeys(key: string): string[] | null {
  const [word, ...tokens] = key.trim().split(/\s+/);
  if (word?.toLowerCase() !== "menu" || tokens.length === 0) return null;
  const sequence: string[] = [];
  for (const token of tokens) {
    const named = NAMED_MENU_KEYS[token.toLowerCase()];
    if (named !== undefined) sequence.push(named);
    else if (Array.from(token).length === 1) sequence.push(token);
    else return null;
  }
  return sequence;
}

/** Menu keys as a rule writes them: `menu g w`, `menu p arrowleft`. */
export function formatMenuKeys(sequence: readonly string[]): string {
  return ["menu", ...sequence.map((key) => MENU_KEY_NAMES.get(key) ?? key)].join(" ");
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
 * Every rule of a keybindings file merged with the defaults, as clients receive them: each kind
 * merges on its own the way upstream merges shortcuts (a command's own replace its defaults), then
 * each `-command` rule removes that command's rules with the same trigger (and `when`, if given).
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

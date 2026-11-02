import type { KeybindingCommand, ResolvedKeybindingTrigger } from "@t3tools/contracts";

import type { AppCommand } from "./commands";
import { CHORD, type WhichKeyGroup, type WhichKeyItem } from "./menu";

/**
 * The keyboard menu, built from the keybindings' menu keys (defaults in
 * `DEFAULT_TRIGGER_KEYBINDINGS`): a sequence's last key runs its command, earlier keys open
 * groups. Built-in prefixes keep their names; user-made ones show as `+` and their entry count, as
 * which-key does. Keys at one level running the same command share a row.
 */

/** Names of the built-in groups at the menu's root. */
const GROUP_LABELS: Readonly<Record<string, string>> = {
  g: "Go to",
  t: "Tabs",
  p: "Panes",
  s: "Sidebar",
  w: "Wikis",
  r: "Projects",
};

interface Node {
  readonly children: Map<string, Node>;
  /** The command the sequence ending here runs; the last rule for it wins. */
  command: KeybindingCommand | null;
}

const node = (): Node => ({ children: new Map(), command: null });

/** A level of the tree as menu rows: groups for keys that lead on, commands for the rest. */
function rows(
  level: Node,
  atRoot: boolean,
  command: (id: KeybindingCommand) => AppCommand,
): WhichKeyItem[] {
  const items: WhichKeyItem[] = [];
  const rowFor = new Map<KeybindingCommand, number>();
  for (const [key, child] of level.children) {
    // A key that leads on is a group, even where a shorter sequence also ends on it.
    if (child.children.size > 0) {
      const group: WhichKeyGroup = {
        label: (atRoot ? GROUP_LABELS[key] : undefined) ?? "",
        items: rows(child, false, command),
      };
      const label = group.label || `+${group.items.length}`;
      items.push({ keys: [key], label, group: { ...group, label } });
      continue;
    }
    if (!child.command) continue;
    const at = rowFor.get(child.command);
    if (at !== undefined) {
      const existing = items[at]!;
      items[at] = { ...existing, keys: [...existing.keys, key] };
      continue;
    }
    const { label, disabled, run, repeatable } = command(child.command);
    rowFor.set(child.command, items.length);
    items.push({
      keys: [key],
      label,
      disabled,
      run,
      command: child.command,
      ...(repeatable ? { repeatable } : {}),
    });
  }
  return items;
}

/**
 * The menu's root for `triggers` (only their menu keys count), with each command as
 * `command` has it now. The menu's own chord pressed again is Search, so it is a key of Search's
 * row.
 */
export function whichKeyRoot(
  triggers: ReadonlyArray<ResolvedKeybindingTrigger>,
  command: (id: KeybindingCommand) => AppCommand,
): WhichKeyGroup {
  const root = node();
  for (const trigger of triggers) {
    if (trigger.kind !== "menu") continue;
    let at = root;
    for (const key of trigger.sequence) {
      let next = at.children.get(key);
      if (!next) {
        next = node();
        at.children.set(key, next);
      }
      at = next;
    }
    at.command = trigger.command;
  }
  const items = rows(root, true, command);
  const search = items.findIndex((item) => item.command === "commandPalette.toggle");
  if (search === -1) {
    const { label, disabled, run } = command("commandPalette.toggle");
    items.push({ keys: [CHORD], label, disabled, run, command: "commandPalette.toggle" });
  } else {
    const row = items[search]!;
    items[search] = { ...row, keys: [...row.keys, CHORD] };
  }
  return { label: "Keyboard commands", items };
}

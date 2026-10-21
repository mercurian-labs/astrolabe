import type { KeybindingCommand } from "@t3tools/contracts";

import { formatShortcutLabel } from "~/keybindings";
import { commandLabel, mergeKeybindingRows, type KeybindingRow } from "./KeybindingsSettings.logic";
import {
  triggerRowActions,
  type KeybindingTriggerChange,
  type KeybindingTriggerKind,
  type KeybindingTriggerRow,
} from "./KeybindingTriggerSettings.logic";

/**
 * Astrolabe: the Keybindings table, one row per command with a column per kind of trigger:
 * its shortcuts (upstream's rows), its menu keys, and its aliases. A filter narrows the table to
 * one kind; the search box matches a command's label and its keys, as each column shows them or
 * as the keybindings file writes them.
 */

export type KeybindingKind = "shortcut" | KeybindingTriggerKind;
export type KeybindingKindFilter = "all" | KeybindingKind;

export const KEYBINDING_KINDS = [
  "shortcut",
  "menu",
  "alias",
] as const satisfies ReadonlyArray<KeybindingKind>;

export const KEYBINDING_KIND_LABELS: Readonly<Record<KeybindingKind, string>> = {
  shortcut: "Shortcut",
  menu: "Menu keys",
  alias: "Alias",
};

export const KEYBINDING_FILTER_LABELS: Readonly<Record<KeybindingKindFilter, string>> = {
  all: "All",
  shortcut: "Shortcuts",
  menu: "Menu keys",
  alias: "Aliases",
};

export interface KeybindingCommandRow {
  readonly id: string;
  readonly command: KeybindingCommand;
  readonly shortcuts: ReadonlyArray<KeybindingRow>;
  readonly menu: ReadonlyArray<KeybindingTriggerRow>;
  readonly alias: ReadonlyArray<KeybindingTriggerRow>;
  /** Custom when any binding of the command is the user's; Project for a project script's. */
  readonly badge: "Custom" | "Project" | null;
}

/** The columns a filter shows. */
export function visibleKinds(filter: KeybindingKindFilter): ReadonlyArray<KeybindingKind> {
  return filter === "all" ? KEYBINDING_KINDS : [filter];
}

/** A shortcut as its cell's keycaps read, for the search box and the row's menu: `⌘W`. */
export function shortcutBindingLabel(row: KeybindingRow, platform: string): string {
  return formatShortcutLabel(row.binding.shortcut, platform);
}

function matchesQuery(
  row: KeybindingCommandRow,
  kinds: ReadonlyArray<KeybindingKind>,
  query: string,
  platform: string,
): boolean {
  const fields = [row.command, commandLabel(row.command)];
  if (kinds.includes("shortcut")) {
    for (const shortcut of row.shortcuts) {
      fields.push(
        shortcut.key,
        shortcutBindingLabel(shortcut, platform),
        shortcut.when,
        shortcut.source,
      );
    }
  }
  for (const kind of ["menu", "alias"] as const) {
    if (!kinds.includes(kind)) continue;
    for (const trigger of row[kind]) fields.push(trigger.key, trigger.label, trigger.source);
  }
  return fields.some((field) => field.toLowerCase().includes(query));
}

/**
 * One row per command that has a binding of a shown kind (a removed default counts, to be
 * restored), in the page's command order, each kind's bindings in its own cell. `shortcutRows`
 * and `triggerRows` are every binding, unfiltered.
 */
export function buildKeybindingCommandRows(input: {
  readonly shortcutRows: ReadonlyArray<KeybindingRow>;
  readonly triggerRows: ReadonlyArray<KeybindingTriggerRow>;
  readonly query: string;
  readonly filter: KeybindingKindFilter;
  readonly platform: string;
}): ReadonlyArray<KeybindingCommandRow> {
  const kinds = visibleKinds(input.filter);
  const byCommand = new Map<
    KeybindingCommand,
    { shortcuts: KeybindingRow[]; menu: KeybindingTriggerRow[]; alias: KeybindingTriggerRow[] }
  >();
  for (const binding of mergeKeybindingRows(input.shortcutRows, input.triggerRows)) {
    let cells = byCommand.get(binding.command);
    if (!cells) {
      cells = { shortcuts: [], menu: [], alias: [] };
      byCommand.set(binding.command, cells);
    }
    if ("trigger" in binding) cells[binding.kind].push(binding);
    else cells.shortcuts.push(binding);
  }
  const query = input.query.trim().toLowerCase();
  return [...byCommand].flatMap(([command, cells]): KeybindingCommandRow[] => {
    const shown =
      (kinds.includes("shortcut") && cells.shortcuts.length > 0) ||
      (kinds.includes("menu") && cells.menu.length > 0) ||
      (kinds.includes("alias") && cells.alias.length > 0);
    if (!shown) return [];
    const custom =
      cells.shortcuts.some((row) => row.source === "Custom") ||
      [...cells.menu, ...cells.alias].some((row) => row.source !== "Default");
    const row: KeybindingCommandRow = {
      id: command,
      command,
      ...cells,
      badge: cells.shortcuts.some((shortcut) => shortcut.source === "Project")
        ? "Project"
        : custom
          ? "Custom"
          : null,
    };
    return query === "" || matchesQuery(row, kinds, query, input.platform) ? [row] : [];
  });
}

/** What an entry of a row's `⋯` menu does: upstream's reset or remove, or a trigger's change. */
export type KeybindingCommandRowChange =
  | { readonly type: "resetShortcut"; readonly row: KeybindingRow }
  | { readonly type: "removeShortcut"; readonly row: KeybindingRow }
  | { readonly type: "trigger"; readonly change: KeybindingTriggerChange };

/**
 * A row's `⋯` menu, for the kinds shown: each binding's Remove, Reset to default, or (for a
 * removed default) Restore default. A shortcut follows upstream's rules: a changed one resets to
 * its default, and only a user's own is removed.
 */
export function commandRowActions(
  row: KeybindingCommandRow,
  kinds: ReadonlyArray<KeybindingKind>,
  platform: string,
): ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly change: KeybindingCommandRowChange;
}> {
  const actions: Array<{
    id: string;
    label: string;
    destructive?: boolean;
    change: KeybindingCommandRowChange;
  }> = [];
  if (kinds.includes("shortcut")) {
    for (const shortcut of row.shortcuts) {
      const label = shortcutBindingLabel(shortcut, platform);
      if (shortcut.source === "Custom" && shortcut.defaultKey !== null) {
        actions.push({
          id: `reset:${shortcut.id}`,
          label: `Reset ${label} to default`,
          change: { type: "resetShortcut", row: shortcut },
        });
      }
      if (shortcut.source !== "Default") {
        actions.push({
          id: `remove:${shortcut.id}`,
          label: `Remove ${label}`,
          destructive: true,
          change: { type: "removeShortcut", row: shortcut },
        });
      }
    }
  }
  for (const kind of ["menu", "alias"] as const) {
    if (!kinds.includes(kind)) continue;
    for (const trigger of row[kind]) {
      for (const action of triggerRowActions(trigger)) {
        actions.push({
          id: `${action.label}:${trigger.id}`,
          label: action.label,
          ...(action.destructive ? { destructive: true } : {}),
          change: { type: "trigger", change: action.change },
        });
      }
    }
  }
  return actions;
}

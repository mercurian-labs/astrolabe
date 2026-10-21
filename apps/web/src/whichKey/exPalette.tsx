import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { WikiOverview } from "@t3tools/client-runtime/state/wiki";
import type { KeybindingCommand, ResolvedKeybindingTrigger } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Columns2,
  CornerDownLeft,
  Rows2,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useChatTabsStore } from "~/chatTabs/chatTabsStore";
import {
  filterCommandPaletteGroups,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
} from "~/components/CommandPalette.logic";
import { isWikisPath } from "~/components/sidebar/mainAppLocation";
import { useWikiOverviews } from "~/components/wiki/wikiEnvironment";
import { finderGroups } from "~/components/wiki/WikiFinder";
import { showWikiTab } from "~/components/wiki/wikiPanes";
import { primaryServerKeybindingTriggersAtom } from "~/state/server";
import { inEditor, type AppCommand } from "./commands";
import { pendingExOrigin, releaseExOrigin, type KeyOrigin } from "./doors";
import { aliasLabel, exLineOf, parseExCommand, type ExCommand } from "./exCommands";
import { appCommandsSlot } from "./handles";
import { menuKeysLabel } from "./leader";

/**
 * Astrolabe: the command palette as Vim's ex line, the Command Palette. A query starting with `:`
 * is a command line. A line naming a command's alias (`exCommands.ts`) runs that command; any
 * other line lists the commands and upstream's actions it matches, and a line typed from a Vim
 * editor runs in that editor first, so its own commands (`:s/a/b/`, `:%s`, `:12`) keep working.
 * A bare `:` lists every command with its alias or menu keys, and its shortcut. `:` in an
 * editor's normal mode, and the keyboard menu's `:`, open the palette this way.
 */

const ITEM_ICON_CLASS = "size-4 shrink-0 text-muted-foreground/85";

/** What the ex line acts on, read from the surfaces on screen when it runs. */
export interface ExLineContext {
  readonly origin: KeyOrigin | null;
  /** The keybindings' menu keys and aliases. */
  readonly triggers: ReadonlyArray<ResolvedKeybindingTrigger>;
  /** The registry's entry for a command, acting where `origin` says. */
  readonly command: (id: KeybindingCommand) => AppCommand;
  /** The device's leader key as the menu names it ("Space"), for the commands' descriptions. */
  readonly leaderLabel: string;
  /** Upstream's actions, which the Command Palette lists beside the commands. */
  readonly actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  /** The palette's own thread rows, which `:b` filters. */
  readonly threadItems: ReadonlyArray<CommandPaletteActionItem>;
  /** The threads open as chat tabs, in strip order, which `:b` puts first. */
  readonly chatTabThreadIds: readonly string[];
  /** Every wiki, for `:e`; asked for only while the line is an `:e`. */
  readonly overviews: ReadonlyArray<WikiOverview>;
  /** Shows the Wikis area, for a document `:e` opens from elsewhere. */
  readonly showWikis: () => void;
  /** Puts `text` on the command line, for a command that takes an argument there. */
  readonly setLine: (text: string) => void;
}

function row(
  value: string,
  title: string,
  description: string,
  icon: ReactNode,
  run: (() => void) | null,
  extra: Partial<CommandPaletteActionItem> = {},
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: `ex:${value}`,
    searchTerms: [title],
    title,
    description,
    icon,
    ...(run ? {} : { disabled: true }),
    run: async () => run?.(),
    ...extra,
  };
}

const COMMAND_ICONS: Partial<Record<KeybindingCommand, ReactNode>> = {
  "tab.close": <X className={ITEM_ICON_CLASS} />,
  "draft.write": <CornerDownLeft className={ITEM_ICON_CLASS} />,
  "pane.splitDown": <Rows2 className={ITEM_ICON_CLASS} />,
  "pane.splitRight": <Columns2 className={ITEM_ICON_CLASS} />,
  "focus.left": <ArrowLeft className={ITEM_ICON_CLASS} />,
  "focus.down": <ArrowDown className={ITEM_ICON_CLASS} />,
  "focus.up": <ArrowUp className={ITEM_ICON_CLASS} />,
  "focus.right": <ArrowRight className={ITEM_ICON_CLASS} />,
  "scroll.down": <ChevronsDown className={ITEM_ICON_CLASS} />,
  "scroll.up": <ChevronsUp className={ITEM_ICON_CLASS} />,
};

const iconFor = (command: KeybindingCommand) =>
  COMMAND_ICONS[command] ?? <SquareTerminal className={ITEM_ICON_CLASS} />;

/** Commands that take their argument on the line (`:b name`, `:e name`), and its prompt. */
const ARGUMENT_COMMANDS: Partial<Record<KeybindingCommand, string>> = {
  "buffer.open": "name",
  "document.open": "name",
};

/** `:b`'s rows: the palette's thread rows matching `name`, threads open as tabs first. */
function bufferRows(context: ExLineContext, name: string) {
  const open = (item: CommandPaletteActionItem) => {
    const at = context.chatTabThreadIds.indexOf(item.value.replace(/^thread:/, ""));
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  if (name === "") {
    return context.threadItems
      .filter((item) => open(item) !== Number.MAX_SAFE_INTEGER)
      .toSorted((a, b) => open(a) - open(b));
  }
  const matched = filterCommandPaletteGroups({
    activeGroups: [{ value: "threads", label: "Threads", items: context.threadItems }],
    query: name,
    isInSubmenu: true,
    projectSearchItems: [],
    threadSearchItems: [],
  }).flatMap((group) => group.items);
  return matched
    .filter((item): item is CommandPaletteActionItem => item.kind === "action")
    .toSorted(
      (a, b) =>
        Number(open(a) === Number.MAX_SAFE_INTEGER) - Number(open(b) === Number.MAX_SAFE_INTEGER),
    );
}

function commandGroups(
  parsed: ExCommand,
  line: string,
  context: ExLineContext,
): CommandPaletteGroup[] {
  switch (parsed.command) {
    case "buffer.open": {
      const items = bufferRows(context, parsed.argument);
      return items.length > 0 ? [{ value: "ex-buffer", label: "Threads", items }] : [];
    }
    case "document.open":
      return finderGroups({
        overviews: context.overviews,
        scope: null,
        mode: "find",
        query: parsed.argument,
        onPick: (tab) => {
          showWikiTab(tab);
          context.showWikis();
        },
      });
    default: {
      const { label, disabled, run } = context.command(parsed.command);
      return [
        {
          value: "ex",
          label: "Command",
          items: [
            row(parsed.command, label, `:${line}`, iconFor(parsed.command), disabled ? null : run),
          ],
        },
      ];
    }
  }
}

/**
 * Every command the keyboard menu or the command line reaches, once each in the keybindings'
 * order: its label, its alias (else its menu keys), and its shortcut.
 */
function commandRows(context: ExLineContext): CommandPaletteActionItem[] {
  const seen = new Set<KeybindingCommand>();
  const rows: CommandPaletteActionItem[] = [];
  for (const trigger of context.triggers) {
    // The Command Palette is already open; its own row would do nothing.
    if (trigger.command === "commandLine.open" || seen.has(trigger.command)) continue;
    seen.add(trigger.command);
    const alias = context.triggers.find(
      (candidate) => candidate.kind === "alias" && candidate.command === trigger.command,
    );
    const argument = ARGUMENT_COMMANDS[trigger.command];
    const description =
      alias?.kind === "alias"
        ? `${aliasLabel(alias)}${argument ? ` ${argument}` : ""}`
        : trigger.kind === "menu"
          ? `${context.leaderLabel} ${menuKeysLabel(trigger.sequence)}`
          : "";
    const { label, disabled, run } = context.command(trigger.command);
    // A command taking an argument puts its name on the line and waits for the argument.
    const fill =
      alias?.kind === "alias" && argument
        ? () => context.setLine(`${alias.name.slice(0, alias.shortest)} `)
        : null;
    rows.push(
      row(
        trigger.command,
        label,
        description,
        iconFor(trigger.command),
        fill ?? (disabled ? null : run),
        {
          searchTerms: [label, description, trigger.command],
          shortcutCommand: trigger.command,
          ...(fill ? { keepOpen: true } : {}),
        },
      ),
    );
  }
  return rows;
}

/** The palette's rows for an ex line (the query after its `:`). */
export function exLineGroups(line: string, context: ExLineContext): CommandPaletteGroup[] {
  const trimmed = line.trim();
  const parsed = parseExCommand(trimmed, context.triggers);
  if (parsed) return commandGroups(parsed, trimmed, context);
  const listed: CommandPaletteGroup[] = [
    { value: "ex-commands", label: "Commands", items: commandRows(context) },
    ...(context.actionItems.length > 0
      ? [{ value: "actions", label: "Actions", items: context.actionItems }]
      : []),
  ];
  if (trimmed === "") return listed;
  const matches = filterCommandPaletteGroups({
    activeGroups: listed,
    query: trimmed,
    isInSubmenu: true,
    projectSearchItems: [],
    threadSearchItems: [],
  });
  // Anything else is the editor's own, from an editor; elsewhere Vim would not know it either.
  const run = inEditor(context.origin, trimmed);
  if (!run && matches.length > 0) return matches;
  const editorRow = row(
    "editor",
    run ? "Run in the editor" : "Not an editor command",
    `:${trimmed}`,
    <SquareTerminal className={ITEM_ICON_CLASS} />,
    run,
  );
  return [{ value: "ex", label: "Command", items: [editorRow] }, ...matches];
}

/**
 * The palette's ex line: its rows while the query starts with `:`, else null. The origin is the
 * one the palette was opened for (an editor's `:`, the keyboard menu's), taken as it mounts.
 * Leaving the palette puts focus back in that editor if nothing else took it.
 */
export function useExLine(
  query: string,
  threadItems: ReadonlyArray<CommandPaletteActionItem>,
  actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>,
  setQuery: (query: string) => void,
): CommandPaletteGroup[] | null {
  const [origin] = useState(pendingExOrigin);
  useEffect(() => {
    releaseExOrigin(origin);
    const view = origin?.view;
    return () => {
      if (!view) return;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if ((active === null || active === document.body) && view.dom.isConnected) view.focus();
      });
    };
  }, [origin]);

  const triggers = useAtomValue(primaryServerKeybindingTriggersAtom);
  const line = exLineOf(query);
  const editing = line !== null && parseExCommand(line, triggers)?.command === "document.open";
  const { overviews } = useWikiOverviews(editing);
  const chatTabKeys = useChatTabsStore((store) => store.keys);
  const navigate = useNavigate();
  const onWikis = useLocation({ select: (location) => isWikisPath(location.pathname) });

  if (line === null) return null;
  const host = appCommandsSlot.get();
  return exLineGroups(line, {
    origin,
    triggers,
    command: (id) => host?.command(id, origin) ?? { label: id, disabled: true, run: () => {} },
    leaderLabel: host?.leaderLabel ?? "Space",
    actionItems,
    threadItems,
    chatTabThreadIds: chatTabKeys.flatMap((key) => parseScopedThreadKey(key)?.threadId ?? []),
    overviews,
    showWikis: () => {
      if (!onWikis) void navigate({ to: "/wikis" });
    },
    setLine: (text) => setQuery(`:${text}`),
  });
}

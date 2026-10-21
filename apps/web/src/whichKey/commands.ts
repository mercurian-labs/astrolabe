import {
  ASTROLABE_KEYBINDING_COMMANDS,
  type AstrolabeKeybindingCommand,
  type KeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { runVimEx } from "@mercurian/editor/vim";

import { commandLabel } from "~/components/settings/KeybindingsSettings.logic";
import { isEmptyTab } from "~/panes/arrangement";
import {
  canClosePane,
  canSplitPane,
  closePane,
  focusedPaneOf,
  isPaneMaximized,
  splitPane,
  toggleMaximizedPane,
} from "~/panes/paneCommands";
import type { EditorWrite, KeyOrigin } from "./doors";
import type { ChatTabsHandle, PanesHandle, SidebarSectionHandle } from "./handles";
import { runKeybindingCommand, shortcutForCommand } from "./keybindingCommands";

/**
 * Astrolabe: the client's command registry. Every command the keyboard menu, the Command
 * Palette, and a shortcut can run has one entry here: its label (which may depend on where it
 * runs: "New thread" or "New document"), whether it can run now, and how. Astrolabe's own
 * commands act on the surfaces on screen (`handles.ts`) and the app's sections; upstream's run
 * through their own shortcut handlers (`runKeybindingCommand`), so they need a shortcut.
 */
export interface AppCommandContext {
  /** The sidebar section's title row, while one is mounted (Threads, Wikis): its new button. */
  readonly section: SidebarSectionHandle | null;
  readonly chatTabs: ChatTabsHandle | null;
  readonly panes: PanesHandle | null;
  /** The app's sections, as the icon rail opens them. */
  readonly sections: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly open: () => void;
  }>;
  readonly keybindings: ResolvedKeybindingsConfig;
  /** Where the key came from: the element and editor focus was in. */
  readonly origin: KeyOrigin | null;
  /** The Search Palette: threads, documents, and settings. */
  readonly openSearch: () => void;
  /** Upstream's file picker, over the palette. */
  readonly openFilePicker: () => void;
  /** The Command Palette: the palette as Vim's ex line, `text` after its colon. */
  readonly openCommandLine: (text?: string) => void;
  /** The Wikis area, with its finder open to find or create a document. */
  readonly findDocument: () => void;
}

export interface AppCommand {
  readonly label: string;
  /** Shown faint: there is nothing for it to act on here. */
  readonly disabled: boolean;
  readonly run: () => void;
}

const APP_COMMANDS = new Set<KeybindingCommand>(ASTROLABE_KEYBINDING_COMMANDS);

/** Whether the registry, not an upstream shortcut handler, runs `command`. */
export function isAppCommand(command: KeybindingCommand): command is AstrolabeKeybindingCommand {
  return APP_COMMANDS.has(command);
}

/** Upstream commands' labels where the menu says them shorter than the settings page. */
const UPSTREAM_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "commandPalette.toggle": "Search",
  "filePicker.toggle": "Find file",
  "chat.new": "New thread",
  "sidebar.toggle": "Toggle sidebar",
  "view.reopenClosed": "Reopen closed tab",
};

const SECTION_IDS: Partial<Record<AstrolabeKeybindingCommand, string>> = {
  "section.threads": "threads",
  "section.wikis": "wikis",
  "section.pullRequests": "pull-requests",
  "section.usage": "usage",
  "section.settings": "settings",
};

/** The key after (`step` 1) or before (-1) `active` in `keys`, wrapping; null with fewer than two. */
export function cycleKey(keys: readonly string[], active: string | null, step: 1 | -1) {
  if (keys.length < 2) return null;
  const at = active === null ? -1 : keys.indexOf(active);
  // From no tab in front, forward is the first and back the last.
  if (at === -1) return (step === 1 ? keys[0] : keys.at(-1)) ?? null;
  return keys[(at + step + keys.length) % keys.length] ?? null;
}

/**
 * What `:q` closes: the focused pane's tab where focus is in the panes on screen (the Wikis area
 * has only panes), else the chat tab in front.
 */
function closeTarget(context: AppCommandContext): (() => void) | null {
  const { panes, chatTabs } = context;
  const element = context.origin?.element ?? null;
  const inPanes = panes && (!chatTabs || (element && panes.element()?.contains(element)));
  if (panes && inPanes) {
    const focused = focusedPaneOf(panes.controller);
    if (!focused) return null;
    const { leaf, alone } = focused;
    // A lone empty tab has nothing to close, as its strip says.
    if (alone && leaf.tabs.length === 1 && isEmptyTab(leaf.active)) return null;
    return () => panes.tabs.close(leaf.active);
  }
  const active = chatTabs?.activeKey;
  return chatTabs && active ? () => chatTabs.close(active) : null;
}

/** `:w` where it came from, else the thread's composer on screen, which sends its draft. */
function writeTarget(origin: KeyOrigin | null): EditorWrite | null {
  if (origin?.view) return origin.write;
  const form = document.querySelector('[data-testid="composer-editor"]')?.closest("form");
  return form ? { label: "Send the draft", run: () => form.requestSubmit() } : null;
}

/** Runs `line` in the editor it came from, once the palette has closed and focus is back. */
export function inEditor(origin: KeyOrigin | null, line: string): (() => void) | null {
  const view = origin?.view;
  if (!view) return null;
  return () =>
    requestAnimationFrame(() => {
      view.focus();
      runVimEx(view, line);
    });
}

const entry = (label: string, run: (() => void) | null): AppCommand => ({
  label,
  disabled: run === null,
  run: () => run?.(),
});

/** One of Astrolabe's commands, acting on what is on screen now. */
function astrolabeCommand(
  command: AstrolabeKeybindingCommand,
  context: AppCommandContext,
): AppCommand {
  const { chatTabs, panes, section } = context;
  const focused = panes ? focusedPaneOf(panes.controller) : null;
  const onPane = (
    can: boolean,
    act: (handle: PanesHandle, leaf: NonNullable<typeof focused>["leaf"]) => void,
  ) => (panes && focused && can ? () => act(panes, focused.leaf) : null);
  const stepTab = (step: 1 | -1) => {
    const next = chatTabs ? cycleKey(chatTabs.keys, chatTabs.activeKey, step) : null;
    return next !== null && chatTabs ? () => chatTabs.select(next) : null;
  };

  switch (command) {
    case "commandLine.open":
      return entry("Command palette", () => context.openCommandLine());
    case "section.new":
      if (section) {
        return entry(section.newItemLabel, section.newItemDisabled ? null : section.newItem);
      }
      return upstreamCommand("chat.new", context);
    case "section.threads":
    case "section.wikis":
    case "section.pullRequests":
    case "section.usage":
    case "section.settings": {
      const target = context.sections.find((candidate) => candidate.id === SECTION_IDS[command]);
      return entry(target?.label ?? commandLabel(command), target?.open ?? null);
    }
    case "chatTab.next":
      return entry("Next tab", stepTab(1));
    case "chatTab.previous":
      return entry("Previous tab", stepTab(-1));
    case "chatTab.close": {
      const active = chatTabs?.activeKey;
      return entry("Close tab", chatTabs && active ? () => chatTabs.close(active) : null);
    }
    case "pane.splitRight":
      return entry(
        "Split right",
        onPane(!!focused && canSplitPane(focused.leaf), (handle, leaf) =>
          splitPane(handle.controller, leaf, "right"),
        ),
      );
    case "pane.splitDown":
      return entry(
        "Split down",
        onPane(!!focused && canSplitPane(focused.leaf), (handle, leaf) =>
          splitPane(handle.controller, leaf, "bottom"),
        ),
      );
    case "pane.close":
      return entry(
        "Close pane",
        onPane(!!focused && canClosePane(focused.leaf, focused.alone), (handle, leaf) =>
          closePane(handle.tabs, leaf),
        ),
      );
    case "pane.toggleMaximized": {
      const maximized =
        panes && focused ? isPaneMaximized(panes.layoutKey, focused.leaf.id) : false;
      // A lone pane already fills the panes' room.
      return entry(
        maximized ? "Restore pane" : "Maximize pane",
        onPane(!!focused && !focused.alone, (handle, leaf) =>
          toggleMaximizedPane(handle.controller, handle.layoutKey, leaf.id),
        ),
      );
    }
    case "wiki.findDocument":
      return entry("Find or create a document", context.findDocument);
    case "tab.close":
      return entry("Close tab", closeTarget(context));
    case "draft.write": {
      const write = writeTarget(context.origin);
      return entry(write?.label ?? "Nothing to write here", write?.run ?? null);
    }
    case "buffer.open":
      return entry("Switch to a thread", () => context.openCommandLine("b "));
    case "document.open":
      return entry("Open a document", () => context.openCommandLine("e "));
    case "search.clearHighlight":
      return entry(
        context.origin?.view ? "Clear search highlight" : "Nothing highlighted here",
        inEditor(context.origin, "nohlsearch"),
      );
  }
}

/** An upstream command, pressed through its shortcut; faint without one. */
function upstreamCommand(command: KeybindingCommand, context: AppCommandContext): AppCommand {
  const label = UPSTREAM_LABELS[command] ?? commandLabel(command);
  // Search has no default shortcut of its own (mod+k is the menu's), nor the file picker (mod+p
  // is the Command Palette's): they open directly.
  if (command === "commandPalette.toggle") return entry(label, context.openSearch);
  if (command === "filePicker.toggle") return entry(label, context.openFilePicker);
  const { keybindings } = context;
  return entry(
    label,
    shortcutForCommand(keybindings, command)
      ? () => runKeybindingCommand(keybindings, command)
      : null,
  );
}

/** The registry's entry for `command`, as it stands in `context`. */
export function appCommand(command: KeybindingCommand, context: AppCommandContext): AppCommand {
  return isAppCommand(command)
    ? astrolabeCommand(command, context)
    : upstreamCommand(command, context);
}

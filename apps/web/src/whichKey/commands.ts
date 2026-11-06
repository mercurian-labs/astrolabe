import {
  ASTROLABE_KEYBINDING_COMMANDS,
  CODE_EDITOR_KEYBINDING_COMMANDS,
  type AstrolabeKeybindingCommand,
  type CodeEditorKeybindingCommand,
  type KeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { hasCodeEditing, runCodeEditing, softWrapOn } from "@mercurian/editor/code/editing";
import { hasGitChanges, runHunkCommand, type HunkCommand } from "@mercurian/editor/git";
import { hasInFileSearch, openInFileSearch } from "@mercurian/editor/search";
import { hasOutline } from "@mercurian/editor/outline";
import { excerptControls, isExcerpt } from "@mercurian/editor/multibuffer/excerpt";
import {
  hasDiagnosticsUi,
  nextDiagnostic,
  previousDiagnostic,
} from "@mercurian/editor/lsp/diagnostics";
import { startCompletion } from "@mercurian/editor/lsp/completion";
import { showHover, showSignatureHelp } from "@mercurian/editor/lsp/hover";
import {
  findReferences,
  goToDeclaration,
  goToDefinition,
  goToImplementation,
  goToTypeDefinition,
} from "@mercurian/editor/lsp/navigation";
import { renameSymbol } from "@mercurian/editor/lsp/rename";
import { formatCode } from "@mercurian/editor/lsp/format";
import { showCodeActions } from "@mercurian/editor/lsp/code-actions";
import { fileSave, hasFileSave } from "~/components/repositories/fileSave";
import { getClientSettings, updateClientSettings } from "~/hooks/useSettings";
import {
  canMaintainLanguageServers,
  hasLanguageServerFile,
  languageServerFile,
  languageServerFileOfTab,
  restartLanguageServer,
  stopLanguageServer,
  trustLanguageServerProject,
  type LanguageServerFile,
} from "~/components/repositories/languageServerFile";
import { lastRename } from "~/components/repositories/renameUndo";
import { hasLanguageServer } from "@mercurian/editor/lsp";
import type { EditorState } from "@codemirror/state";
import { runVimEx } from "@mercurian/editor/vim";
import { EditorView } from "@codemirror/view";

import { diffBaseControl, hasDiffBaseControl } from "~/components/repositories/fileDiffBase";
import { commandLabel } from "~/components/settings/KeybindingsSettings.logic";
import { codeEditingCommandOf } from "~/editorKeybindings";
import { openOutlinePicker } from "~/components/outline/OutlinePicker";
import { isEmptyTab } from "~/panes/arrangement";
import { focusedChatOf, workspace } from "~/panes/workspace";
import { parseChatTabKey } from "~/sectionTabs/sectionTabs";
import {
  canClosePane,
  canSplitPane,
  closePane,
  focusedPaneOf,
  isPaneMaximized,
  splitPane,
  toggleMaximizedPane,
} from "~/panes/paneCommands";
import { localGraphOpener } from "~/components/repositories/localGraph";
import { problemsOpener } from "~/components/repositories/multibuffer/openMultibuffer";
import { focusRegion, regionToward } from "~/keyboardNav/regions";
import { isListRow } from "~/keyboardNav/placeLists";
import type { FocusDirection } from "~/keyboardNav/regions.logic";
import { scrollToward } from "~/keyboardNav/scroll";
import type { ScrollDirection } from "~/keyboardNav/scroll.logic";
import type { EditorWrite, KeyOrigin } from "./doors";
import type {
  ChatTabsHandle,
  PanesHandle,
  SidebarSectionHandle,
  TabHistoryHandle,
} from "./handles";
import { runKeybindingCommand, shortcutForCommand } from "./keybindingCommands";

/**
 * The client's command registry: one entry per command the keyboard menu, Command Palette and
 * shortcuts run, with its label (which may depend on where it runs), whether it can run now, and
 * how. Astrolabe's commands act on the on-screen surfaces (`handles.ts`); upstream's run through
 * their shortcut handlers (`runKeybindingCommand`), so they need a shortcut.
 */
export interface AppCommandContext {
  /** The sidebar section's title row, while one is mounted (Agents, Wikis): its new button. */
  readonly section: SidebarSectionHandle | null;
  readonly chatTabs: ChatTabsHandle | null;
  readonly panes: PanesHandle | null;
  /** The back and forward of the section's tab in front, in a section with tabs. */
  readonly tabHistory?: TabHistoryHandle | null;
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
  /**
   * Run again and again in a row: from the keyboard menu its key repeats for the repeat window
   * after it (`menuRepeatWindowMs`), and its shortcut repeats while held.
   */
  readonly repeatable?: boolean;
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
  "rightPanel.toggle": "Toggle right panel",
  "navigation.back": "Back",
  "navigation.forward": "Forward",
};

const SECTION_IDS: Partial<Record<AstrolabeKeybindingCommand, string>> = {
  "section.threads": "threads",
  "section.wikis": "wikis",
  "section.repositories": "repositories",
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

const COMPOSER = '[data-testid="composer-editor"]';

/**
 * `:w` where it came from, else the focused chat's composer, which sends its draft. In the shared
 * panes that is the chat in focus (or whose linked tab is): chats kept out of sight stay in the
 * page, so the first composer there may be one no one sees.
 */
function writeTarget(origin: KeyOrigin | null): EditorWrite | null {
  if (origin?.view) return origin.write;
  const chat = focusedChatOf(workspace.linked());
  const tabs = [...document.querySelectorAll<HTMLElement>("[data-workspace-tab]")];
  const scope =
    tabs.length === 0 ? document : tabs.find((tab) => tab.dataset.workspaceTab === chat);
  const form = scope?.querySelector(COMPOSER)?.closest("form");
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

/**
 * The editor the key came from whose state `has` what is asked: the one holding the focused
 * element, or the one around it (a table cell's editor sits inside its note's); null elsewhere.
 */
function editorFrom(
  origin: KeyOrigin | null,
  has: (state: EditorState) => boolean,
): EditorView | null {
  for (
    let editor = origin?.element?.closest(".cm-editor") ?? null;
    editor;
    editor = editor.parentElement?.closest(".cm-editor") ?? null
  ) {
    const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null;
    if (view && has(view.state)) return view;
  }
  return null;
}

const HUNK_ENTRIES: Record<
  Exclude<Extract<AstrolabeKeybindingCommand, `hunk.${string}`>, "hunk.toggleBase">,
  { readonly command: HunkCommand; readonly label: string }
> = {
  "hunk.toggle": { command: "toggle", label: "Show or hide change" },
  "hunk.expandAll": { command: "expandAll", label: "Show all changes" },
  "hunk.restore": { command: "restore", label: "Restore change" },
  "hunk.next": { command: "next", label: "Next change" },
  "hunk.previous": { command: "previous", label: "Previous change" },
};

/** A language-server command on the code file the key came from; faint where none serves it. */
function lspEntry(origin: KeyOrigin | null, label: string, run: (view: EditorView) => boolean) {
  const view = editorFrom(origin, hasLanguageServer);
  return entry(
    view ? label : "No language server here",
    view ? () => afterPalette(() => void run(view)) : null,
  );
}

/**
 * A command on a language server: of the code file the key came from, else the file in front of
 * the focused pane. `run` is null to read faint under `label`, as when nothing can be done now.
 */
function languageServerEntry(
  context: AppCommandContext,
  label: string,
  run: (file: LanguageServerFile) => (() => void) | null,
) {
  const view = editorFrom(context.origin, hasLanguageServerFile);
  const pane = context.panes ? focusedPaneOf(context.panes.controller) : null;
  const file =
    view?.state.facet(languageServerFile) ??
    (pane ? languageServerFileOfTab(pane.leaf.active) : null);
  if (!file) return entry("No language server here", null);
  const act = run(file);
  return entry(label, act && (() => afterPalette(act)));
}

/** `act` where it applies (`can`) and this client may maintain the environment's servers. */
const maintaining = (file: LanguageServerFile, can: boolean, act: () => void) =>
  can && canMaintainLanguageServers(file.environmentId) ? act : null;

/** A change command on the code file the key came from; faint where no file shows changes. */
function hunkEntry(command: keyof typeof HUNK_ENTRIES, origin: KeyOrigin | null): AppCommand {
  const { command: hunk, label } = HUNK_ENTRIES[command];
  const view = editorFrom(origin, hasGitChanges);
  return entry(
    view ? label : "No changes here",
    view
      ? () =>
          afterPalette(() => {
            view.focus();
            runHunkCommand(view, hunk);
          })
      : null,
  );
}

/**
 * Runs `run` on a frame after the Command Palette has gone (it hands focus back as it leaves),
 * waiting out its closing for a few frames at most.
 */
function afterPalette(run: () => void, frames = 30) {
  requestAnimationFrame(() => {
    if (frames > 0 && document.querySelector("[data-command-palette]"))
      afterPalette(run, frames - 1);
    else run();
  });
}

/**
 * Moves focus to the region `direction` from where the key came from (see `regions.ts`), once the
 * menu or palette it may have come through has closed; null with nowhere to go.
 */
function focusToward(direction: FocusDirection, origin: KeyOrigin | null): (() => void) | null {
  // Outside a page (the registry's tests) there is no focus to move.
  if (typeof document === "undefined") return null;
  const target = regionToward(direction, origin?.element ?? document.activeElement);
  return target ? () => afterPalette(() => focusRegion(target)) : null;
}

/**
 * Scrolls the place the key came from (see `scroll.ts`) half a page; null where it cannot go
 * that way.
 */
function scrollFrom(direction: ScrollDirection, origin: KeyOrigin | null): (() => void) | null {
  // Outside a page (the registry's tests) there is nothing to scroll.
  if (typeof document === "undefined") return null;
  return scrollToward(direction, origin?.element ?? document.activeElement);
}

const entry = (label: string, run: (() => void) | null): AppCommand => ({
  label,
  disabled: run === null,
  run: () => run?.(),
});

const repeatableEntry = (label: string, run: (() => void) | null): AppCommand => ({
  ...entry(label, run),
  repeatable: true,
});

/**
 * A focus move. Up or down with nowhere to go from a list's row (the sidebar's, the rail's), its
 * key (`j`, ArrowDown …) is the list's: it does not repeat, so in the repeat window after Space
 * `h` it ends the window and steps the list rather than being spent on a move that cannot happen.
 */
function focusEntry(label: string, direction: FocusDirection, origin: KeyOrigin | null) {
  const run = focusToward(direction, origin);
  const vertical = direction === "up" || direction === "down";
  const element = origin?.element ?? null;
  const listKey = run === null && vertical && element !== null && isListRow(element);
  return listKey ? entry(label, null) : repeatableEntry(label, run);
}

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
    case "section.repositories":
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
    case "pane.toggleFullScreen": {
      const panel = panes?.panel ?? null;
      const state = focused
        ? fullScreenState({
            alone: focused.alone,
            paneMaximized: !!panes && isPaneMaximized(panes.layoutKey, focused.leaf.id),
            panelMaximized: panel ? panel.maximized : null,
          })
        : null;
      return entry(
        state?.full && state.change ? "Exit full screen" : "Full screen pane",
        onPane(!!state?.change, (handle, leaf) => {
          const change = state?.change;
          if (!change) return;
          if (change.pane) toggleMaximizedPane(handle.controller, handle.layoutKey, leaf.id);
          if (change.panel !== null) panel?.setMaximized(change.panel);
        }),
      );
    }
    case "focus.left":
      return focusEntry("Focus left", "left", context.origin);
    case "focus.down":
      return focusEntry("Focus down", "down", context.origin);
    case "focus.up":
      return focusEntry("Focus up", "up", context.origin);
    case "focus.right":
      return focusEntry("Focus right", "right", context.origin);
    case "scroll.down":
      return repeatableEntry("Scroll down", scrollFrom("down", context.origin));
    case "scroll.up":
      return repeatableEntry("Scroll up", scrollFrom("up", context.origin));
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
    case "search.find": {
      const view = editorFrom(context.origin, hasInFileSearch);
      return entry(
        view ? "Find in editor" : "No editor to find in",
        view ? () => afterPalette(() => openInFileSearch(view)) : null,
      );
    }
    case "hunk.toggle":
    case "hunk.expandAll":
    case "hunk.restore":
    case "hunk.next":
    case "hunk.previous":
      return hunkEntry(command, context.origin);
    case "hunk.toggleBase": {
      const control = editorFrom(context.origin, hasDiffBaseControl)?.state.facet(diffBaseControl);
      const current = control?.current();
      return entry(
        current?.turnAvailable
          ? current.base === "turn"
            ? "Compare with HEAD"
            : "Compare since this turn"
          : "No turn changed this file",
        control && current?.turnAvailable ? control.toggle : null,
      );
    }
    case "diagnostic.next":
    case "diagnostic.previous": {
      const view = editorFrom(context.origin, hasDiagnosticsUi);
      const next = command === "diagnostic.next";
      return entry(
        view ? (next ? "Next problem" : "Previous problem") : "No problems shown here",
        view
          ? () => afterPalette(() => void (next ? nextDiagnostic : previousDiagnostic)(view))
          : null,
      );
    }
    case "lsp.complete":
      return lspEntry(context.origin, "Show completions", startCompletion);
    case "lsp.hover":
      return lspEntry(context.origin, "Show hover", showHover);
    case "lsp.signatureHelp":
      return lspEntry(context.origin, "Show signature help", showSignatureHelp);
    case "lsp.definition":
      return lspEntry(context.origin, "Go to definition", goToDefinition);
    case "lsp.declaration":
      return lspEntry(context.origin, "Go to declaration", goToDeclaration);
    case "lsp.typeDefinition":
      return lspEntry(context.origin, "Go to type definition", goToTypeDefinition);
    case "lsp.implementation":
      return lspEntry(context.origin, "Go to implementation", goToImplementation);
    case "lsp.references":
      return lspEntry(context.origin, "Find references", findReferences);
    case "lsp.rename":
      return lspEntry(context.origin, "Rename symbol", renameSymbol);
    case "lsp.format":
      return lspEntry(context.origin, "Format document", formatCode);
    case "lsp.codeActions":
      return lspEntry(context.origin, "Show code actions", showCodeActions);
    case "lsp.restartServer":
      return languageServerEntry(context, "Restart language server", (file) =>
        maintaining(file, true, () => restartLanguageServer(file)),
      );
    case "lsp.stopServer":
      return languageServerEntry(context, "Stop language server", (file) => {
        const state = file.status()?.state;
        const running = state === "ready" || state === "starting";
        return maintaining(file, running, () => stopLanguageServer(file));
      });
    case "lsp.trustProject":
      return languageServerEntry(context, "Trust project", (file) => {
        const status = file.status();
        const untrusted = status?.restricted === true || status?.state === "trust-needed";
        return maintaining(file, untrusted, () => trustLanguageServerProject(file));
      });
    case "lsp.checkServers":
      return languageServerEntry(context, "Check language servers", (file) => file.openSettings);
    case "lsp.viewLogs":
      return languageServerEntry(
        context,
        "View language server logs",
        (file) => () => file.openLogs(),
      );
    case "file.save": {
      const view = editorFrom(context.origin, hasFileSave);
      const run = view?.state.facet(fileSave) ?? null;
      return entry(run ? "Save file" : "No file to save here", run);
    }
    case "lsp.toggleInlayHints": {
      const on = getClientSettings().inlayHints;
      return entry(on ? "Hide inlay hints" : "Show inlay hints", () =>
        updateClientSettings({ inlayHints: !on }),
      );
    }
    case "lsp.toggleInlineDiagnostics": {
      const on = getClientSettings().inlineDiagnostics;
      return entry(on ? "Hide inline diagnostics" : "Show inline diagnostics", () =>
        updateClientSettings({ inlineDiagnostics: !on }),
      );
    }
    case "lsp.undoRename": {
      const rename = lastRename.get();
      return entry(rename?.label ?? "No rename to undo", rename?.run ?? null);
    }
    case "outline.open": {
      const view = editorFrom(context.origin, hasOutline);
      return entry(
        view ? "Go to symbol" : "No file to outline",
        view ? () => afterPalette(() => openOutlinePicker(view)) : null,
      );
    }
    case "repository.localGraph":
      return entry("Open local graph", localGraphOpener(panes?.controller ?? null));
    case "multibuffer.expand":
    case "multibuffer.openExcerpt":
    case "multibuffer.nextFile":
    case "multibuffer.previousFile": {
      const view = editorFrom(context.origin, isExcerpt);
      const controls = view ? excerptControls(view.state) : null;
      const labels = {
        "multibuffer.expand": "Show more lines around excerpt",
        "multibuffer.openExcerpt": "Open excerpt in its file",
        "multibuffer.nextFile": "Next file in results",
        "multibuffer.previousFile": "Previous file in results",
      } as const;
      return entry(
        controls ? labels[command] : "No results here",
        view && controls
          ? () =>
              afterPalette(() => {
                if (command === "multibuffer.expand") controls.expand(0, 0);
                else if (command === "multibuffer.openExcerpt") {
                  controls.open(view.state.doc.lineAt(view.state.selection.main.head).number);
                } else controls.jumpFile(command === "multibuffer.nextFile" ? 1 : -1);
              })
          : null,
      );
    }
    case "multibuffer.problems": {
      const open = problemsOpener(panes?.controller ?? null);
      return entry(open ? "Show problems" : "No project in front", open);
    }
    case "projectSearch.openInEditor":
      return entry("Open results in editor, from project search", null);
    case "tab.toggleLink": {
      const link = focused ? (panes?.tabs.link?.(focused.leaf.active) ?? null) : null;
      return entry(link?.label ?? "Unlink tab", link?.run ?? null);
    }
    case "tab.newLinked": {
      const chat = focusedChatOf(workspace.linked());
      return entry("New linked tab", chat ? () => workspace.newLinkedTab(chat) : null);
    }
  }
}

/**
 * Full screen for the focused pane: once maximized or alone it fills the content area, and in a
 * thread's right panel (`panelMaximized` not null) the panel maximizes over the chat column too;
 * pressed again it restores both. `change` is null with nothing to do (a lone pane in the Wikis or
 * Pull Requests area already fills it).
 */
export function fullScreenState(pane: {
  readonly alone: boolean;
  readonly paneMaximized: boolean;
  readonly panelMaximized: boolean | null;
}): {
  readonly full: boolean;
  readonly change: { readonly pane: boolean; readonly panel: boolean | null } | null;
} {
  const { alone, paneMaximized, panelMaximized } = pane;
  const full = (alone || paneMaximized) && panelMaximized !== false;
  if (full) {
    if (!paneMaximized && !panelMaximized) return { full, change: null };
    return { full, change: { pane: paneMaximized, panel: panelMaximized ? false : null } };
  }
  return {
    full,
    change: { pane: !alone && !paneMaximized, panel: panelMaximized === false ? true : null },
  };
}

/** An upstream command, pressed through its shortcut; faint without one. */
function upstreamCommand(command: KeybindingCommand, context: AppCommandContext): AppCommand {
  // The right panel is a thread's: with no chat on screen there is none to toggle.
  if (command === "rightPanel.toggle" && context.chatTabs === null) {
    return entry(UPSTREAM_LABELS[command] ?? commandLabel(command), null);
  }
  // The terminal drawer is the focused chat tab's: with anything else in focus there is none.
  const focusedTab = context.chatTabs?.activeKey ?? null;
  if (command === "terminal.toggle" && (focusedTab === null || !parseChatTabKey(focusedTab))) {
    return entry(UPSTREAM_LABELS[command] ?? commandLabel(command), null);
  }
  const label = UPSTREAM_LABELS[command] ?? commandLabel(command);
  // In a section with tabs, back and forward walk the tab in front (through their shortcut, as
  // elsewhere), faint with nothing that way.
  const tabHistory = context.tabHistory ?? null;
  if (tabHistory && command === "navigation.back" && !tabHistory.canGoBack) {
    return entry(label, null);
  }
  if (tabHistory && command === "navigation.forward" && !tabHistory.canGoForward) {
    return entry(label, null);
  }
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

const CODE_COMMANDS = new Set<KeybindingCommand>(CODE_EDITOR_KEYBINDING_COMMANDS);

const isCodeEditorCommand = (command: KeybindingCommand): command is CodeEditorKeybindingCommand =>
  CODE_COMMANDS.has(command);

/** A code file's commands as the menu says them. */
const CODE_COMMAND_LABELS: Readonly<Record<CodeEditorKeybindingCommand, string>> = {
  "code.selectNextOccurrence": "Select next occurrence",
  "code.skipOccurrence": "Skip this occurrence",
  "code.selectAllOccurrences": "Select all occurrences",
  "code.addCursorAbove": "Add cursor above",
  "code.addCursorBelow": "Add cursor below",
  "code.expandSelection": "Expand selection",
  "code.toggleComment": "Toggle comment",
  "code.indentLess": "Indent less",
  "code.indentMore": "Indent more",
  "code.moveLineUp": "Move line up",
  "code.moveLineDown": "Move line down",
  "code.copyLineUp": "Copy line up",
  "code.copyLineDown": "Copy line down",
  "code.deleteLine": "Delete line",
  "code.joinLines": "Join lines",
  "code.sortLines": "Sort lines",
  "code.upperCase": "Upper case",
  "code.lowerCase": "Lower case",
  "code.duplicateSelection": "Duplicate selection",
  "code.fold": "Fold",
  "code.unfold": "Unfold",
  "code.foldAll": "Fold all",
  "code.unfoldAll": "Unfold all",
  "code.toggleSoftWrap": "Wrap lines",
};

/** The commands that change no text, so they run in a read-only file too. */
const READING_CODE_COMMANDS = new Set<CodeEditorKeybindingCommand>([
  "code.selectNextOccurrence",
  "code.skipOccurrence",
  "code.selectAllOccurrences",
  "code.addCursorAbove",
  "code.addCursorBelow",
  "code.expandSelection",
  "code.fold",
  "code.unfold",
  "code.foldAll",
  "code.unfoldAll",
  "code.toggleSoftWrap",
]);

/**
 * One of a code file's editing commands, run in the code editor the key came from once the
 * palette has gone; faint elsewhere, and for edits in a file that cannot be edited.
 */
function codeEditorCommand(
  command: CodeEditorKeybindingCommand,
  context: AppCommandContext,
): AppCommand {
  const view = editorFrom(context.origin, hasCodeEditing);
  const label =
    command === "code.toggleSoftWrap" && view && softWrapOn(view.state)
      ? "Stop wrapping lines"
      : CODE_COMMAND_LABELS[command];
  const runs = view && (READING_CODE_COMMANDS.has(command) || !view.state.readOnly);
  return entry(
    label,
    runs
      ? () =>
          afterPalette(() => {
            view.focus();
            runCodeEditing(view, codeEditingCommandOf(command));
          })
      : null,
  );
}

/** The registry's entry for `command`, as it stands in `context`. */
export function appCommand(command: KeybindingCommand, context: AppCommandContext): AppCommand {
  if (isCodeEditorCommand(command)) return codeEditorCommand(command, context);
  return isAppCommand(command)
    ? astrolabeCommand(command, context)
    : upstreamCommand(command, context);
}

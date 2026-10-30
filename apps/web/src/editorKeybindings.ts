import {
  CODE_EDITOR_KEYBINDING_COMMANDS,
  LSP_KEYBINDING_COMMANDS,
  type LspKeybindingCommand,
  MARKDOWN_KEYBINDING_COMMANDS,
  type KeybindingCommand,
  type KeybindingShortcut,
  type MarkdownKeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import type { CodeEditingCommand, CodeEditingKeys } from "@mercurian/editor/code/editing";
import type { HunkCommand } from "@mercurian/editor/git";
import type { DiagnosticKeys } from "@mercurian/editor/lsp/diagnostics";
import type { LivePreviewOptions } from "@mercurian/editor/markdown";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { whenClauseHolds } from "./keybindings";
import { primaryServerKeybindingsAtom } from "./state/server";

/**
 * Astrolabe: the editors' own keys, in CodeMirror's notation, from each command's shortcuts whose
 * `when` holds there: `markdown.*` format, `search.find` opens the find bar, and in a code file
 * `hunk.*` act on its changes and `code.*` (under `codeEditorFocus`) edit it.
 */

const CODEMIRROR_KEY_NAMES: Readonly<Record<string, string>> = {
  " ": "Space",
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};

/** A shortcut in CodeMirror's notation: `mod+shift+k` is `Mod-Shift-k`. */
export function codeMirrorKey(shortcut: KeybindingShortcut): string {
  const parts: string[] = [];
  if (shortcut.modKey) parts.push("Mod");
  if (shortcut.metaKey) parts.push("Meta");
  if (shortcut.ctrlKey) parts.push("Ctrl");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");
  const key = shortcut.key;
  parts.push(CODEMIRROR_KEY_NAMES[key] ?? (/^f\d{1,2}$/.test(key) ? key.toUpperCase() : key));
  return parts.join("-");
}

const editorCommandOf = (command: MarkdownKeybindingCommand) =>
  command.slice("markdown.".length) as keyof NonNullable<LivePreviewOptions["keys"]>;

/** The formatting keys for an editor: every command named, with no keys when it has none. */
export function markdownEditorKeys(
  keybindings: ResolvedKeybindingsConfig,
  editor: { readonly composer: boolean },
): NonNullable<LivePreviewOptions["keys"]> {
  const context = { editorFocus: true, composerFocus: editor.composer };
  return Object.fromEntries(
    MARKDOWN_KEYBINDING_COMMANDS.map((command) => [
      editorCommandOf(command),
      keybindings
        .filter(
          (binding) => binding.command === command && whenClauseHolds(binding.whenAst, { context }),
        )
        .map((binding) => codeMirrorKey(binding.shortcut)),
    ]),
  );
}

/**
 * `keys` as first seen until they change in substance: the keybindings list is rebuilt on every
 * server config update, and a new keys object recreates the editor.
 */
function useStableKeys<Keys>(keys: Keys): Keys {
  const signature = JSON.stringify(keys);
  const [stable, setStable] = useState({ signature, keys });
  if (stable.signature === signature) return stable.keys;
  setStable({ signature, keys });
  return keys;
}

/** An editor's formatting keys, the same object until they change. */
export function useMarkdownEditorKeys(editor: { readonly composer: boolean }) {
  return useStableKeys(markdownEditorKeys(useAtomValue(primaryServerKeybindingsAtom), editor));
}

/** A code or note editor's keys for `command`, in CodeMirror's notation. */
function editorKeysFor(keybindings: ResolvedKeybindingsConfig, command: KeybindingCommand) {
  const context = { editorFocus: true, composerFocus: false };
  return keybindings
    .filter(
      (binding) => binding.command === command && whenClauseHolds(binding.whenAst, { context }),
    )
    .map((binding) => codeMirrorKey(binding.shortcut));
}

/** The keys that open an editor's find bar (`search.find`), in CodeMirror's notation. */
export function editorFindKeys(keybindings: ResolvedKeybindingsConfig): string[] {
  return editorKeysFor(keybindings, "search.find");
}

const HUNK_COMMANDS: Readonly<Record<HunkCommand, KeybindingCommand>> = {
  toggle: "hunk.toggle",
  expandAll: "hunk.expandAll",
  restore: "hunk.restore",
  next: "hunk.next",
  previous: "hunk.previous",
};

/** A code file's keys for its changes since the last commit (`hunk.*`). */
export function editorHunkKeys(
  keybindings: ResolvedKeybindingsConfig,
): Record<HunkCommand, string[]> {
  return {
    toggle: editorKeysFor(keybindings, HUNK_COMMANDS.toggle),
    expandAll: editorKeysFor(keybindings, HUNK_COMMANDS.expandAll),
    restore: editorKeysFor(keybindings, HUNK_COMMANDS.restore),
    next: editorKeysFor(keybindings, HUNK_COMMANDS.next),
    previous: editorKeysFor(keybindings, HUNK_COMMANDS.previous),
  };
}

/** The find bar's keys, the same array until they change. */
export function useEditorFindKeys(): readonly string[] {
  return useStableKeys(editorFindKeys(useAtomValue(primaryServerKeybindingsAtom)));
}

/** A code file's change keys, the same object until they change. */
export function useEditorHunkKeys() {
  return useStableKeys(editorHunkKeys(useAtomValue(primaryServerKeybindingsAtom)));
}

/**
 * The editor's name for a code command: `code.sortLines` is `sortLines`. Typed so every
 * `CODE_EDITOR_KEYBINDING_COMMANDS` entry must name one of the editor's commands.
 */
export const codeEditingCommandOf = (command: `code.${CodeEditingCommand}`) =>
  command.slice("code.".length) as CodeEditingCommand;

/** A code file's editing keys: every `code.*` command's shortcuts that hold in a code editor. */
export function codeEditorKeys(keybindings: ResolvedKeybindingsConfig): CodeEditingKeys {
  const context = { editorFocus: true, codeEditorFocus: true, composerFocus: false };
  return Object.fromEntries(
    CODE_EDITOR_KEYBINDING_COMMANDS.map((command) => [
      codeEditingCommandOf(command),
      keybindings
        .filter(
          (binding) => binding.command === command && whenClauseHolds(binding.whenAst, { context }),
        )
        .map((binding) => codeMirrorKey(binding.shortcut)),
    ]),
  );
}

/** A code file's editing keys, the same object until they change. */
export function useCodeEditorKeys(): CodeEditingKeys {
  return useStableKeys(codeEditorKeys(useAtomValue(primaryServerKeybindingsAtom)));
}

/** A code file's keys to step through its diagnostics (`diagnostic.*`). */
function editorDiagnosticKeys(keybindings: ResolvedKeybindingsConfig): DiagnosticKeys {
  const context = { editorFocus: true, codeEditorFocus: true, composerFocus: false };
  const keysFor = (command: KeybindingCommand) =>
    keybindings
      .filter(
        (binding) => binding.command === command && whenClauseHolds(binding.whenAst, { context }),
      )
      .map((binding) => codeMirrorKey(binding.shortcut));
  return { next: keysFor("diagnostic.next"), previous: keysFor("diagnostic.previous") };
}

/** A code file's diagnostic keys, the same object until they change. */
export function useEditorDiagnosticKeys(): DiagnosticKeys {
  return useStableKeys(editorDiagnosticKeys(useAtomValue(primaryServerKeybindingsAtom)));
}

/** The keys that save a code file (`file.save`), in CodeMirror's notation. */
export function fileSaveKeys(keybindings: ResolvedKeybindingsConfig): string[] {
  const context = { editorFocus: true, codeEditorFocus: true, composerFocus: false };
  return keybindings
    .filter(
      (binding) => binding.command === "file.save" && whenClauseHolds(binding.whenAst, { context }),
    )
    .map((binding) => codeMirrorKey(binding.shortcut));
}

/** A code file's save keys, the same array until they change. */
export function useFileSaveKeys(): readonly string[] {
  return useStableKeys(fileSaveKeys(useAtomValue(primaryServerKeybindingsAtom)));
}

/** A code file's language-server keys (`lsp.*`), by command. */
function lspEditorKeys(
  keybindings: ResolvedKeybindingsConfig,
): Record<LspKeybindingCommand, string[]> {
  const context = { editorFocus: true, codeEditorFocus: true, composerFocus: false };
  return Object.fromEntries(
    LSP_KEYBINDING_COMMANDS.map((command) => [
      command,
      keybindings
        .filter(
          (binding) => binding.command === command && whenClauseHolds(binding.whenAst, { context }),
        )
        .map((binding) => codeMirrorKey(binding.shortcut)),
    ]),
  ) as Record<LspKeybindingCommand, string[]>;
}

/** A code file's language-server keys, the same object until they change. */
export function useLspEditorKeys() {
  return useStableKeys(lspEditorKeys(useAtomValue(primaryServerKeybindingsAtom)));
}

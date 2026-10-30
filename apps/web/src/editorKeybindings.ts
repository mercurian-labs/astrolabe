import {
  MARKDOWN_KEYBINDING_COMMANDS,
  type KeybindingCommand,
  type KeybindingShortcut,
  type MarkdownKeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import type { HunkCommand } from "@mercurian/editor/git";
import type { LivePreviewOptions } from "@mercurian/editor/markdown";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { whenClauseHolds } from "./keybindings";
import { primaryServerKeybindingsAtom } from "./state/server";

/**
 * Astrolabe: the editors' own keys from the keybindings. Each `markdown.*` command's shortcuts
 * whose `when` holds in that editor (`editorFocus`, and `composerFocus` in the composer) become
 * the live preview's keys for it, `search.find`'s open the find bar, and `hunk.*`'s act on a code
 * file's changes, in CodeMirror's notation.
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

import {
  MARKDOWN_KEYBINDING_COMMANDS,
  type KeybindingShortcut,
  type MarkdownKeybindingCommand,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import type { LivePreviewOptions } from "@mercurian/editor/markdown";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { whenClauseHolds } from "./keybindings";
import { primaryServerKeybindingsAtom } from "./state/server";

/**
 * Astrolabe: the Markdown editors' formatting keys from the keybindings. Each `markdown.*`
 * command's shortcuts whose `when` holds in that editor (`editorFocus`, and `composerFocus` in
 * the composer) become the live preview's keys for it, in CodeMirror's notation.
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
 * An editor's formatting keys, the same object until they change: the keybindings list is rebuilt
 * on every server config update, and a new keys object recreates the editor.
 */
export function useMarkdownEditorKeys(editor: { readonly composer: boolean }) {
  const keys = markdownEditorKeys(useAtomValue(primaryServerKeybindingsAtom), editor);
  const signature = JSON.stringify(keys);
  const [stable, setStable] = useState({ signature, keys });
  if (stable.signature === signature) return stable.keys;
  setStable({ signature, keys });
  return keys;
}

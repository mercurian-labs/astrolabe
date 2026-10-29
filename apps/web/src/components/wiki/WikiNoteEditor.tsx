import "@mercurian/editor/markdown/theme.css";
import "@mercurian/editor/markdown/katex.css";

import { agentChangeBar } from "@mercurian/editor/collab/agent-changes";
import { AtlasEditor } from "@mercurian/editor/editor";
import { vimNormalModeFont } from "@mercurian/editor/vim";
import type { LivePreviewOptions } from "@mercurian/editor/markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ClientSettings } from "@t3tools/contracts";
import { useLayoutEffect, useRef, useState } from "react";

import { useMarkdownEditorKeys } from "~/editorKeybindings";
import { useVimScreenLines } from "~/vimScreenLines";
import { useClientSettings } from "~/hooks/useSettings";
import { appVimKeys } from "~/whichKey/doors";

import type { WikiNoteSession } from "@mercurian/wiki-editor/note-buffer";
import { wikilinkNoteName } from "@mercurian/wiki-editor/incoming";

// The live preview reads the app's theme tokens, so a note matches the rest of the app in
// light, dark, and custom themes. Module-level: a new array would remount the editor.
const WIKI_EDITOR_THEME = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    "--atlas-md-font-mono": "var(--font-mono)",
    "--atlas-md-syntax-color": "var(--muted-foreground)",
    "--atlas-md-code-label-color": "var(--muted-foreground)",
    "--atlas-md-bullet-color": "var(--muted-foreground)",
    "--atlas-md-quote-color": "var(--muted-foreground)",
    "--atlas-md-quote-border": "var(--border)",
    "--atlas-md-border-color": "var(--border)",
    "--atlas-md-guide-color": "var(--border)",
    "--atlas-md-code-bg": "color-mix(in oklab, var(--muted-foreground) 12%, transparent)",
    "--atlas-md-embed-bg": "color-mix(in oklab, var(--muted-foreground) 12%, transparent)",
    "--atlas-md-link-color": "var(--primary)",
    "--atlas-md-wikilink-color": "var(--primary)",
    "--atlas-md-checkbox-color": "var(--primary)",
    "--atlas-md-focus-ring": "var(--ring)",
    "--atlas-md-menu-bg": "var(--popover)",
    "--atlas-md-menu-color": "var(--popover-foreground)",
    // Vim's drawn selection (see `vimMode`).
    "--atlas-selection": "color-mix(in oklab, var(--ring) 30%, transparent)",
    "--atlas-selection-unfocused": "color-mix(in oklab, var(--muted-foreground) 20%, transparent)",
    "--atlas-caret": "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
  "&.cm-editor .cm-content": { padding: "0 0 40vh", caretColor: "currentColor" },
  ".cm-line": { padding: "0" },
  // The change bar sticks to the bottom of the page's scroll area, over the note, as do Vim's
  // search prompt and messages when Vim is on.
  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
});

const selectVimModeEnabled = (settings: ClientSettings) => settings.vimModeEnabled;
const NOTE_EDITOR = { composer: false };

// Editable notes get the agent change bar to review live amendments; a skill map is read only.
// Under Vim, Space opens the keyboard menu and `:` the palette's ex line (see `appVimKeys`), and
// the text reads in the code font outside insert mode, which shows the mode instead of a panel.
const READ_ONLY_EXTENSIONS = [
  WIKI_EDITOR_THEME,
  vimNormalModeFont,
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  appVimKeys(() => null),
];

/**
 * A note in the Atlas editor. Mod-click on a wikilink opens that note. Escape stays with the
 * editor instead of leaving the page. Amendments that land live are marked in their author's
 * colour, and the change bar under the note steps through, accepts, or reverts them. With
 * the device's Vim setting on, the note edits with Vim, in the code font outside insert mode.
 */
export function WikiNoteEditor({
  session,
  readOnly = false,
  onOpenNote,
  onWrite,
}: {
  readonly session: WikiNoteSession;
  readonly readOnly?: boolean;
  readonly onOpenNote: (name: string) => void;
  /** Vim's `:w`: saves the note, as Save to change request does. */
  readonly onWrite?: () => void;
}) {
  // Read through a ref, so the preview options stay one object and never remount the editor.
  const openNoteRef = useRef(onOpenNote);
  useLayoutEffect(() => {
    openNoteRef.current = onOpenNote;
  }, [onOpenNote]);
  const writeRef = useRef(onWrite);
  useLayoutEffect(() => {
    writeRef.current = onWrite;
  }, [onWrite]);
  // One array for the editor's life: a new one would remount it.
  const [editableExtensions] = useState(() => [
    WIKI_EDITOR_THEME,
    vimNormalModeFont,
    agentChangeBar(),
    appVimKeys(() => ({ label: "Save to change request", run: () => writeRef.current?.() })),
  ]);
  const vim = useClientSettings(selectVimModeEnabled);
  useVimScreenLines();
  // The formatting keys follow the keybindings; a change remounts the editor on the same text.
  const keys = useMarkdownEditorKeys(NOTE_EDITOR);
  const livePreview: LivePreviewOptions = {
    openWikilink: (target) => {
      const name = wikilinkNoteName(target);
      if (name !== null) openNoteRef.current(name);
    },
    // Embeds name wiki files, which the page cannot serve as images yet.
    resolveEmbed: () => null,
    keys,
  };
  return (
    <div
      className="min-h-full text-base leading-relaxed text-foreground"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <AtlasEditor
        text={session.text}
        awareness={session.awareness}
        extensions={readOnly ? READ_ONLY_EXTENSIONS : editableExtensions}
        livePreview={livePreview}
        vim={vim}
        vimPanel={false}
      />
    </div>
  );
}

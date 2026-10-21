import "@mercurian/editor/markdown/theme.css";
import "@mercurian/editor/markdown/katex.css";

import { agentChangeBar } from "@mercurian/editor/collab/agent-changes";
import { AtlasEditor } from "@mercurian/editor/editor";
import type { LivePreviewOptions } from "@mercurian/editor/markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useMemo, useRef } from "react";

import type { WikiNoteSession } from "./wikiNoteBuffer";
import { wikilinkNoteName } from "./wiki.logic";

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
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
  "&.cm-editor .cm-content": { padding: "0 0 40vh", caretColor: "currentColor" },
  ".cm-line": { padding: "0" },
  // The change bar sticks to the bottom of the page's scroll area, over the note.
  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
});

// Editable notes get the agent change bar to review live amendments; a skill map is read only.
const EDITABLE_EXTENSIONS = [WIKI_EDITOR_THEME, agentChangeBar()];
const READ_ONLY_EXTENSIONS = [
  WIKI_EDITOR_THEME,
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
];

/**
 * A note in the Atlas editor. Mod-click on a wikilink opens that note. Escape stays with the
 * editor instead of leaving the page. Amendments that land live are marked in their author's
 * colour, and the change bar under the note steps through, accepts, or reverts them.
 */
export function WikiNoteEditor({
  session,
  readOnly = false,
  onOpenNote,
}: {
  readonly session: WikiNoteSession;
  readonly readOnly?: boolean;
  readonly onOpenNote: (name: string) => void;
}) {
  // Read through a ref, so the preview options stay one object and never remount the editor.
  const openNoteRef = useRef(onOpenNote);
  useLayoutEffect(() => {
    openNoteRef.current = onOpenNote;
  }, [onOpenNote]);
  const livePreview = useMemo<LivePreviewOptions>(
    () => ({
      openWikilink: (target) => {
        const name = wikilinkNoteName(target);
        if (name !== null) openNoteRef.current(name);
      },
      // Embeds name wiki files, which the page cannot serve as images yet.
      resolveEmbed: () => null,
    }),
    [],
  );
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
        extensions={readOnly ? READ_ONLY_EXTENSIONS : EDITABLE_EXTENSIONS}
        livePreview={livePreview}
      />
    </div>
  );
}

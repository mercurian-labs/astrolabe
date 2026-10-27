import "@mercurian/editor/markdown/theme.css";
import "@mercurian/editor/markdown/katex.css";

import { agentChangeBar } from "@mercurian/editor/collab/agent-changes";
import { AtlasEditor } from "@mercurian/editor/editor";
import type { LivePreviewOptions } from "@mercurian/editor/markdown";
import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useMemo, useRef } from "react";

import type { WikiNoteSession } from "./noteBuffer";
import { wikilinkNoteName } from "./incoming";

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

// Every note gets the agent change bar, to review amendments that land live. Module-level: a
// new array would remount the editor.
const EXTENSIONS = [WIKI_EDITOR_THEME, agentChangeBar()];

/**
 * A note in the Atlas editor. Mod-click on a wikilink opens it, as does a plain click (a tap) while
 * read-only. Switching `readOnly` keeps the editor and its scroll; Escape stays with the editor.
 * Live amendments show in their author's colour; the change bar steps through, accepts or reverts them.
 */
export function WikiNoteEditor({
  session,
  readOnly = false,
  onOpenNote,
  onOpenUrl,
}: {
  readonly session: WikiNoteSession;
  readonly readOnly?: boolean;
  readonly onOpenNote: (name: string) => void;
  /** Opens an external link; the editor opens a new window when omitted. */
  readonly onOpenUrl?: (href: string) => void;
}) {
  // Read through refs, so the preview options stay one object and never remount the editor.
  const openNoteRef = useRef(onOpenNote);
  const openUrlRef = useRef(onOpenUrl);
  useLayoutEffect(() => {
    openNoteRef.current = onOpenNote;
    openUrlRef.current = onOpenUrl;
  }, [onOpenNote, onOpenUrl]);
  const hasOpenUrl = onOpenUrl !== undefined;
  const livePreview = useMemo<LivePreviewOptions>(
    () => ({
      openWikilink: (target) => {
        const name = wikilinkNoteName(target);
        if (name !== null) openNoteRef.current(name);
      },
      ...(hasOpenUrl ? { openUrl: (href: string) => openUrlRef.current?.(href) } : {}),
      linksOpenOnClick: true,
      // Embeds name wiki files, which the page cannot serve as images yet.
      resolveEmbed: () => null,
    }),
    [hasOpenUrl],
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
        extensions={EXTENSIONS}
        livePreview={livePreview}
        readOnly={readOnly}
      />
    </div>
  );
}

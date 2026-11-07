import "@mercurian/editor/markdown/theme.css";
import "@mercurian/editor/markdown/katex.css";

import { agentChangeBar } from "@mercurian/editor/collab/agent-changes";
import { AtlasEditor } from "@mercurian/editor/editor";
import type { EmbedSource, LivePreviewOptions } from "@mercurian/editor/markdown";
import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { WikiNoteSession } from "./noteBuffer";
import { wikilinkNoteName } from "./incoming";
import {
  useWikiLinkTools,
  wikilinkDisplay,
  type WikiLinkPeek,
  type WikiLinkScope,
} from "./linkTools";

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
  renderBase,
  renderCanvasEmbed,
  renderMermaid,
  resolveEmbed,
  linkTypes,
  linkScope,
  renderLinkPreview,
}: {
  readonly session: WikiNoteSession;
  readonly readOnly?: boolean;
  readonly onOpenNote: (name: string) => void;
  /** The `@` types the wiki uses, which typing `@` inside a link suggests. */
  readonly linkTypes: ReadonlyArray<string>;
  readonly linkScope?: WikiLinkScope | null;
  /** What a link's preview shows, drawn into its popover. */
  readonly renderLinkPreview: (link: WikiLinkPeek) => ReactNode;
  /** Opens an external link; the editor opens a new window when omitted. */
  readonly onOpenUrl?: (href: string) => void;
  /**
   * A ```base block's view, from its YAML, or an embedded base's, from its embed
   * (`![[Open.base#Table]]`); it shows until the block is edited.
   */
  readonly renderBase?: (source: string) => ReactNode;
  /** An embedded canvas, `![[Board.canvas]]` alone on its line, by its target. */
  readonly renderCanvasEmbed?: (target: string) => ReactNode;
  /** A ```mermaid block's diagram, from its source; it shows until the block is edited. */
  readonly renderMermaid?: (source: string) => ReactNode;
  /** Where an embedded image is; without it, it shows broken. */
  readonly resolveEmbed?: (target: string) => EmbedSource;
}) {
  // Read through refs, so the preview options stay one object and never remount the editor.
  const openNoteRef = useRef(onOpenNote);
  const openUrlRef = useRef(onOpenUrl);
  const resolveEmbedRef = useRef(resolveEmbed);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest handlers for the editor's link and embed callbacks
  useLayoutEffect(() => {
    openNoteRef.current = onOpenNote;
    openUrlRef.current = onOpenUrl;
    resolveEmbedRef.current = resolveEmbed;
  }, [onOpenNote, onOpenUrl, resolveEmbed]);
  const hasOpenUrl = onOpenUrl !== undefined;
  // The blocks the editor draws, each filled through a portal, so the view keeps this tree.
  const [hostBlocks, setHostBlocks] = useState<
    ReadonlyArray<{
      readonly id: number;
      readonly kind: "base" | "canvas-embed" | "mermaid";
      readonly source: string;
      readonly element: HTMLElement;
    }>
  >([]);
  const [{ codeBlocks, embedBlocks }] = useState(() => {
    let next = 0;
    const draw =
      (kind: "base" | "canvas-embed" | "mermaid") => (source: string, element: HTMLElement) => {
        const id = next++;
        setHostBlocks((blocks) => [...blocks, { id, kind, source, element }]);
        return () => setHostBlocks((blocks) => blocks.filter((block) => block.id !== id));
      };
    const base = draw("base");
    return {
      codeBlocks: { base, mermaid: draw("mermaid") },
      embedBlocks: {
        // An embedded base is asked for by its embed, `![[Open.base#Table]]` (see `embeddedBase`).
        base: (target: string, element: HTMLElement) => base(`![[${target}]]`, element),
        canvas: draw("canvas-embed"),
      },
    };
  });
  const renderers = { base: renderBase, "canvas-embed": renderCanvasEmbed, mermaid: renderMermaid };
  const linkTools = useWikiLinkTools(linkTypes, renderLinkPreview, [], linkScope ?? null);
  // One array for the editor's life: a new one would remount it.
  const [extensions] = useState(() => [...EXTENSIONS, linkTools.extension]);
  const drawsBases = renderBase !== undefined;
  const livePreview = useMemo<LivePreviewOptions>(
    () => ({
      openWikilink: (target) => {
        const name = wikilinkNoteName(target);
        if (name !== null) openNoteRef.current(name);
      },
      ...(hasOpenUrl ? { openUrl: (href: string) => openUrlRef.current?.(href) } : {}),
      linksOpenOnClick: true,
      wikilinkDisplay,
      resolveEmbed: (target) => resolveEmbedRef.current?.(target) ?? null,
      ...(drawsBases ? { codeBlocks, embedBlocks } : {}),
    }),
    [hasOpenUrl, drawsBases, codeBlocks, embedBlocks],
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
        extensions={extensions}
        livePreview={livePreview}
        readOnly={readOnly}
      />
      {hostBlocks.map((block) =>
        createPortal(
          renderers[block.kind]?.(block.source) ?? null,
          block.element,
          String(block.id),
        ),
      )}
      {linkTools.previews}
    </div>
  );
}

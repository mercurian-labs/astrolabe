import "@mercurian/editor/markdown/theme.css";
import "@mercurian/editor/markdown/katex.css";

import { agentChangeBar } from "@mercurian/editor/collab/agent-changes";
import { AtlasEditor } from "@mercurian/editor/editor";
import { vimNormalModeFont } from "@mercurian/editor/vim";
import type { LivePreviewOptions } from "@mercurian/editor/markdown";
import { outline } from "@mercurian/editor/outline";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ClientSettings } from "@t3tools/contracts";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useEditorFindKeys, useMarkdownEditorKeys } from "~/editorKeybindings";
import { useVimScreenLines } from "~/vimScreenLines";
import { useClientSettings } from "~/hooks/useSettings";
import { appVimKeys } from "~/whichKey/doors";

import type { WikiNoteSession } from "@mercurian/wiki-editor/note-buffer";
import { wikilinkNoteName } from "@mercurian/wiki-editor/incoming";
import {
  useWikiLinkTools,
  wikilinkDisplay,
  type WikiLinkPeek,
} from "@mercurian/wiki-editor/link-tools";

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
  // search prompt and messages when Vim is on; the find bar sticks to its top.
  ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
});

const selectVimModeEnabled = (settings: ClientSettings) => settings.vimModeEnabled;

const previewOptions = (
  keys: LivePreviewOptions["keys"],
  openNote: (name: string) => void,
  codeBlocks: NonNullable<LivePreviewOptions["codeBlocks"]>,
  embedBlocks: NonNullable<LivePreviewOptions["embedBlocks"]>,
): LivePreviewOptions => ({
  openWikilink: (target) => {
    const name = wikilinkNoteName(target);
    if (name !== null) openNote(name);
  },
  // Embeds name wiki files, which the page cannot serve as images yet.
  resolveEmbed: () => null,
  wikilinkDisplay,
  ...(keys === undefined ? {} : { keys }),
  codeBlocks,
  embedBlocks,
});
const NOTE_EDITOR = { composer: false };

// Editable notes get the agent change bar to review live amendments; a skill map is read only.
// Under Vim, Space opens the keyboard menu and `:` the palette's ex line (see `appVimKeys`), and
// the text reads in the code font outside insert mode, which shows the mode instead of a panel.
// Either way, mod+shift+o opens the note's headings (`outline`).
const READ_ONLY_EXTENSIONS = [
  WIKI_EDITOR_THEME,
  vimNormalModeFont,
  outline(),
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  appVimKeys(() => null),
];

interface HostBlock {
  readonly id: number;
  /** A code block's source, or an embed's target (`Open.base#Table`). */
  readonly source: string;
  readonly kind: "base" | "base-embed" | "canvas-embed" | "mermaid";
  readonly element: HTMLElement;
}

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
  renderBase,
  renderBaseEmbed,
  renderCanvasEmbed,
  renderMermaid,
  linkTypes,
  linkNames,
  renderLinkPreview,
}: {
  readonly session: WikiNoteSession;
  readonly readOnly?: boolean;
  readonly onOpenNote: (name: string) => void;
  /** A ```base block's view, from its YAML; it shows until the block is edited. */
  readonly renderBase: (source: string) => ReactNode;
  /** An embedded base's view, `![[Open.base#Table]]` alone on its line, by its target. */
  readonly renderBaseEmbed?: (target: string) => ReactNode;
  /** An embedded canvas, `![[Board.canvas]]` alone on its line, by its target. */
  readonly renderCanvasEmbed?: (target: string) => ReactNode;
  /** A ```mermaid block's diagram, from its source; it shows until the block is edited. */
  readonly renderMermaid?: (source: string) => ReactNode;
  /** Vim's `:w`: saves the note now, rather than after the usual pause. */
  readonly onWrite?: () => void;
  /** The `@` types the wiki uses, which typing `@` inside a link suggests. */
  readonly linkTypes: ReadonlyArray<string>;
  /** The documents a `[[` can complete to. */
  readonly linkNames?: ReadonlyArray<string>;
  /** What a link's preview shows, drawn into its popover. */
  readonly renderLinkPreview: (link: WikiLinkPeek) => ReactNode;
}) {
  // Read through a ref, so the preview options never change with it.
  const openNoteRef = useRef(onOpenNote);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest note-open handler for the editor's preview options
  useLayoutEffect(() => {
    openNoteRef.current = onOpenNote;
  }, [onOpenNote]);
  const writeRef = useRef(onWrite);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest write handler for the editor's Vim save key
  useLayoutEffect(() => {
    writeRef.current = onWrite;
  }, [onWrite]);
  const linkTools = useWikiLinkTools(linkTypes, renderLinkPreview, linkNames);
  // One array for the editor's life: a new one would remount it.
  const [editableExtensions] = useState(() => [
    WIKI_EDITOR_THEME,
    vimNormalModeFont,
    outline(),
    agentChangeBar(),
    appVimKeys(() => ({ label: "Save now", run: () => writeRef.current?.() })),
    linkTools.extension,
  ]);
  const [readOnlyExtensions] = useState(() => [...READ_ONLY_EXTENSIONS, linkTools.extension]);
  // The blocks the editor draws, each filled through a portal so the view keeps the app's context.
  const [hostBlocks, setHostBlocks] = useState<ReadonlyArray<HostBlock>>([]);
  const [stable] = useState(() => {
    const ids = { next: 0 };
    const draw = (kind: HostBlock["kind"]) => (source: string, element: HTMLElement) => {
      const id = ids.next++;
      setHostBlocks((blocks) => [...blocks, { id, source, kind, element }]);
      return () => setHostBlocks((blocks) => blocks.filter((block) => block.id !== id));
    };
    return {
      openNote: (name: string) => openNoteRef.current(name),
      codeBlocks: { base: draw("base"), mermaid: draw("mermaid") },
      embedBlocks: { base: draw("base-embed"), canvas: draw("canvas-embed") },
    };
  });
  const renderers = {
    base: renderBase,
    "base-embed": renderBaseEmbed,
    "canvas-embed": renderCanvasEmbed,
    mermaid: renderMermaid,
  };
  const vim = useClientSettings(selectVimModeEnabled);
  useVimScreenLines();
  // The formatting keys follow the keybindings; a change remounts the editor on the same text.
  // One options object per set of keys, since a drawn base block re-renders this component.
  const keys = useMarkdownEditorKeys(NOTE_EDITOR);
  const findKeys = useEditorFindKeys();
  const [preview, setPreview] = useState(() => ({
    keys,
    options: previewOptions(keys, stable.openNote, stable.codeBlocks, stable.embedBlocks),
  }));
  let livePreview = preview.options;
  if (preview.keys !== keys) {
    livePreview = previewOptions(keys, stable.openNote, stable.codeBlocks, stable.embedBlocks);
    setPreview({ keys, options: livePreview });
  }
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
        extensions={readOnly ? readOnlyExtensions : editableExtensions}
        livePreview={livePreview}
        vim={vim}
        vimPanel={false}
        findKeys={findKeys}
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

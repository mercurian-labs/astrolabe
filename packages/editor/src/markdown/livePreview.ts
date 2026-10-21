import { commonmarkLanguage, markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Prec, type Extension } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { previewConfig, type LivePreviewOptions } from "./config.ts";
import { markdownBindings, pasteLinkHandler } from "./keymap.ts";
import {
  previewDecorations,
  previewFolds,
  previewInteractions,
  snapPastHiddenMarkers,
} from "./preview.ts";
import { revealActive } from "./reveal.ts";
import { markdownSyntax } from "./syntax.ts";
import { tableCellEditing } from "./tableCells.ts";
import { tableCellMenu } from "./tableCommands.ts";
import { manuallyUnfolded } from "./unfolded.ts";
import { previewBaseTheme } from "./theme.ts";
import { revealAtomicNodes } from "../collab/reveal.ts";

export type { LivePreviewOptions, PreviewRange } from "./config.ts";
export { previewExclusions } from "./config.ts";
export { continueMarkup } from "./keymap.ts";
export {
  alignColumnCenter,
  alignColumnLeft,
  alignColumnRight,
  clearCells,
  deleteCells,
  deleteColumn,
  deleteRow,
  duplicateColumn,
  duplicateRow,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
  insertTable,
  moveColumnLeft,
  moveColumnRight,
  moveColumnTo,
  moveRowDown,
  moveRowTo,
  moveRowUp,
  sortRowsAscending,
  sortRowsDescending,
} from "./tableCommands.ts";

/**
 * The Markdown live preview: the parser with Obsidian syntax, decorations that hide
 * syntax away from the selection, the keymap, and the base theme. It installs no history;
 * undo belongs to the host. Pair it with `theme.css` for colours.
 */
export function livePreview(options: LivePreviewOptions = {}): Extension {
  return [
    markdown({
      base: commonmarkLanguage,
      extensions: markdownSyntax,
      codeLanguages: languages,
      addKeymap: false,
      completeHTMLTags: false,
      pasteURLAsLink: false,
    }),
    // Token classes for code blocks and HTML; theme.css colours them only there.
    syntaxHighlighting(classHighlighter),
    previewConfig.of(options),
    revealActive,
    manuallyUnfolded,
    previewDecorations,
    previewFolds,
    snapPastHiddenMarkers,
    previewInteractions,
    pasteLinkHandler,
    Prec.high(keymap.of(bindingsFor(options))),
    previewBaseTheme,
    tableCellEditing(cellPreview(options)),
    tableCellMenu,
    // Inline constructs the theme pads (code, inline HTML, tags, footnote badges) and
    // rendered formulas: an agent change's reveal shows each one whole, never split.
    revealAtomicNodes.of([
      "InlineCode",
      "HTMLTag",
      "Comment",
      "ProcessingInstruction",
      "Tag",
      "FootnoteReference",
      "InlineMath",
    ]),
  ];
}

// A table cell holds inline Markdown only, so its editor parses no block constructs.
const BLOCK_PARSERS = [
  "LinkReference",
  "IndentedCode",
  "FencedCode",
  "Blockquote",
  "HorizontalRule",
  "BulletList",
  "OrderedList",
  "ATXHeading",
  "HTMLBlock",
  "SetextHeading",
  "Table",
  "TaskList",
  "FootnoteDefinition",
  "MathBlock",
  "CalloutHeader",
  "Frontmatter",
  "ObsidianTask",
];

/**
 * The live preview inside a table cell's editor: the same parser without block syntax,
 * the inline decorations, formatting keys, link opening, and the base theme. No folds,
 * no block widgets.
 */
function cellPreview(options: LivePreviewOptions): Extension {
  return [
    markdown({
      base: commonmarkLanguage,
      extensions: [...markdownSyntax, { remove: BLOCK_PARSERS }],
      addKeymap: false,
      completeHTMLTags: false,
      pasteURLAsLink: false,
    }),
    previewConfig.of(options),
    revealActive,
    manuallyUnfolded,
    previewDecorations,
    previewInteractions,
    pasteLinkHandler,
    Prec.high(keymap.of(bindingsFor(options))),
    previewBaseTheme,
  ];
}

/** The preview's key bindings without the ones the host reserved. */
function bindingsFor(options: LivePreviewOptions): readonly KeyBinding[] {
  const reserved = options.reservedKeys;
  if (!reserved?.length) return markdownBindings;
  return markdownBindings.filter((binding) => !binding.key || !reserved.includes(binding.key));
}

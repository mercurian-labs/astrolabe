import { LanguageDescription, foldGutter, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { EditorView, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

/**
 * The editor for a repository's files that are not notes: the language its name says, coloured
 * as the notes' code blocks are (`code/theme.css`, over the Markdown theme's token colours), with
 * line numbers, fold markers and indent guides. Markdown files open with the live preview instead
 * (`isMarkdownPath`). Editing itself is `codeEditing` (`editing.ts`), for both.
 */

const MARKDOWN = /\.(md|markdown|mdx)$/i;

/** Whether a file opens as a note, with the Markdown live preview. */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN.test(path);
}

/** The language a file's name says, if one is known; loading it can take a moment. */
export function codeLanguageFor(path: string): LanguageDescription | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return LanguageDescription.matchFilename(languages, name);
}

// The guides read the gutter's colour, so they follow the app's theme in light and dark alike.
const guides = indentationMarkers({
  colors: {
    light: "var(--atlas-md-border-color)",
    dark: "var(--atlas-md-border-color)",
    activeLight: "var(--atlas-md-syntax-color)",
    activeDark: "var(--atlas-md-syntax-color)",
  },
});

/** A code file's view: line numbers, fold markers, indent guides and the notes' code colours. */
export function codeView(): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    guides,
    syntaxHighlighting(classHighlighter),
    EditorView.editorAttributes.of({ class: "cm-code" }),
  ];
}

import { LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { EditorView, highlightActiveLineGutter, lineNumbers } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";

/**
 * The editor for a repository's files that are not notes: the language its name says, coloured
 * as the notes' code blocks are (`code/theme.css`, over the Markdown theme's token colours), with
 * line numbers. Markdown files open with the live preview instead (`isMarkdownPath`).
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

/** A code file's view: line numbers and the notes' code colours. */
export function codeView(): Extension {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    syntaxHighlighting(classHighlighter),
    EditorView.editorAttributes.of({ class: "cm-code" }),
  ];
}

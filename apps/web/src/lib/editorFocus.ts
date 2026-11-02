import { EXCERPT_ATTRIBUTE } from "@mercurian/editor/multibuffer/excerpt";
import { OUTLINE_ATTRIBUTE } from "@mercurian/editor/outline";

/**
 * Astrolabe: whether focus is in one of the app's text editors (the composer, a wiki note, a
 * repository file): an editable CodeMirror view. The `editorFocus` keybinding condition, which the
 * Markdown editors' formatting keys use and other shortcuts on the same keys can exclude
 * (`!editorFocus`).
 */
export function isEditorFocused(target: EventTarget | null = document.activeElement): boolean {
  const element = target instanceof Element ? target : null;
  const content = element
    ?.closest(".cm-editor")
    ?.querySelector(":scope > .cm-scroller > .cm-content");
  return content?.getAttribute("contenteditable") === "true";
}

/**
 * Astrolabe: whether focus is in the text of an editable code editor (a repository file, marked
 * `data-code-editing` by `codeEditing`), not its find bar. The `codeEditorFocus` condition: the
 * editor's own keys there, and the app's commands on the same keys stand down.
 */
export function isCodeEditorFocused(target: EventTarget | null = document.activeElement): boolean {
  const element = target instanceof Element ? target : null;
  const content = element?.closest(".cm-content");
  return (
    content?.getAttribute("contenteditable") === "true" &&
    content.closest(".cm-editor")?.hasAttribute("data-code-editing") === true
  );
}

/**
 * Astrolabe: whether focus is in an editor with an outline (a repository file or wiki note,
 * marked by `outline()`), or in one inside it such as a table cell's: the `outlineFocus`
 * condition, where mod+shift+o opens the outline picker rather than a new thread.
 */
export function isOutlineEditorFocused(
  target: EventTarget | null = document.activeElement,
): boolean {
  const element = target instanceof Element ? target : null;
  return element?.closest(`.cm-editor[${OUTLINE_ATTRIBUTE}]`) != null;
}

/**
 * Astrolabe: whether focus is in an excerpt of a multi-file view (search results, problems): the
 * `multibufferFocus` condition, where the excerpts' own keys apply.
 */
export function isMultibufferFocused(target: EventTarget | null = document.activeElement): boolean {
  const element = target instanceof Element ? target : null;
  return element?.closest(`.cm-editor[${EXCERPT_ATTRIBUTE}]`) != null;
}

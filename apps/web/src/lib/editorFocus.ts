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

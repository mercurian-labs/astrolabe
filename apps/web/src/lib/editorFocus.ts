/**
 * Astrolabe: whether focus is in one of the app's text editors (the composer, a wiki note): an
 * editable CodeMirror view. The `editorFocus` keybinding condition, which the Markdown editors'
 * formatting keys use and other shortcuts on the same keys can exclude (`!editorFocus`).
 */
export function isEditorFocused(target: EventTarget | null = document.activeElement): boolean {
  const element = target instanceof Element ? target : null;
  const content = element
    ?.closest(".cm-editor")
    ?.querySelector(":scope > .cm-scroller > .cm-content");
  return content?.getAttribute("contenteditable") === "true";
}

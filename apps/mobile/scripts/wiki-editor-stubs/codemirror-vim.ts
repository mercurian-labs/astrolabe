// The mobile wiki editor page never turns on Vim mode; the editor reaches the package only
// once a host does, so the page ships without it.
export const CodeMirror = { commands: {} };
export const Vim = {};
export const getCM = () => null;
export const vim = () => [];

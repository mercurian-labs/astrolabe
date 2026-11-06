import { register } from "pele/core";

import { createDiagramLoader } from "./diagramChunks";
import { WIKI_EDITOR_DIAGRAM } from "./protocol";

export { detectType, mount } from "pele/core";

declare global {
  interface Window {
    [WIKI_EDITOR_DIAGRAM]?: ReturnType<typeof createDiagramLoader>["receive"];
  }
}

const loader = createDiagramLoader(
  (diagram) =>
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "loadDiagram", diagram })),
  register as (definition: never) => void,
);
window[WIKI_EDITOR_DIAGRAM] = loader.receive;

/**
 * `pele/lazy` on the phone's page, by alias (`generate-wiki-editor.mts`): the same surface, with
 * each diagram type loaded through the app instead of over the network.
 */
export const load = loader.load;

import { WIKI_EDITOR_DIAGRAM } from "@mercurian/wiki-editor/protocol";
import { chunks, diagrams } from "@t3tools/mobile-wiki-editor/diagrams";

/** The script that gives the page a diagram type's code, or tells it there is none. */
export function diagramScript(diagram: string): string {
  const name = JSON.stringify(diagram);
  const files = Object.prototype.hasOwnProperty.call(diagrams, diagram)
    ? diagrams[diagram]
    : undefined;
  const receive = `window.${WIKI_EDITOR_DIAGRAM}&&window.${WIKI_EDITOR_DIAGRAM}`;
  if (files === undefined) return `${receive}(${name},null,null);true;`;
  const parts = files.map((file) => `${JSON.stringify(file)}:${chunks[file]}`);
  return `${receive}(${name},${JSON.stringify(`${diagram}.js`)},{${parts.join(",")}});true;`;
}

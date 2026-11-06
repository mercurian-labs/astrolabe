/**
 * A board drawn in a thread, saved as a file. Its coordinates are the ones the thread shows, fixed
 * for good, and its ids are minted; a code card becomes a link that works away from the product.
 */
import {
  serializeCanvas,
  type CanvasCodeReference,
  type CanvasData,
  type CanvasNode,
} from "./canvas.ts";
import { canvasIdMinter } from "./canvasEdits.ts";

/** Code a saved card can link to: the file exists at `commit`, which the remote has. */
export interface CanvasCodePin {
  readonly url: string;
  readonly commit: string;
  readonly repository: string;
  readonly lines?: readonly [number, number] | undefined;
}

/** Why a code card can't link: it says this instead. */
export interface CanvasCodeUnpinned {
  readonly commit: string | null;
}

const codeText = (
  path: string,
  lines: readonly [number, number] | undefined,
  commit: string | null,
) => {
  const at =
    lines === undefined ? "" : lines[0] === lines[1] ? `:${lines[0]}` : `:${lines[0]}-${lines[1]}`;
  return `\`${path}${at}\`${commit === null ? "" : ` at \`${commit.slice(0, 12)}\``}`;
};

/** The document a kept board writes. `pin` answers for each code card's path and lines. */
export function keptCanvasSource(
  data: CanvasData,
  pin: (code: CanvasCodeReference) => CanvasCodePin | CanvasCodeUnpinned,
  seed: string,
): string {
  const mint = canvasIdMinter(seed, []);
  const ids = new Map(data.nodes.map((node) => [node.id, mint()]));
  const place = ({ id, x, y, width, height }: CanvasNode) => ({
    id: ids.get(id) ?? id,
    x,
    y,
    width,
    height,
  });
  const color = (value: string | undefined) => (value === undefined ? {} : { color: value });
  const nodes = data.nodes.map((node) => {
    switch (node.type) {
      case "text":
        return { ...place(node), type: "text", text: node.text, ...color(node.color) };
      case "file":
        return { ...place(node), type: "file", file: node.file, ...color(node.color) };
      case "group":
        return {
          ...place(node),
          type: "group",
          ...(node.label === undefined ? {} : { label: node.label }),
          ...color(node.color),
        };
      case "link": {
        const { code, caption } = node.astrolabe ?? {};
        const captioned = caption === undefined ? {} : { caption };
        if (code === undefined) {
          return {
            ...place(node),
            type: "link",
            url: node.url,
            ...(caption === undefined ? {} : { astrolabe: captioned }),
            ...color(node.color),
          };
        }
        const pinned = pin(code);
        if (!("url" in pinned)) {
          const said = codeText(code.path, code.lines, pinned.commit);
          return {
            ...place(node),
            type: "text",
            text: caption === undefined ? said : `${caption}\n\n${said}`,
            ...color(node.color),
          };
        }
        return {
          ...place(node),
          type: "link",
          url: pinned.url,
          ...color(node.color),
          astrolabe: {
            repository: pinned.repository,
            commit: pinned.commit,
            path: code.path,
            ...(pinned.lines === undefined ? {} : { lines: pinned.lines }),
            ...captioned,
          },
        };
      }
    }
  });
  const edges = data.edges.map(({ id: _id, fromNode, toNode, ...rest }) => {
    const { fromSide, toSide, ...look } = rest;
    return {
      id: mint(),
      fromNode: ids.get(fromNode) ?? fromNode,
      ...(fromSide === undefined ? {} : { fromSide }),
      toNode: ids.get(toNode) ?? toNode,
      ...(toSide === undefined ? {} : { toSide }),
      ...look,
    };
  });
  return serializeCanvas({ nodes, edges });
}

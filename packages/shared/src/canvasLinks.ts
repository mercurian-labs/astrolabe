import type { Root, RootContent, Text } from "mdast";

/**
 * Astrolabe: `[[Name.canvas#Group]]` and `![[Name.canvas#Group]]` in chat Markdown, as in a wiki
 * note. The parse turns each into a link with this scheme, so the shared parse cache never depends
 * on which canvases a thread holds; the renderer resolves the name against them.
 */
export const CANVAS_LINK_PROTOCOL = "t3-canvas";

export interface CanvasLinkTarget {
  /** The canvas's name as written, with or without `.canvas`. */
  readonly name: string;
  /** The named group after `#`, a frame of the board. */
  readonly frame: string | undefined;
  /** `![[…]]`: a picture of it in place. Otherwise a link that opens it. */
  readonly embed: boolean;
  /** What a link shows: its `|alias`, else the name and frame. */
  readonly text: string;
}

const KIND = { embed: "embed", link: "link" } as const;

export const canvasLinkHref = (target: Omit<CanvasLinkTarget, "text">): string =>
  `${CANVAS_LINK_PROTOCOL}:${target.embed ? KIND.embed : KIND.link}/${encodeURIComponent(target.name)}${
    target.frame === undefined ? "" : `#${encodeURIComponent(target.frame)}`
  }`;

const decoded = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export function parseCanvasLinkHref(href: string): Omit<CanvasLinkTarget, "text"> | null {
  const match = /^t3-canvas:(embed|link)\/([^#]+)(?:#(.*))?$/.exec(href);
  if (match === null) return null;
  const name = decoded(match[2] ?? "");
  const frame = match[3] === undefined ? undefined : decoded(match[3]);
  if (name === null || name.trim() === "" || frame === null) return null;
  return {
    name,
    frame: frame === undefined || frame.trim() === "" ? undefined : frame.trim(),
    embed: match[1] === KIND.embed,
  };
}

// `[[target#frame|alias]]`, an embed with `!`. A target holds no brackets, bar, hash or newline.
const WIKI_LINK = /(!?)\[\[([^[\]\n|#]+)(?:#([^[\]\n|]*))?(?:\|([^[\]\n]*))?\]\]/g;

/** The `[[…]]` and `![[…]]` in a run of text, in order. */
export function canvasLinksIn(
  text: string,
): ReadonlyArray<CanvasLinkTarget & { readonly index: number; readonly length: number }> {
  return [...text.matchAll(WIKI_LINK)].flatMap((match) => {
    const name = (match[2] ?? "").trim();
    if (name === "") return [];
    const frame = match[3]?.trim() || undefined;
    const alias = match[4]?.trim();
    return [
      {
        name,
        frame,
        embed: match[1] === "!",
        text: alias || (frame === undefined ? name : `${name} › ${frame}`),
        index: match.index ?? 0,
        length: match[0].length,
      },
    ];
  });
}

type Parent = { children: RootContent[] };

const isParent = (node: unknown): node is Parent =>
  typeof node === "object" && node !== null && Array.isArray((node as Parent).children);

/** Turns `[[…]]` and `![[…]]` in prose into `t3-canvas:` links, leaving code and links alone. */
export function remarkCanvasLinks() {
  return (tree: Root) => {
    const visit = (parent: Parent) => {
      const next: RootContent[] = [];
      let changed = false;
      for (const child of parent.children) {
        if (child.type === "text") {
          const pieces = splitText(child);
          if (pieces !== null) {
            next.push(...pieces);
            changed = true;
            continue;
          }
        } else if (child.type !== "link" && child.type !== "linkReference" && isParent(child)) {
          visit(child);
        }
        next.push(child);
      }
      if (changed) parent.children = next;
    };
    visit(tree);
  };
}

function splitText(node: Text): RootContent[] | null {
  const found = canvasLinksIn(node.value);
  if (found.length === 0) return null;
  const pieces: RootContent[] = [];
  let at = 0;
  for (const link of found) {
    if (link.index > at) pieces.push({ type: "text", value: node.value.slice(at, link.index) });
    pieces.push({
      type: "link",
      url: canvasLinkHref(link),
      children: [{ type: "text", value: link.text }],
      // What a copy of the message keeps: the link as it was written.
      data: {
        hProperties: { dataMarkdownCopy: node.value.slice(link.index, link.index + link.length) },
      },
    });
    at = link.index + link.length;
  }
  if (at < node.value.length) pieces.push({ type: "text", value: node.value.slice(at) });
  return pieces;
}

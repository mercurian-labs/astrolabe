/**
 * What the wiki's index reads out of a canvas: its links, an outline for agents and search, and a
 * rename. Server side only, so `canvas.ts` stays light enough for the phone's engine.
 */
import {
  insideGroup,
  parseCanvas,
  serializeCanvas,
  type CanvasData,
  type CanvasGroupNode,
  type CanvasNode,
} from "./canvas.ts";
import { key, links, noteName, renameLinks } from "./links.ts";

export interface CanvasLink {
  /** A link's target, as a note's would read: a file card's path without its `.md`. */
  readonly target: string;
  /** Only a text card's link can be a red link: a file card that points nowhere says so itself. */
  readonly card: "text" | "file";
}

/** Where a canvas's text cards and file cards point. Arrows join cards, so they never count. */
export function canvasLinks(data: CanvasData): ReadonlyArray<CanvasLink> {
  return data.nodes.flatMap((node): ReadonlyArray<CanvasLink> => {
    if (node.type === "text") {
      return links(node.text).map((link) => ({ target: link.target, card: "text" as const }));
    }
    return node.type === "file" && node.file !== ""
      ? [{ target: noteName(node.file), card: "file" as const }]
      : [];
  });
}

export interface CanvasRename {
  /** The file's whole path, as file cards and group backgrounds hold it. */
  readonly fromFile: string;
  readonly toFile: string;
  /** Its name, as `[[links]]` hold it. */
  readonly fromName: string;
  readonly toName: string;
}

/**
 * A canvas with a renamed file's references rewritten and everything else kept. A file with none
 * comes back as it is, in whatever bytes it had; JSON that doesn't read is never rewritten.
 */
export function renameInCanvas(source: string, rename: CanvasRename): string {
  const parsed = parseCanvas(source);
  if (!parsed.ok) return source;
  const { document } = parsed;
  if (typeof document !== "object" || document === null || Array.isArray(document)) return source;
  const { nodes } = document as { readonly nodes?: unknown };
  if (!Array.isArray(nodes)) return source;
  const renamed = (path: unknown) => typeof path === "string" && key(path) === key(rename.fromFile);
  let changed = false;
  const next = nodes.map((raw: unknown) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const node = raw as Record<string, unknown>;
    let replaced: Record<string, unknown> | undefined;
    if (node.type === "file" && renamed(node.file)) replaced = { ...node, file: rename.toFile };
    if (node.type === "group" && renamed(node.background)) {
      replaced = { ...node, background: rename.toFile };
    }
    if (node.type === "text" && typeof node.text === "string") {
      const text = renameLinks(node.text, rename.fromName, rename.toName);
      if (text !== node.text) replaced = { ...node, text };
    }
    if (replaced === undefined) return raw;
    changed = true;
    return replaced;
  });
  return changed ? serializeCanvas({ ...document, nodes: next }) : source;
}

const area = (node: CanvasNode) => node.width * node.height;
const readingOrder = (a: CanvasNode, b: CanvasNode) => a.y - b.y || a.x - b.x;

/** A card as an outline line: what it says or points at, never where it sits. */
function cardLines(node: CanvasNode): string[] {
  const tag = `[${node.id}]`;
  switch (node.type) {
    case "text": {
      const [first = "", ...rest] = node.text.split("\n");
      return [`${tag} ${first}`, ...rest.map((line) => `  ${line}`)];
    }
    case "file":
      return [`${tag} File: ${node.file}${node.subpath ?? ""}`];
    case "link": {
      const { code, caption } = node.astrolabe ?? {};
      const lines = code?.lines ? `:${code.lines[0]}-${code.lines[1]}` : "";
      const at = code?.commit === undefined ? "" : ` at ${code.commit.slice(0, 12)}`;
      const named = code === undefined ? `Link: ${node.url}` : `Code: ${code.path}${lines}${at}`;
      return [`${tag} ${named}`, ...(caption === undefined ? [] : [`  ${caption}`])];
    }
    case "group":
      return [];
  }
}

const groupTitle = (group: CanvasGroupNode) => group.label ?? "Unlabelled group";

/**
 * A canvas as an agent reads it: cards under the smallest group holding them, in reading order,
 * then the arrows between them. No coordinates: a position is no use to something that can't see.
 */
export function canvasOutline(file: string, data: CanvasData): string {
  const groups = data.nodes.filter((node): node is CanvasGroupNode => node.type === "group");
  const cards = data.nodes.filter((node) => node.type !== "group");
  const smallestFirst = groups.slice().sort((a, b) => area(a) - area(b));
  const inGroup = new Map<string, CanvasNode[]>();
  const loose: CanvasNode[] = [];
  for (const card of cards) {
    const holder = smallestFirst.find((group) => insideGroup(group, card));
    if (holder === undefined) loose.push(card);
    else inGroup.set(holder.id, [...(inGroup.get(holder.id) ?? []), card]);
  }
  const lines = [
    `${file}: ${cards.length} ${cards.length === 1 ? "card" : "cards"}, ${groups.length} ${groups.length === 1 ? "group" : "groups"}, ${data.edges.length} ${data.edges.length === 1 ? "arrow" : "arrows"}.`,
  ];
  for (const card of loose.slice().sort(readingOrder)) lines.push(...cardLines(card));
  for (const group of groups.slice().sort(readingOrder)) {
    lines.push("", `Group [${group.id}] ${groupTitle(group)}`);
    for (const card of (inGroup.get(group.id) ?? []).sort(readingOrder)) {
      lines.push(...cardLines(card));
    }
  }
  if (data.edges.length > 0) lines.push("", "Arrows");
  for (const edge of data.edges) {
    const both = edge.fromEnd === "arrow" && edge.toEnd !== "none";
    const none = edge.fromEnd !== "arrow" && edge.toEnd === "none";
    const label = edge.label === undefined ? "" : `: ${edge.label}`;
    lines.push(`[${edge.fromNode}] ${both ? "<->" : none ? "--" : "->"} [${edge.toNode}]${label}`);
  }
  return lines.join("\n");
}

/** A file's outline; JSON that doesn't read says so, and shows what is there to fix. */
export function canvasSourceOutline(file: string, source: string): string {
  const parsed = parseCanvas(source);
  return parsed.ok
    ? canvasOutline(file, parsed.data)
    : `${file} is not valid JSON (${parsed.error}). Its text:\n\n${source}`;
}

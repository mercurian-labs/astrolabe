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
import { links, noteName, renameLinks } from "./links.ts";

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
  /** Where a file card's or group background's path went; null for one that stayed. */
  readonly path: (file: string) => string | null;
  /** What a text card's link becomes; null for a link to leave. */
  readonly link: (target: string, embed: boolean) => string | null;
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
  const moved = (path: unknown) => (typeof path === "string" ? rename.path(path) : null);
  let changed = false;
  const next = nodes.map((raw: unknown) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const node = raw as Record<string, unknown>;
    let replaced: Record<string, unknown> | undefined;
    const file = node.type === "file" ? moved(node.file) : null;
    if (file !== null) replaced = { ...node, file };
    const background = node.type === "group" ? moved(node.background) : null;
    if (background !== null) replaced = { ...node, background };
    if (node.type === "text" && typeof node.text === "string") {
      const text = renameLinks(node.text, rename.link);
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
      const shape = node.astrolabe?.shape === undefined ? "" : ` (${node.astrolabe.shape})`;
      return [`${tag}${shape} ${first}`, ...rest.map((line) => `  ${line}`)];
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
 * then the arrows between them, then its stories. No coordinates: a position is no use to something
 * that can't see.
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
  const drawings = data.drawings?.length ?? 0;
  if (drawings > 0) {
    lines.push(`${drawings} hand ${drawings === 1 ? "drawing" : "drawings"}, not listed.`);
  }
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
  for (const story of data.stories ?? []) {
    lines.push("", `Story: ${story.title}`);
    story.steps.forEach((step, index) => {
      const shows =
        step.group === undefined
          ? step.cards.map((card) => `[${card}]`).join(" ")
          : `[${step.group}]`;
      const label = step.label === undefined ? "" : `${step.label}. `;
      lines.push(`${index + 1}. ${shows} ${label}${step.note}`);
    });
  }
  return lines.join("\n");
}

export interface CanvasMatch {
  /** The card's, group's or arrow's id: what an edit names it by, for a card or group. */
  readonly id: string;
  readonly text: string;
}

/** The line of `text` holding `needle`, lowercase, or nothing when none does. */
const matchingLine = (text: string, needle: string) =>
  text.split("\n").find((line) => line.toLowerCase().includes(needle));

/** What a card says, in the order a reader would meet it. */
function cardTexts(node: CanvasNode): ReadonlyArray<string> {
  switch (node.type) {
    case "text":
      return [node.text];
    case "file":
      return [`${node.file}${node.subpath ?? ""}`];
    case "group":
      return node.label === undefined ? [] : [node.label];
    case "link": {
      const { code, caption } = node.astrolabe ?? {};
      return [...(caption === undefined ? [] : [caption]), code?.path ?? node.url];
    }
  }
}

/**
 * Which of a board's cards, groups and arrows say `query`, case-insensitively. Cards are the unit
 * of a board, so a match is a card and its line, never a line of a file an agent doesn't read.
 */
export function canvasMatches(data: CanvasData, query: string): ReadonlyArray<CanvasMatch> {
  const needle = query.toLowerCase();
  const cards = data.nodes.flatMap((node): CanvasMatch[] => {
    const text = cardTexts(node).flatMap((each) => matchingLine(each, needle) ?? [])[0];
    return text === undefined ? [] : [{ id: node.id, text }];
  });
  const arrows = data.edges.flatMap((edge): CanvasMatch[] =>
    edge.label?.toLowerCase().includes(needle)
      ? [{ id: edge.id, text: `[${edge.fromNode}] -> [${edge.toNode}]: ${edge.label}` }]
      : [],
  );
  return [...cards, ...arrows];
}

/** A file's outline; JSON that doesn't read says so, and shows what is there to fix. */
export function canvasSourceOutline(file: string, source: string): string {
  const parsed = parseCanvas(source);
  return parsed.ok
    ? canvasOutline(file, parsed.data)
    : `${file} is not valid JSON (${parsed.error}). Its text:\n\n${source}`;
}

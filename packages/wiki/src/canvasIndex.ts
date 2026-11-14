/**
 * What the wiki's index reads out of a canvas: its links, an outline for agents and search, and a
 * rename. Server side only, so `canvas.ts` stays light enough for the phone's engine.
 */
import {
  canvasInkBounds,
  canvasStack,
  insideGroup,
  parseCanvas,
  serializeCanvas,
  type CanvasBounds,
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

const overlap = (a: CanvasBounds, b: CanvasBounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Past this, an outline says how many more overlap rather than each. */
const OVERLAPS_SHOWN = 40;

/** Which of the cards that overlap is on top, and the drawings each is over or under. */
function overlapLines(data: CanvasData): string[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const content = canvasStack(data).content;
  const cards: Array<{ readonly node: CanvasNode; readonly at: number }> = [];
  const drawings: Array<{ readonly bounds: CanvasBounds; readonly at: number }> = [];
  content.forEach((layer, at) => {
    if (layer.kind === "card") cards.push({ node: layer.node, at });
    if (layer.kind !== "drawing") return;
    const bounds = canvasInkBounds(layer.ink, nodes);
    if (bounds !== undefined) drawings.push({ bounds, at });
  });
  const lines: string[] = [];
  for (const top of cards) {
    const under = cards.filter((other) => other.at < top.at && overlap(other.node, top.node));
    const below = drawings.filter((each) => each.at < top.at && overlap(each.bounds, top.node));
    const above = drawings.filter((each) => each.at > top.at && overlap(each.bounds, top.node));
    const count = (n: number) => (n === 1 ? "a drawing" : `${n} drawings`);
    const parts = [
      ...(under.length === 0 ? [] : [`over ${under.map(({ node }) => `[${node.id}]`).join(" ")}`]),
      ...(below.length === 0 ? [] : [`over ${count(below.length)}`]),
      ...(above.length === 0 ? [] : [`under ${count(above.length)}`]),
    ];
    if (parts.length > 0) lines.push(`[${top.node.id}] ${parts.join(", ")}`);
  }
  if (lines.length <= OVERLAPS_SHOWN) return lines;
  return [...lines.slice(0, OVERLAPS_SHOWN), `…and ${lines.length - OVERLAPS_SHOWN} more.`];
}

/**
 * A canvas as an agent reads it: cards under the smallest group holding them, in reading order,
 * then the arrows between them, then which overlapping card is on top, then its stories. No
 * coordinates: a position is no use to something that can't see.
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
  const overlaps = overlapLines(data);
  if (overlaps.length > 0) lines.push("", "Overlapping", ...overlaps);
  for (const story of data.stories ?? []) {
    lines.push("", `Story: ${story.title}`);
    story.steps.forEach((step, index) => {
      const shows = (step.groups ?? (step.group === undefined ? step.cards : [step.group]))
        .map((id) => `[${id}]`)
        .join(" ");
      const label = step.label === undefined ? "" : `${step.label}. `;
      lines.push(`${index + 1}. ${shows} ${label}${step.note}`);
    });
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

/**
 * A codebase note's kind at a glance: the shape its node draws as, and the
 * glyph that stands for that shape in text (the popover, the play-by-play,
 * the cursor's chip, the Settings key). A vault's notes have no kind and stay
 * circles, so a memory without kinds draws exactly as before.
 */
import type { NoteKind } from "./memory.ts";
import type { LineRange } from "./thread.ts";

/** The node shapes, as the node shaders number them. */
export const NodeShape = {
  circle: 0,
  roundedSquare: 1,
  diamond: 2,
  hexagon: 3,
  triangle: 4,
  square: 5,
  /** A closed folder, package, or file: a disc with an inner ring. */
  container: 6,
} as const;
export type NodeShape = (typeof NodeShape)[keyof typeof NodeShape];

const SHAPE_OF: Readonly<Record<NoteKind, NodeShape>> = {
  function: NodeShape.circle,
  method: NodeShape.circle,
  class: NodeShape.roundedSquare,
  interface: NodeShape.diamond,
  enum: NodeShape.hexagon,
  type: NodeShape.triangle,
  constant: NodeShape.square,
  folder: NodeShape.container,
  package: NodeShape.container,
  file: NodeShape.container,
};

export const kindShape = (kind: NoteKind | undefined): NodeShape =>
  kind === undefined ? NodeShape.circle : SHAPE_OF[kind];

/** The shape a node draws as: the one it names, else its kind's. */
export const nodeShape = (node: {
  readonly kind?: NoteKind | undefined;
  readonly shape?: NodeShape | undefined;
}): NodeShape => node.shape ?? kindShape(node.kind);

/** The glyph for each kind's shape, in text. */
export const KIND_GLYPH: Readonly<Record<NoteKind, string>> = {
  function: "●",
  method: "●",
  class: "■",
  interface: "◆",
  enum: "⬢",
  type: "▲",
  constant: "▪",
  folder: "◎",
  package: "◎",
  file: "◎",
};

export const kindGlyph = (kind: NoteKind | undefined): string =>
  kind === undefined ? "" : KIND_GLYPH[kind];

/** The Settings key: each shape once, with the kinds it stands for. */
export const SHAPE_KEY: ReadonlyArray<{ readonly glyph: string; readonly kinds: string }> = [
  { glyph: "●", kinds: "function, method" },
  { glyph: "■", kinds: "class" },
  { glyph: "◆", kinds: "interface" },
  { glyph: "⬢", kinds: "enum" },
  { glyph: "▲", kinds: "type" },
  { glyph: "▪", kinds: "constant" },
  { glyph: "◎", kinds: "file, folder, package" },
];

/** The popover's first row: "◆ interface", "● method of Renderer". */
export const kindLine = (kind: NoteKind, parentName?: string): string =>
  `${KIND_GLYPH[kind]} ${kind}${kind === "method" && parentName !== undefined ? ` of ${parentName}` : ""}`;

/** The popover's source row: "src/model/view.ts · lines 69–79". */
export const sourceLine = (path: string, range: LineRange | null): string =>
  range === null
    ? path
    : `${path} · ${range.startLine === range.endLine ? `line ${range.startLine}` : `lines ${range.startLine}–${range.endLine}`}`;

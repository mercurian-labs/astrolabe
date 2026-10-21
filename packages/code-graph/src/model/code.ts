/**
 * A codebase as the Atlas Graph reads it: folders, files, and definitions are
 * the notes, each hung off its container by `parent`; uses and polymorphism are
 * the links. One index describes one git tree. The vocabulary is
 * Code-Graph-RAG's (its graph schema), so the two read alike.
 */
import type { LinkKind, LinkResolution, NoteKind } from "./graph.ts";

export type SymbolKind = NoteKind;
export type EdgeKind = LinkKind;
/**
 * How an edge's target was bound: `exact` when one definition is left (through
 * the file's imports, its own definitions, Go's package, or the only definition
 * of that name anywhere); `overload` when several are left in one file;
 * `heuristic` when several are left across files, by name alone.
 */
export type Resolution = LinkResolution;

/** Kinds that hold other notes: a note whose parent is one of these sits inside it. */
export const CONTAINER_KINDS: ReadonlySet<SymbolKind> = new Set(["folder", "package", "file"]);

export interface SymbolRange {
  /** 1-based, inclusive; 0 for a folder. */
  readonly startLine: number;
  readonly endLine: number;
}

export interface CodeSymbol {
  /**
   * `${path}#${kind}:${qualifiedName}`. A file is qualified by its base name, a
   * folder by its own name; a method by its class, `impl` type, or Go receiver.
   */
  readonly id: string;
  /** The short name drawn as the label: a method's name, not its path. */
  readonly name: string;
  readonly kind: SymbolKind;
  /** The file a definition is in; a folder's own path. */
  readonly path: string;
  readonly range: SymbolRange;
  /**
   * The definition's own text, with nested definitions blanked out: editing a
   * method changes the method's hash, not its class's or its file's. Empty for a folder.
   */
  readonly hash: string;
  /**
   * The containing symbol: method → class; other definitions → their file (or a
   * Rust `mod`, TypeScript namespace); file → folder; folder → folder. Absent
   * for a root folder, and for a file at the root.
   */
  readonly parent?: string;
  /** A definition's declaration line as written, whitespace-normalised, at most 200 characters. */
  readonly signature?: string;
  /** The first paragraph of a definition's doc comment, at most 400 characters. */
  readonly doc?: string;
}

/** A name referenced where no definition in the index carries it: a red link. */
export interface FrontierSymbol {
  /** `frontier:${name}` */
  readonly id: string;
  readonly name: string;
  readonly frontier: true;
}

export interface CodeEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  readonly resolution: Resolution;
}

/**
 * A name a symbol uses through an import of a module the index does not hold
 * (a dependency, or a path outside `--paths`). Kept for a popover; it draws nothing.
 */
export interface ExternalUse {
  readonly from: string;
  readonly name: string;
  /** The module as the import wrote it. */
  readonly source: string;
}

export interface CodeIndex {
  readonly ref: string;
  readonly commit: string;
  readonly symbols: ReadonlyArray<CodeSymbol>;
  readonly frontier: ReadonlyArray<FrontierSymbol>;
  readonly edges: ReadonlyArray<CodeEdge>;
  readonly externals: ReadonlyArray<ExternalUse>;
}

/** What changed between two trees: symbols by hash, edges by endpoints and kind. */
export interface CodeDelta {
  readonly fromRef: string;
  readonly toRef: string;
  readonly changedPaths: ReadonlyArray<string>;
  readonly added: ReadonlyArray<CodeSymbol>;
  readonly removed: ReadonlyArray<CodeSymbol>;
  readonly modified: ReadonlyArray<{ readonly before: CodeSymbol; readonly after: CodeSymbol }>;
  readonly addedEdges: ReadonlyArray<CodeEdge>;
  readonly removedEdges: ReadonlyArray<CodeEdge>;
  /**
   * Edges that stood before and after but resolved differently after: a second
   * candidate appeared (exact → heuristic), or one went (heuristic → exact).
   */
  readonly reresolvedEdges: ReadonlyArray<CodeEdge>;
}

export const frontierId = (name: string) => `frontier:${name}`;

/** A folder, or a folder that is a package: the only symbols with no lines of their own. */
export const isFolder = (symbol: CodeSymbol) => symbol.range.endLine === 0;

/** Code-unit order, the same on every machine and locale, so outputs regenerate byte-identical. */
export const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

/** One key per (from, kind, to): the same relationship found two ways is one edge. */
export const edgeKey = (edge: Pick<CodeEdge, "from" | "kind" | "to">) =>
  `${edge.from}\u0000${edge.kind}\u0000${edge.to}`;

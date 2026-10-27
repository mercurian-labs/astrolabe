/**
 * The Atlas Graph's input shapes, copied from @mercurian/graph (src/model/memory.ts, thread.ts)
 * because importing its root would typecheck the graph's React and Three.js sources. Keep them
 * identical, but for a note's optional `range` (the code view's); story tests replay the emitted
 * values through the graph's own model.
 */

/** What a note is, when the memory is a codebase; absent for a vault's notes. */
export type NoteKind =
  | "folder"
  | "package"
  | "file"
  | "class"
  | "interface"
  | "enum"
  | "type"
  | "function"
  | "method"
  | "constant";

/** What a link means, when the memory is a codebase; absent for a vault's wikilinks. */
export type LinkKind =
  | "calls"
  | "instantiates"
  | "references"
  | "imports"
  | "exports"
  | "inherits"
  | "implements"
  | "overrides"
  /** Data flow: a function takes the type as a parameter (from the function, to the type). */
  | "accepts"
  /** Data flow: a function gives the type back (from the function, to the type). */
  | "returns"
  /** Failure flow: a function raises the error type (from the function, to the error type). */
  | "throws"
  /** Failure flow: a function handles the error type (from the function, to the error type). */
  | "catches";

/** How surely a codebase's link was resolved to its target. */
export type LinkResolution = "exact" | "overload" | "heuristic";

/** Where a codebase's definition sits in its file, 1-based and inclusive. */
export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface MemoryNote {
  readonly id: string;
  readonly name: string;
  readonly frontier: boolean;
  readonly lastChanged?: string;
  readonly group?: string;
  readonly kind?: NoteKind;
  /** A codebase symbol's declaration line, as written ("function f(a: A): B"). */
  readonly signature?: string;
  /** A codebase symbol's doc comment, plain text; paragraphs split by a blank line. */
  readonly doc?: string;
  readonly parent?: string;
  /** The code story's own addition (not in the graph's shape): the note's lines at the first commit. */
  readonly range?: LineRange;
}

export interface MemoryLink {
  readonly from: string;
  readonly to: string;
  readonly kind?: LinkKind;
  readonly resolution?: LinkResolution;
}

export interface LensEdge {
  readonly from: string;
  readonly type: string;
  readonly to: string;
  readonly rationale?: string;
}

export interface MemoryLens {
  readonly name: string;
  /** The map's edge vocabulary: type name to its meaning. */
  readonly types: Readonly<Record<string, string>>;
  readonly edges: ReadonlyArray<LensEdge>;
}

export interface Memory {
  readonly id: string;
  readonly notes: ReadonlyArray<MemoryNote>;
  readonly links: ReadonlyArray<MemoryLink>;
  readonly lenses: ReadonlyArray<MemoryLens>;
}

/**
 * A codebase's declared layers and the dependencies allowed between them:
 * `[from-layer, to-layer]` follows a link's direction, and a link inside one
 * layer is never a violation.
 */
export interface Boundaries {
  readonly layers: ReadonlyArray<{ readonly name: string; readonly paths: ReadonlyArray<string> }>;
  readonly allowed: ReadonlyArray<readonly [string, string]>;
}

export type ThreadEvent =
  | { readonly kind: "read"; readonly note: string }
  | {
      readonly kind: "amend";
      readonly note: string;
      readonly name?: string;
      readonly group?: string;
      readonly noteKind?: NoteKind;
      readonly parent?: string;
      readonly range?: LineRange;
      readonly signature?: string;
      readonly doc?: string;
    }
  | {
      readonly kind: "write";
      readonly note: string;
      readonly name?: string;
      readonly group?: string;
      readonly noteKind?: NoteKind;
      readonly parent?: string;
      readonly range?: LineRange;
      readonly signature?: string;
      readonly doc?: string;
    }
  | {
      readonly kind: "link";
      readonly from: string;
      readonly to: string;
      readonly linkKind?: LinkKind;
      /** In a codebase: how surely the link was resolved to its target. */
      readonly resolution?: LinkResolution;
    }
  | {
      readonly kind: "unlink";
      readonly from: string;
      readonly to: string;
      readonly linkKind?: LinkKind;
      /** In a codebase: how surely the link was resolved to its target. */
      readonly resolution?: LinkResolution;
    };

export interface ThreadTurn {
  readonly id: string;
  readonly label: string;
  readonly events: ReadonlyArray<ThreadEvent>;
}

export interface ThreadRecord {
  readonly id: string;
  readonly title: string;
  readonly memoryId: string;
  readonly turns: ReadonlyArray<ThreadTurn>;
}

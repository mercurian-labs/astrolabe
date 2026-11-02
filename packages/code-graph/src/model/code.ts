/**
 * A file's definitions as the parser reads them: folders, files and definitions, each hung off
 * its container by `parent`. The code index stores them per file version (`apps/server`'s
 * codeIndex) and resolves the links between them when a question is asked.
 */
export type SymbolKind =
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

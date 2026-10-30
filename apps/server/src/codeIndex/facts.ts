/**
 * One file version's facts as the code index stores them: what it defines, the names it uses and
 * where, and its imports. Facts never name another file's symbols; links are resolved when a
 * question is asked, against the checkout asking it. Shared by the worker (which writes them) and
 * the server (which reads them), so it holds no Effect code.
 */
import * as NodeZlib from "node:zlib";

import {
  wantedKeys,
  type FileFacts,
  type ImportBinding,
  type LanguageId,
  type ReferenceKind,
} from "@mercurian/code-graph";
import type { CodeSymbolKind } from "@t3tools/contracts";

export interface StoredSymbol {
  readonly name: string;
  readonly kind: CodeSymbolKind;
  /** The name within its file: a method as `Class.method`. */
  readonly qualified: string;
  readonly line: number;
  readonly endLine: number;
  /** The containing symbol's name: a method's class; null under the file. */
  readonly parent: string | null;
  readonly signature: string | null;
  readonly exported: boolean;
  /** The definition's own text, hashed; a change to it changes the symbol. */
  readonly hash: string;
}

export interface StoredReference {
  readonly name: string;
  readonly kind: ReferenceKind;
  readonly qualifier: string | null;
  /** The qualified name of the symbol the reference sits in; null at the file's top level. */
  readonly from: string | null;
  readonly lines: ReadonlyArray<number>;
}

export interface StoredFacts {
  readonly symbols: ReadonlyArray<StoredSymbol>;
  readonly references: ReadonlyArray<StoredReference>;
  readonly locals: ReadonlyArray<string>;
  readonly defaultExport: string | null;
}

export type StoredImport = ImportBinding;

const KINDS: Readonly<Record<string, CodeSymbolKind>> = {
  class: "class",
  interface: "interface",
  enum: "enum",
  type: "type",
  function: "function",
  method: "method",
  constant: "constant",
  package: "module",
};

/** `path#kind:Qualified.name` → `Qualified.name`. */
const qualifiedOf = (path: string, id: string) => {
  const rest = id.slice(path.length + 1);
  return rest.slice(rest.indexOf(":") + 1);
};

/** The package a bare TypeScript specifier names: `@scope/name/sub` → `@scope/name`. */
export function packageNameOf(source: string): string | null {
  if (source.startsWith(".") || source.startsWith("/") || source === "") return null;
  const segments = source.split("/");
  return source.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? null);
}

/**
 * The module keys a file's imports ask for: code-graph's keys for relative and language-native
 * imports, `pkg:<name>` for a bare TypeScript specifier. The used-by side of the index starts
 * from these.
 */
export function askedKeys(
  language: LanguageId,
  path: string,
  imports: ReadonlyArray<ImportBinding>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const binding of imports) {
    for (const key of wantedKeys(language, path, binding.source, binding.imported)) keys.add(key);
    for (const key of wantedKeys(language, path, binding.source, null)) keys.add(key);
    if (language === "typescript" || language === "tsx") {
      const name = packageNameOf(binding.source);
      if (name !== null) keys.add(`pkg:${name}`);
    }
  }
  return keys;
}

export interface FileRecord {
  readonly facts: StoredFacts;
  readonly imports: ReadonlyArray<StoredImport>;
  readonly lines: number;
  /** Names the file defines, for finding definitions by name. */
  readonly defines: ReadonlySet<string>;
  /** Names the file references or imports, for finding uses by name. */
  readonly uses: ReadonlySet<string>;
  readonly asks: ReadonlySet<string>;
}

export function recordOf(facts: FileFacts): FileRecord {
  const { path } = facts;
  const exported = new Set(facts.exports);
  const definitions = facts.symbols.filter((symbol) => symbol.kind !== "file");
  const nameById = new Map(definitions.map((symbol) => [symbol.id, symbol.name]));
  const symbols: Array<StoredSymbol> = [];
  for (const symbol of definitions) {
    const kind = KINDS[symbol.kind];
    if (kind === undefined) continue;
    symbols.push({
      name: symbol.name,
      kind,
      qualified: qualifiedOf(path, symbol.id),
      line: symbol.range.startLine,
      endLine: symbol.range.endLine,
      parent: symbol.parent === undefined ? null : (nameById.get(symbol.parent) ?? null),
      signature: symbol.signature ?? null,
      exported: exported.has(symbol.id),
      hash: symbol.hash,
    });
  }
  const fileId = facts.symbols[0]?.id;
  const references: Array<StoredReference> = facts.references.map((reference) => ({
    name: reference.name,
    kind: reference.kind,
    qualifier: reference.qualifier,
    from: reference.from === fileId ? null : qualifiedOf(path, reference.from),
    lines: reference.lines,
  }));
  const uses = new Set(references.map((reference) => reference.name));
  for (const binding of facts.imports) if (binding.imported !== null) uses.add(binding.imported);
  return {
    facts: {
      symbols,
      references,
      locals: facts.locals,
      defaultExport: facts.defaultExport,
    },
    imports: facts.imports,
    lines: facts.symbols[0]?.range.endLine ?? 0,
    defines: new Set(symbols.map((symbol) => symbol.name)),
    uses,
    asks: askedKeys(facts.language, path, facts.imports),
  };
}

export const encodeJson = (value: unknown): Uint8Array =>
  NodeZlib.deflateRawSync(JSON.stringify(value));

export const decodeJson = <A>(bytes: Uint8Array): A =>
  JSON.parse(NodeZlib.inflateRawSync(bytes).toString("utf8")) as A;

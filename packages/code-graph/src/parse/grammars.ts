/**
 * Grammars and queries, loaded once per process. The WASM grammars come from
 * @vscode/tree-sitter-wasm (built with tree-sitter 0.25, so web-tree-sitter 0.27
 * loads them); the queries are this package's `queries/` files.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { Language, Parser, Query } from "web-tree-sitter";

import { QUERY_FILES, type LanguageId } from "./languages.ts";

export interface Grammar {
  readonly id: LanguageId;
  readonly parser: Parser;
  readonly tags: Query;
  readonly imports: Query;
  readonly locals: Query;
}

const queriesDir = NodeURL.fileURLToPath(new URL("../../queries/", import.meta.url));
const wasmDir = NodeURL.fileURLToPath(
  new URL("./wasm/", import.meta.resolve("@vscode/tree-sitter-wasm/package.json")),
);

let ready: Promise<void> | null = null;
const grammars = new Map<LanguageId, Promise<Grammar>>();

const readQuery = (file: string) => NodeFS.readFileSync(NodePath.join(queriesDir, file), "utf8");

async function load(id: LanguageId): Promise<Grammar> {
  ready ??= Parser.init();
  await ready;
  const language = await Language.load(
    NodeFS.readFileSync(NodePath.join(wasmDir, `tree-sitter-${id}.wasm`)),
  );
  const parser = new Parser();
  parser.setLanguage(language);
  const files = QUERY_FILES[id];
  return {
    id,
    parser,
    tags: new Query(language, files.tags.map(readQuery).join("\n")),
    imports: new Query(language, readQuery(`imports/${files.family}.scm`)),
    locals: new Query(language, readQuery(`locals/${files.family}.scm`)),
  };
}

export function grammarFor(id: LanguageId): Promise<Grammar> {
  let grammar = grammars.get(id);
  if (grammar === undefined) {
    grammar = load(id);
    grammars.set(id, grammar);
  }
  return grammar;
}

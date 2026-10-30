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

/**
 * Where the queries and grammars are read from: beside this package's sources,
 * or, in a bundle that cannot reach them, the directory `useAssets` names.
 */
interface Assets {
  readonly queries: string;
  readonly wasm: string;
  /** web-tree-sitter's own runtime, when it is not beside its module. */
  readonly runtime: string | null;
}

let assets: Assets | null = null;

const sourceAssets = (): Assets => ({
  queries: NodeURL.fileURLToPath(new URL("../../queries/", import.meta.url)),
  wasm: NodeURL.fileURLToPath(
    new URL("./wasm/", import.meta.resolve("@vscode/tree-sitter-wasm/package.json")),
  ),
  runtime: null,
});

/**
 * Read the queries and grammars from `dir` instead, laid out as `queries/` (this
 * package's), `wasm/tree-sitter-<language>.wasm`, and `wasm/web-tree-sitter.wasm`:
 * what a bundled worker ships beside itself. Call it before anything parses.
 */
export function useAssets(dir: string): void {
  const wasm = NodePath.join(dir, "wasm");
  assets = {
    queries: NodePath.join(dir, "queries"),
    wasm,
    runtime: NodePath.join(wasm, "web-tree-sitter.wasm"),
  };
}

let ready: Promise<void> | null = null;
const grammars = new Map<LanguageId, Promise<Grammar>>();

async function load(id: LanguageId): Promise<Grammar> {
  assets ??= sourceAssets();
  const { queries, wasm, runtime } = assets;
  const readQuery = (file: string) => NodeFS.readFileSync(NodePath.join(queries, file), "utf8");
  ready ??= Parser.init(runtime === null ? undefined : { locateFile: () => runtime });
  await ready;
  const language = await Language.load(
    NodeFS.readFileSync(NodePath.join(wasm, `tree-sitter-${id}.wasm`)),
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

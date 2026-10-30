/**
 * One file's facts, read with tree-sitter tag and import queries: the file and
 * the symbols it defines (each with its parent), what it exports, the names it
 * references, and the names its imports bind. Nothing here looks beyond the
 * file; resolution does that, and the indexer hangs the file off its folder.
 */
import type { Node, QueryMatch } from "web-tree-sitter";

import type { CodeSymbol, SymbolKind } from "../model/code.ts";
import { docOf, failureSites, signatureOf, signatureTypes } from "./contracts.ts";
import { grammarFor } from "./grammars.ts";
import type { LanguageId } from "./languages.ts";

/**
 * What a reference does, before resolution: `types` (a type annotation) and
 * `values` (a function or class passed as a value) both become `references`
 * links, but each accepts different targets.
 */
export type ReferenceKind =
  | "calls"
  | "instantiates"
  | "inherits"
  | "implements"
  | "types"
  | "values"
  /** A parameter's annotated type, from the callable. */
  | "accepts"
  /** The return's annotated type, from the callable. */
  | "returns"
  /** An error type thrown, raised, or returned as an error, from the callable. */
  | "throws"
  /** An error type caught, from the callable. */
  | "catches";

export interface Reference {
  /** The innermost symbol the reference sits in; the file at top level. */
  readonly from: string;
  readonly name: string;
  readonly kind: ReferenceKind;
  /**
   * What the name was reached through: `NodeFS` in `NodeFS.readFileSync()`,
   * `self` in `self.run()`, `*` for an expression; null for a bare name.
   */
  readonly qualifier: string | null;
  /** Every 1-based line the reference is made on, in source order. */
  readonly lines: ReadonlyArray<number>;
}

/**
 * The name a default import takes from its module, as in `import { default as x }`:
 * resolution reads it as the module's `defaultExport`.
 */
export const DEFAULT_EXPORT = "default";

export interface ImportBinding {
  /** `named` binds one name from the module, `namespace` the module, `module` nothing. */
  readonly kind: "named" | "namespace" | "module";
  /** The module as written: `./memory.ts`, `.io`, `github.com/x/y`, `crate::a`. */
  readonly source: string;
  /** The name bound in this file; null for `module`. */
  readonly local: string | null;
  /** The name taken from the module, for `named`. */
  readonly imported: string | null;
  /** The import statement's first line, 1-based, and its text, whitespace-normalised. */
  readonly line: number;
  readonly text: string;
}

export interface FileFacts {
  readonly path: string;
  readonly language: LanguageId;
  /**
   * The file first (its parent left to the indexer, which knows the folders),
   * then its definitions in source order, each with its parent.
   */
  readonly symbols: ReadonlyArray<CodeSymbol>;
  /** Ids of the definitions the file exports. */
  readonly exports: ReadonlyArray<string>;
  readonly references: ReadonlyArray<Reference>;
  readonly imports: ReadonlyArray<ImportBinding>;
  /**
   * Names the file binds as variables or parameters, sorted. A call to one calls
   * something the code wrote, even though no tag names it a definition.
   */
  readonly locals: ReadonlyArray<string>;
  /** The name the file exports as default (`export default function actual`), if any. */
  readonly defaultExport: string | null;
}

/** A 53-bit string hash (cyrb53), hex. Deterministic and dependency-free. */
function contentHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const fileId = (path: string) => `${path}#file:${baseName(path)}`;

type Callable = "callable";
type DefinitionTag = Exclude<SymbolKind, "function" | "method" | "folder" | "file"> | Callable;

const TAG_KINDS: Readonly<Record<string, DefinitionTag>> = {
  class: "class",
  interface: "interface",
  enum: "enum",
  function: "callable",
  method: "callable",
  macro: "callable",
  module: "package",
  type: "type",
  constant: "constant",
};

/** When two tags name the same node, the first kind here wins. */
const KIND_PRIORITY: ReadonlyArray<DefinitionTag> = [
  "callable",
  "class",
  "enum",
  "interface",
  "type",
  "constant",
  "package",
];

const REFERENCE_KINDS: Readonly<Record<string, ReferenceKind>> = {
  call: "calls",
  class: "instantiates",
  implementation: "implements",
  extends: "inherits",
  type: "types",
  value: "values",
};

/** Kinds whose callables are methods. */
const CLASS_LIKE = new Set<SymbolKind>(["class", "interface", "enum"]);
/** Kinds a definition hangs off, other than its file. */
const HOLDERS = new Set<SymbolKind>(["class", "interface", "enum", "package"]);
const PYTHON_ENUM_BASES = new Set(["Enum", "IntEnum", "StrEnum", "Flag", "IntFlag"]);
const QUALIFIER = /^[A-Za-z_$][\w$]*(?:(?:\.|::)[A-Za-z_$][\w$]*)*$/;

const nodeKey = (node: Node) => `${node.startIndex}:${node.endIndex}:${node.type}`;
const captureOf = (match: QueryMatch, name: string) =>
  match.captures.find((capture) => capture.name === name)?.node;
const roleOf = (match: QueryMatch, prefix: string) =>
  match.captures.find((capture) => capture.name.startsWith(prefix));

interface Candidate {
  readonly node: Node;
  readonly nameNode: Node;
  tag: DefinitionTag;
}

interface Definition {
  readonly node: Node;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly qualifiedName: string;
  readonly id: string;
  /** Containment by source range, which blanks nested text out of the hash. */
  readonly enclosing: Definition | null;
  /** The type an `impl` block or Go receiver attaches the definition to, by name. */
  readonly scopeType: string | null;
  parent: string;
}

/** The type an `impl` block or a Go method receiver attaches to. */
function scopeTypeName(node: Node): string | null {
  const type =
    node.type === "impl_item"
      ? node.childForFieldName("type")
      : node.type === "method_declaration"
        ? node.childForFieldName("receiver")?.namedChildren[0]?.childForFieldName("type")
        : null;
  if (type === null || type === undefined) return null;
  const named = type.descendantsOfType("type_identifier")[0];
  return type.type === "type_identifier" ? type.text : (named?.text ?? null);
}

/**
 * What the tags leave to the syntax: Go says what a `type` is by its right-hand
 * side; Rust's `type` is an alias and its `enum` an enum; a Python class
 * deriving `Enum` is an enum.
 */
function refineKind(tag: DefinitionTag, node: Node): DefinitionTag {
  switch (node.type) {
    case "type_spec": {
      const type = node.childForFieldName("type")?.type;
      return type === "struct_type" ? "class" : type === "interface_type" ? "interface" : "type";
    }
    case "type_item":
      return "type";
    case "enum_item":
      return "enum";
    case "class_definition": {
      const bases = node.childForFieldName("superclasses")?.namedChildren ?? [];
      const derivesEnum = bases.some((base) =>
        PYTHON_ENUM_BASES.has(
          base.type === "attribute" ? (base.childForFieldName("attribute")?.text ?? "") : base.text,
        ),
      );
      return derivesEnum ? "enum" : tag;
    }
    default:
      return tag;
  }
}

function qualifierOf(nameNode: Node): string | null {
  const parent = nameNode.parent;
  if (parent === null) return null;
  const field =
    parent.type === "member_expression"
      ? "object"
      : parent.type === "attribute"
        ? "object"
        : parent.type === "selector_expression"
          ? "operand"
          : parent.type === "field_expression"
            ? "value"
            : parent.type === "scoped_identifier" || parent.type === "scoped_type_identifier"
              ? "path"
              : parent.type === "nested_type_identifier"
                ? "module"
                : null;
  if (field === null) return null;
  const target = parent.childForFieldName(field);
  if (target === null || target.id === nameNode.id) return null;
  return QUALIFIER.test(target.text) ? target.text : "*";
}

/**
 * The identifier a reference names. JavaScript's tags capture a `new` target
 * whole, so `new Lib.Widget()` names `Widget`, reached through `Lib`; a target
 * that is no name at all (`new (factory())()`) references nothing.
 */
function referencedName(node: Node): Node | null {
  if (node.type === "member_expression") return node.childForFieldName("property");
  return node.type.endsWith("identifier") ? node : null;
}

/** Whether a definition is exported, by its language's own mark. */
function exportedBySyntax(language: LanguageId, definition: Definition): boolean {
  const { node } = definition;
  switch (language) {
    case "typescript":
    case "tsx": {
      if (definition.enclosing !== null) return false;
      const statement = node.type === "variable_declarator" ? node.parent?.parent : node.parent;
      return statement?.type === "export_statement";
    }
    case "rust":
      return node.namedChildren.some(
        (child) => child.type === "visibility_modifier" && child.text === "pub",
      );
    case "go":
      return (
        /^[A-Z]/.test(definition.name) &&
        (definition.enclosing === null || node.type === "method_declaration")
      );
    default:
      return false;
  }
}

/** Replace nested definitions' text so a definition's hash is its own text only. */
function shellHash(
  text: string,
  start: number,
  end: number,
  nested: ReadonlyArray<Node>,
  doc = "",
): string {
  let shell = "";
  let at = start;
  for (const child of nested) {
    shell += text.slice(at, child.startIndex) + "\u0001";
    at = child.endIndex;
  }
  return contentHash(shell + text.slice(at, end) + (doc === "" ? "" : `\u0002${doc}`));
}

const STATEMENT_TEXT_MAX = 200;
const statementText = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > STATEMENT_TEXT_MAX ? `${flat.slice(0, STATEMENT_TEXT_MAX - 1)}…` : flat;
};

function importBindings(language: LanguageId, matches: ReadonlyArray<QueryMatch>) {
  const bindings: Array<ImportBinding> = [];
  const seen = new Set<string>();
  const add = (binding: ImportBinding) => {
    const key = `${binding.kind}\u0000${binding.source}\u0000${binding.local}\u0000${binding.imported}`;
    if (seen.has(key)) return;
    seen.add(key);
    bindings.push(binding);
  };
  for (const match of matches) {
    const role = roleOf(match, "import.")?.name.slice("import.".length);
    const sourceNode = captureOf(match, "source");
    if (role === undefined || sourceNode === undefined) continue;
    const source =
      language === "go" ? sourceNode.text.replace(/^["`]|["`]$/g, "") : sourceNode.text;
    const name = captureOf(match, "name")?.text ?? null;
    const local = captureOf(match, "local")?.text ?? null;
    const statement = roleOf(match, "import.")?.node ?? sourceNode;
    const at = { line: statement.startPosition.row + 1, text: statementText(statement.text) };
    if (role === "named" && name !== null) {
      add({ kind: "named", source, local: local ?? name, imported: name, ...at });
    } else if (role === "default" && local !== null) {
      add({ kind: "named", source, local, imported: DEFAULT_EXPORT, ...at });
    } else if (role === "namespace") {
      const bound = local ?? (language === "go" ? (source.split("/").at(-1) ?? source) : source);
      add({ kind: "namespace", source, local: bound, imported: null, ...at });
      // `import a.b` also binds `a`, which is how the code reaches `a.b.f()`.
      if (language === "python" && local === null && source.includes(".")) {
        const first = source.slice(0, source.indexOf("."));
        add({ kind: "namespace", source: first, local: first, imported: null, ...at });
      }
    } else {
      add({ kind: "module", source, local: null, imported: null, ...at });
    }
  }
  return bindings;
}

export interface ExtractStats {
  /** Every file parsed, in order; tests assert a delta parses only what changed. */
  readonly parsed: Array<string>;
}

export function newExtractStats(): ExtractStats {
  return { parsed: [] };
}

export async function extractFile(
  path: string,
  language: LanguageId,
  text: string,
  stats?: ExtractStats,
): Promise<FileFacts> {
  const grammar = await grammarFor(language);
  const tree = grammar.parser.parse(text);
  if (tree === null) throw new Error(`tree-sitter could not parse ${path}`);
  stats?.parsed.push(path);
  try {
    const root = tree.rootNode;
    const locals = new Set(grammar.locals.captures(root).map((capture) => capture.node.text));
    const importMatches = grammar.imports.matches(root);
    const defaultMatch = importMatches.find(
      (match) => roleOf(match, "export.default") !== undefined,
    );
    const defaultExport =
      (defaultMatch === undefined ? undefined : captureOf(defaultMatch, "name"))?.text ?? null;
    const exportedNames = new Set(
      importMatches
        .filter((match) => roleOf(match, "export.named") !== undefined)
        .flatMap((match) => captureOf(match, "name")?.text ?? []),
    );
    if (defaultExport !== null) exportedNames.add(defaultExport);
    return {
      ...factsOf(path, language, text, root, grammar.tags.matches(root), exportedNames),
      imports: importBindings(language, importMatches),
      locals: [...locals].toSorted(),
      defaultExport,
    };
  } finally {
    tree.delete();
  }
}

function factsOf(
  path: string,
  language: LanguageId,
  text: string,
  root: Node,
  tagMatches: ReadonlyArray<QueryMatch>,
  exportedNames: ReadonlySet<string>,
): Pick<FileFacts, "path" | "language" | "symbols" | "exports" | "references"> {
  const file = fileId(path);
  const candidates = new Map<string, Candidate>();
  const referenceCaptures: Array<{ nameNode: Node; role: string; roleNode: Node }> = [];

  for (const match of tagMatches) {
    const nameNode = captureOf(match, "name");
    const role = roleOf(match, "definition.") ?? roleOf(match, "reference.");
    if (nameNode === undefined || role === undefined) continue;
    const [family, tagName = ""] = role.name.split(".");
    if (family === "definition") {
      const tag = TAG_KINDS[tagName];
      if (tag === undefined) continue;
      const refined = refineKind(tag, role.node);
      const key = nodeKey(role.node);
      const existing = candidates.get(key);
      if (existing === undefined) candidates.set(key, { node: role.node, nameNode, tag: refined });
      else if (KIND_PRIORITY.indexOf(refined) < KIND_PRIORITY.indexOf(existing.tag)) {
        existing.tag = refined;
      }
    } else {
      const referenced = referencedName(nameNode);
      if (referenced !== null) {
        referenceCaptures.push({ nameNode: referenced, role: tagName, roleNode: role.node });
      }
    }
  }

  // Source order, outer before inner, so every definition's encloser is already built.
  const ordered = [...candidates.values()].toSorted(
    (left, right) =>
      left.node.startIndex - right.node.startIndex || right.node.endIndex - left.node.endIndex,
  );
  const definitions: Array<Definition> = [];
  const byNode = new Map<string, Definition>();
  const open: Array<Definition> = [];
  for (const candidate of ordered) {
    while (open.length > 0 && (open.at(-1)?.node.endIndex ?? 0) <= candidate.node.startIndex) {
      open.pop();
    }
    const enclosing = open.at(-1) ?? null;
    // An `impl` block or a Go receiver between this definition and its encloser names its type.
    let scopeType: string | null = null;
    for (let at = candidate.node.parent; at !== null; at = at.parent) {
      if (enclosing !== null && at.id === enclosing.node.id) break;
      if (at.type === "impl_item") {
        scopeType = scopeTypeName(at);
        break;
      }
    }
    if (candidate.node.type === "method_declaration") scopeType = scopeTypeName(candidate.node);
    const name = candidate.nameNode.text;
    const kind: SymbolKind =
      candidate.tag !== "callable"
        ? candidate.tag
        : scopeType !== null ||
            (enclosing !== null && CLASS_LIKE.has(enclosing.kind)) ||
            candidate.node.type === "method_elem"
          ? "method"
          : "function";
    const qualifiedName = [enclosing?.qualifiedName, scopeType, name]
      .filter((part) => part !== undefined && part !== null)
      .join(".");
    // The nearest class, interface, enum, or module holds it; else its file.
    let holder = enclosing;
    while (holder !== null && !HOLDERS.has(holder.kind)) holder = holder.enclosing;
    const definition: Definition = {
      node: candidate.node,
      name,
      kind,
      qualifiedName,
      id: `${path}#${kind}:${qualifiedName}`,
      enclosing,
      scopeType,
      parent: holder?.id ?? file,
    };
    definitions.push(definition);
    byNode.set(nodeKey(candidate.node), definition);
    open.push(definition);
  }

  // A method in an `impl` or with a receiver hangs off its type when the file defines
  // it at the same level; otherwise off the holder it sits in.
  const typeAt = (level: Definition | null, name: string) =>
    definitions.find(
      (definition) =>
        definition.enclosing === level &&
        definition.name === name &&
        (definition.kind === "class" || definition.kind === "type" || definition.kind === "enum"),
    );
  for (const definition of definitions) {
    if (definition.scopeType === null || definition.kind !== "method") continue;
    const type = typeAt(definition.enclosing, definition.scopeType);
    if (type !== undefined) definition.parent = type.id;
  }

  // Hashes: each definition's text without its nested definitions.
  const nestedOf = new Map<Definition | null, Array<Node>>();
  for (const definition of definitions) {
    const list = nestedOf.get(definition.enclosing) ?? [];
    list.push(definition.node);
    nestedOf.set(definition.enclosing, list);
  }
  const lines = (node: Node) => ({
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  });

  // Overloads and redefinitions share an id: one symbol, its texts hashed together.
  const symbols = new Map<string, CodeSymbol>();
  symbols.set(file, {
    id: file,
    name: baseName(path),
    kind: "file",
    path,
    range: { startLine: 1, endLine: root.endPosition.row + 1 },
    hash: shellHash(text, 0, text.length, nestedOf.get(null) ?? []),
  });
  const exports = new Set<string>();
  for (const definition of definitions) {
    const signature = signatureOf(definition.node);
    const doc = docOf(language, definition.node);
    // The doc sits outside the definition's text, so it joins the hash: a changed doc amends.
    const hash = shellHash(
      text,
      definition.node.startIndex,
      definition.node.endIndex,
      nestedOf.get(definition) ?? [],
      doc ?? "",
    );
    const range = lines(definition.node);
    const prior = symbols.get(definition.id);
    symbols.set(
      definition.id,
      prior === undefined
        ? {
            id: definition.id,
            name: definition.name,
            kind: definition.kind,
            path,
            range,
            hash,
            parent: definition.parent,
            ...(signature === "" ? {} : { signature }),
            ...(doc === undefined ? {} : { doc }),
          }
        : {
            ...prior,
            range: { startLine: prior.range.startLine, endLine: range.endLine },
            hash: contentHash(prior.hash + hash),
          },
    );
    const named = definition.enclosing === null && exportedNames.has(definition.name);
    if (named || exportedBySyntax(language, definition)) exports.add(definition.id);
  }

  const nameNodes = new Set(
    [...candidates.values()].map((candidate) => nodeKey(candidate.nameNode)),
  );
  const enclosingOf = (node: Node) => {
    for (let at = node.parent; at !== null; at = at.parent) {
      const definition = byNode.get(nodeKey(at));
      if (definition !== undefined) return definition.id;
    }
    return file;
  };
  const references: Array<Reference> = [];
  // The same reference made again adds its line; it stays one reference.
  const seenReferences = new Map<string, Array<number>>();
  const push = (reference: Omit<Reference, "lines">, line: number) => {
    const key = `${reference.from}\u0000${reference.name}\u0000${reference.kind}\u0000${reference.qualifier}`;
    const seen = seenReferences.get(key);
    if (seen !== undefined) {
      if (!seen.includes(line)) seen.push(line);
      return;
    }
    const created = [line];
    seenReferences.set(key, created);
    references.push({ ...reference, lines: created });
  };
  const lineOf = (node: Node) => node.startPosition.row + 1;

  // Contracts: the types a callable's parameters and return are annotated with. Those
  // annotations are `accepts` and `returns`, not plain type references.
  const contracts: Array<{ reference: Omit<Reference, "lines">; line: number }> = [];
  const annotated = new Set<string>();
  for (const definition of definitions) {
    if (definition.kind !== "function" && definition.kind !== "method") continue;
    const { accepts, returns } = signatureTypes(language, definition.node);
    for (const [kind, types] of [
      ["accepts", accepts],
      ["returns", returns],
    ] as const) {
      for (const type of types) {
        annotated.add(nodeKey(type.node));
        contracts.push({
          reference: { from: definition.id, name: type.name, kind, qualifier: type.qualifier },
          line: lineOf(type.node),
        });
      }
    }
  }

  for (const capture of referenceCaptures) {
    const kind = REFERENCE_KINDS[capture.role];
    if (kind === undefined || nameNodes.has(nodeKey(capture.nameNode))) continue;
    if (kind === "types" && annotated.has(nodeKey(capture.nameNode))) continue;
    // Python's base classes sit in an argument list; they are inherited, not passed.
    if (kind === "values" && capture.roleNode.parent?.type === "class_definition") continue;
    let from = enclosingOf(capture.nameNode);
    if (capture.role === "implementation" && capture.roleNode.type === "impl_item") {
      // `impl Trait for Type`: the type implements the trait. An inherent `impl Type` is
      // the type's own methods, already held by it.
      if (capture.roleNode.childForFieldName("trait") === null) continue;
      const type = scopeTypeName(capture.roleNode);
      from = (type === null ? undefined : typeAt(null, type)?.id) ?? file;
    }
    let reference: Omit<Reference, "lines"> = {
      from,
      name: capture.nameNode.text,
      kind,
      qualifier: qualifierOf(capture.nameNode),
    };
    // Rust's constructor convention: `Circle::new(1.0)` instantiates `Circle`.
    if (language === "rust" && kind === "calls" && reference.name === "new") {
      const path = reference.qualifier?.split("::") ?? [];
      const type = path.at(-1);
      if (type !== undefined && /^[A-Z]/.test(type) && type !== "Self") {
        reference = {
          from,
          name: type,
          kind: "instantiates",
          qualifier: path.length > 1 ? path.slice(0, -1).join("::") : null,
        };
      }
    }
    push(reference, lineOf(capture.nameNode));
  }
  for (const { reference, line } of contracts) push(reference, line);

  // Failure paths, from the callable they sit in.
  const callables = new Set(
    definitions
      .filter((definition) => definition.kind === "function" || definition.kind === "method")
      .map((definition) => definition.id),
  );
  for (const site of failureSites(language, root)) {
    const from = enclosingOf(site.node);
    if (callables.has(from)) {
      push(
        { from, name: site.name, kind: site.kind, qualifier: site.qualifier },
        lineOf(site.node),
      );
    }
  }

  return {
    path,
    language,
    symbols: [...symbols.values()],
    exports: [...exports].toSorted(),
    references,
  };
}

/**
 * A definition's contract and failure paths, read from its syntax: the
 * declaration line as written, the doc comment attached to it, the types its
 * parameters and return are annotated with, and the error types it throws and
 * catches. All syntactic: nothing is inferred.
 */
import type { Node } from "web-tree-sitter";

import type { LanguageId } from "./languages.ts";

const SIGNATURE_MAX = 200;
const DOC_MAX = 400;

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The node holding a callable's parameters and return: the definition, or the function a declarator holds. */
function callableOf(node: Node): Node | null {
  if (node.type === "variable_declarator" || node.type === "pair") {
    const value = node.childForFieldName("value");
    return value !== null &&
      (value.type === "arrow_function" || value.type === "function_expression")
      ? value
      : null;
  }
  return node.childForFieldName("parameters") === null ? null : node;
}

/**
 * The declaration line: the definition's text up to its body (or, with none,
 * all of it), whitespace-normalised, without the punctuation that opens the
 * body, at most 200 characters. A declarator with a function value reads as
 * `name = (params): Return`.
 */
export function signatureOf(node: Node): string {
  let head: string;
  const value =
    node.type === "variable_declarator" || node.type === "pair" ? callableOf(node) : null;
  if (value !== null) {
    const name = node.childForFieldName(node.type === "pair" ? "key" : "name")?.text ?? "";
    const body = value.childForFieldName("body");
    const text = value.text;
    head = `${name} = ${body === null ? text : text.slice(0, body.startIndex - value.startIndex)}`;
  } else {
    const body = node.childForFieldName("body");
    const text = node.text;
    if (body !== null && body.startIndex > node.startIndex) {
      head = text.slice(0, body.startIndex - node.startIndex);
    } else {
      // A Go type spec's struct or interface carries its fields where a body would be.
      const brace = node.type === "type_spec" ? text.indexOf("{") : -1;
      head = brace > 0 ? text.slice(0, brace) : text;
    }
  }
  return clip(
    oneLine(head)
      .replace(/\s*(=>|:|=|;|\{)\s*$/, "")
      .trim(),
    SIGNATURE_MAX,
  );
}

/** The statement a definition's doc comment sits above. */
function statementOf(language: LanguageId, node: Node): Node {
  let statement = node;
  if (language === "typescript" || language === "tsx") {
    if (node.type === "variable_declarator") statement = node.parent ?? node;
    if (statement.parent?.type === "export_statement") statement = statement.parent;
  } else if (language === "go" && node.type === "type_spec") {
    statement = node.parent ?? node;
  } else if (language === "python" && node.parent?.type === "decorated_definition") {
    statement = node.parent;
  }
  return statement;
}

/** The first paragraph of a doc's lines, stopping at a blank line or a JSDoc tag. */
function firstParagraph(lines: ReadonlyArray<string>): string | undefined {
  const kept: Array<string> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (kept.length > 0) break;
      continue;
    }
    if (trimmed.startsWith("@")) break;
    kept.push(trimmed);
  }
  const text = oneLine(kept.join(" "));
  return text === "" ? undefined : clip(text, DOC_MAX);
}

/** Comment siblings directly above `statement`, each touching the next, outermost first. */
function commentsAbove(
  statement: Node,
  isDoc: (comment: Node) => boolean,
  skip: (node: Node) => boolean,
) {
  const comments: Array<Node> = [];
  let row = statement.startPosition.row;
  for (let at = statement.previousNamedSibling; at !== null; at = at.previousNamedSibling) {
    if (at.endPosition.row < row - 1) break;
    if (skip(at)) {
      row = at.startPosition.row;
      continue;
    }
    if (!isDoc(at)) break;
    comments.unshift(at);
    row = at.startPosition.row;
  }
  return comments;
}

/**
 * The doc attached to a definition, first paragraph, at most 400 characters:
 * TypeScript's JSDoc block directly above, Python's leading string literal,
 * Go's comment lines directly above, Rust's `///` lines (attributes between are
 * skipped).
 */
export function docOf(language: LanguageId, node: Node): string | undefined {
  switch (language) {
    case "python": {
      const first = node.childForFieldName("body")?.namedChildren[0];
      const string = first?.type === "expression_statement" ? first.namedChildren[0] : undefined;
      if (string?.type !== "string") return undefined;
      const content = string.namedChildren.find((child) => child.type === "string_content");
      return content === undefined ? undefined : firstParagraph(content.text.split("\n"));
    }
    case "typescript":
    case "tsx": {
      const [block] = commentsAbove(
        statementOf(language, node),
        (comment) => comment.type === "comment" && comment.text.startsWith("/**"),
        () => false,
      ).slice(-1);
      if (block === undefined) return undefined;
      const lines = block.text
        .replace(/^\/\*\*/, "")
        .replace(/\*\/$/, "")
        .split("\n")
        .map((line) => line.replace(/^\s*\* ?/, ""));
      return firstParagraph(lines);
    }
    case "go": {
      const comments = commentsAbove(
        statementOf(language, node),
        (comment) => comment.type === "comment" && comment.text.startsWith("//"),
        () => false,
      );
      return firstParagraph(comments.map((comment) => comment.text.replace(/^\/\/ ?/, "")));
    }
    case "rust": {
      const comments = commentsAbove(
        node,
        (comment) => comment.type === "line_comment" && comment.text.startsWith("///"),
        (other) => other.type === "attribute_item",
      );
      return firstParagraph(comments.map((comment) => comment.text.replace(/^\/\/\/ ?/, "")));
    }
  }
}

/** A type name written in an annotation, with what it was reached through. */
export interface TypeName {
  readonly node: Node;
  readonly name: string;
  readonly qualifier: string | null;
}

const TYPE_NAME_NODES = new Set(["type_identifier", "identifier"]);

/** Every named type in an annotation: `Map<string, B>` names `Map` and `B`; `Lib.A` names `A` through `Lib`. */
function typeNames(language: LanguageId, annotation: Node): ReadonlyArray<TypeName> {
  const names: Array<TypeName> = [];
  const visit = (node: Node) => {
    switch (node.type) {
      case "nested_type_identifier": // TS `Lib.A`
      case "qualified_type": // Go `http.Request`
      case "scoped_type_identifier": {
        // Rust `fmt::Error`
        const name = node.childForFieldName("name");
        const qualifier = node.childForFieldName(
          node.type === "nested_type_identifier"
            ? "module"
            : node.type === "qualified_type"
              ? "package"
              : "path",
        );
        if (name !== null)
          names.push({ node: name, name: name.text, qualifier: qualifier?.text ?? null });
        return;
      }
      case "attribute": {
        // Python `mod.Model`
        const name = node.childForFieldName("attribute");
        const object = node.childForFieldName("object");
        if (name !== null)
          names.push({ node: name, name: name.text, qualifier: object?.text ?? null });
        return;
      }
      default:
        if (
          TYPE_NAME_NODES.has(node.type) &&
          // Python's annotations are expressions: any identifier names a type.
          (node.type === "type_identifier" || language === "python")
        ) {
          names.push({ node, name: node.text, qualifier: null });
          return;
        }
        for (const child of node.namedChildren) visit(child);
    }
  };
  visit(annotation);
  return names;
}

/**
 * The types a callable's parameters and its return are annotated with. A
 * TypeScript declarator's function value counts as the callable.
 */
export function signatureTypes(
  language: LanguageId,
  node: Node,
): { readonly accepts: ReadonlyArray<TypeName>; readonly returns: ReadonlyArray<TypeName> } {
  const callable = callableOf(node);
  if (callable === null) return { accepts: [], returns: [] };
  const accepts: Array<TypeName> = [];
  const parameters = callable.childForFieldName("parameters");
  for (const parameter of parameters?.namedChildren ?? []) {
    const type = parameter.childForFieldName("type");
    if (type !== null) accepts.push(...typeNames(language, type));
  }
  const result = callable.childForFieldName(language === "go" ? "result" : "return_type");
  return { accepts, returns: result === null ? [] : typeNames(language, result) };
}

/** An error type named where code throws or catches it. */
export interface FailureSite {
  readonly kind: "throws" | "catches";
  readonly node: Node;
  readonly name: string;
  readonly qualifier: string | null;
}

/** The type an error value names: `new X()`, `X(...)`, `X{}`, `&X{}`, `X::Variant`, `mod.X`. */
function errorType(node: Node | null | undefined): Omit<FailureSite, "kind"> | null {
  if (node === null || node === undefined) return null;
  switch (node.type) {
    case "new_expression":
      return errorType(node.childForFieldName("constructor"));
    case "call":
    case "call_expression":
      return errorType(node.childForFieldName("function"));
    case "unary_expression":
      return errorType(node.childForFieldName("operand"));
    case "composite_literal":
    case "struct_expression":
    case "struct_pattern":
      return errorType(node.childForFieldName(node.type === "composite_literal" ? "type" : "name"));
    case "tuple_struct_pattern":
      return errorType(node.childForFieldName("type"));
    case "member_expression":
    case "attribute": {
      const name = node.childForFieldName(node.type === "attribute" ? "attribute" : "property");
      const object = node.childForFieldName("object");
      return name === null
        ? null
        : { node: name, name: name.text, qualifier: object?.text ?? null };
    }
    case "scoped_identifier": {
      // Rust `MyError::Missing` is the `MyError` type; `MyError::new(…)` reaches here as its path too.
      const path = node.childForFieldName("path");
      const name = node.childForFieldName("name");
      if (path !== null && /^[A-Z]/.test(baseOf(path.text))) {
        const segments = path.text.split("::");
        return {
          node: path,
          name: segments.at(-1) ?? path.text,
          qualifier: segments.length > 1 ? segments.slice(0, -1).join("::") : null,
        };
      }
      return name !== null && /^[A-Z]/.test(name.text)
        ? { node: name, name: name.text, qualifier: path?.text ?? null }
        : null;
    }
    case "identifier":
    case "type_identifier":
    case "property_identifier":
      return /^[A-Z]/.test(node.text) ? { node, name: node.text, qualifier: null } : null;
    default:
      return null;
  }
}

const baseOf = (path: string) => path.split("::").at(-1) ?? path;

/**
 * Where the file throws and catches error types, syntactically: TypeScript
 * `throw new X`; Python `raise X(…)` and `except X` (tuples and `as` too); Rust
 * `Err(X…)` and `Err(X…)` match arms; Go `return …, X{…}` (or `&X{…}`) as the
 * last of several returned values (`errors.New` names no type). A TypeScript
 * `catch (e)` names no type, so it catches nothing here, and Go has no catch.
 */
export function failureSites(language: LanguageId, root: Node): ReadonlyArray<FailureSite> {
  const sites: Array<FailureSite> = [];
  const add = (kind: FailureSite["kind"], found: Omit<FailureSite, "kind"> | null) => {
    if (found !== null) sites.push({ kind, ...found });
  };
  const visit = (node: Node) => {
    switch (language) {
      case "typescript":
      case "tsx":
        if (node.type === "throw_statement") add("throws", errorType(node.namedChildren[0]));
        break;
      case "python":
        if (node.type === "raise_statement") add("throws", errorType(node.namedChildren[0]));
        if (node.type === "except_clause") {
          let value = node.childForFieldName("value");
          if (value?.type === "as_pattern") value = value.namedChildren[0] ?? null;
          const caught =
            value?.type === "tuple" ? value.namedChildren : value === null ? [] : [value];
          for (const type of caught) add("catches", errorType(type));
        }
        break;
      case "rust": {
        const isErr = (callee: Node | null) =>
          callee?.type === "identifier" && callee.text === "Err";
        if (node.type === "call_expression" && isErr(node.childForFieldName("function"))) {
          add("throws", errorType(node.childForFieldName("arguments")?.namedChildren[0]));
        }
        if (node.type === "tuple_struct_pattern" && isErr(node.childForFieldName("type"))) {
          add("catches", errorType(node.namedChildren[1]));
        }
        break;
      }
      case "go":
        if (node.type === "return_statement") {
          // `return value, X{…}`: the error is the last of two or more results.
          const values = node.namedChildren[0];
          const last =
            values?.type === "expression_list" && values.namedChildCount > 1
              ? values.namedChildren.at(-1)
              : undefined;
          if (last?.type === "composite_literal" || last?.type === "unary_expression") {
            add("throws", errorType(last));
          }
        }
        break;
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return sites;
}

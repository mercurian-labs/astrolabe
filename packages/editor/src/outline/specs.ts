import type { Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

export type OutlineKind =
  | "heading"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "function"
  | "method"
  | "namespace"
  | "variable"
  | "struct"
  | "trait"
  | "impl"
  | "module"
  | "constant"
  | "macro"
  | "rule"
  | "at-rule";

/** One entry of a file's outline: what it is, its name, and the text it spans. */
export interface OutlineItem {
  readonly kind: OutlineKind;
  readonly name: string;
  /** Where the item's text starts and ends; items nest by these. */
  readonly from: number;
  readonly to: number;
  /** Where the name starts: a jump lands there. */
  readonly nameFrom: number;
  /** How many items enclose it. */
  readonly depth: number;
}

type RawItem = Omit<OutlineItem, "depth">;

/**
 * How one language's syntax tree reads as an outline: every item in source order, and the items
 * enclosing a position, which breadcrumbs ask for on each cursor move and must stay cheap
 * (without `pathAt`, they are read from the cached outline).
 */
export interface OutlineSpec {
  readonly extract: (tree: Tree, doc: Text) => OutlineItem[];
  readonly pathAt?: (tree: Tree, doc: Text, pos: number) => OutlineItem[];
}

/** The items a node of one of `rules`' names makes: usually one, or none when it has no name. */
type Rule = (node: SyntaxNode, doc: Text) => RawItem | readonly RawItem[] | null;

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** An item named by its first child of one of `names`. */
function named(kind: OutlineKind, ...names: string[]): Rule {
  return (node, doc) => {
    const name = names.map((child) => node.getChild(child)).find((child) => child !== null);
    return name ? itemOf(kind, node, doc, name.from, name.to) : null;
  };
}

/** An item named by its text up to its first child named `body`, after `skip` leading children. */
function headed(kind: OutlineKind, body: string, skip: readonly string[] = []): Rule {
  return (node, doc) => {
    let start = node.firstChild;
    while (start && skip.includes(start.name)) start = start.nextSibling;
    const end = node.getChild(body);
    if (!start || !end || start.from >= end.from) return null;
    return itemOf(kind, node, doc, start.from, end.from);
  };
}

function itemOf(kind: OutlineKind, node: SyntaxNode, doc: Text, from: number, to: number) {
  const name = collapse(doc.sliceString(from, to));
  return name ? { kind, name, from: node.from, to: node.to, nameFrom: from } : null;
}

/**
 * A spec for a language whose items are syntax nodes that nest by containment: the full outline
 * walks the tree once, and the path at a position walks up from the node there.
 */
function nodeSpec(rules: Readonly<Record<string, Rule>>): OutlineSpec {
  const itemsOf = (node: SyntaxNode, doc: Text): readonly RawItem[] => {
    const made = rules[node.name]?.(node, doc) ?? null;
    return made === null ? [] : "kind" in made ? [made as RawItem] : (made as readonly RawItem[]);
  };
  return {
    extract(tree, doc) {
      const items: OutlineItem[] = [];
      const open: OutlineItem[] = [];
      tree.iterate({
        enter(ref) {
          if (!(ref.name in rules)) return;
          for (const raw of itemsOf(ref.node, doc)) {
            while (open.length > 0 && open[open.length - 1]!.to <= raw.from) open.pop();
            const item = { ...raw, depth: open.length };
            items.push(item);
            open.push(item);
          }
        },
      });
      return items;
    },
    pathAt(tree, doc, pos) {
      const path: RawItem[] = [];
      for (let node: SyntaxNode | null = tree.resolve(pos, 1); node; node = node.parent) {
        if (!(node.name in rules)) continue;
        for (const raw of itemsOf(node, doc)) {
          if (raw.from <= pos && pos < raw.to) path.unshift(raw);
        }
      }
      return path.map((raw, depth) => ({ ...raw, depth }));
    },
  };
}

// JavaScript and TypeScript (and their JSX).

const FUNCTION_VALUES = new Set(["ArrowFunction", "FunctionExpression"]);

const isFunctionValue = (node: SyntaxNode | null) => !!node && FUNCTION_VALUES.has(node.name);

/** An object literal's member that is a function: `run() {}` or `run: () => {}`. */
function isObjectMethod(property: SyntaxNode) {
  return property.getChild("ParamList") !== null || isFunctionValue(property.lastChild);
}

function hasObjectMethods(object: SyntaxNode) {
  return object.getChildren("Property").some(isObjectMethod);
}

/** A declaration at the top of a module or namespace, or exported, rather than inside code. */
function isModuleLevel(declaration: SyntaxNode) {
  const parent = declaration.parent;
  return (
    parent?.name === "Script" ||
    parent?.name === "ExportDeclaration" ||
    parent?.parent?.name === "NamespaceDeclaration"
  );
}

const unwrap = (node: SyntaxNode | null) =>
  node?.name === "ParenthesizedExpression" ? node.firstChild!.nextSibling : node;

const isGenerator = (node: SyntaxNode) =>
  node.name === "FunctionExpression" && node.getChild("Star") !== null;

/**
 * The function a value runs: itself, or one a call wraps as its callee, a generator argument, a
 * curried call's first function (`Effect.fn("x")(…)`), or a block-bodied final argument (not
 * `map((x) => x.id)`), looking through a final-argument call and `.pipe(…)` chains.
 */
function functionOf(value: SyntaxNode | null): SyntaxNode | null {
  if (isFunctionValue(value)) return value;
  if (value?.name !== "CallExpression") return null;
  const callee = unwrap(value.firstChild);
  if (isFunctionValue(callee)) return callee;
  let first: SyntaxNode | null = null;
  let last: SyntaxNode | null = null;
  for (let arg = value.getChild("ArgList")?.firstChild ?? null; arg; arg = arg.nextSibling) {
    if (isGenerator(arg)) return arg;
    if (!first && isFunctionValue(arg)) first = arg;
    if (arg.name !== "(" && arg.name !== ")" && arg.name !== ",") last = arg;
  }
  if (first && callee?.name === "CallExpression") return first;
  if (last && isFunctionValue(last) && last.lastChild?.name === "Block") return last;
  const inner = last?.name === "CallExpression" ? functionOf(last) : null;
  if (inner) return inner;
  return callee?.name === "MemberExpression" ? functionOf(callee.firstChild) : null;
}

const WRAPPERS = new Set([
  "ArgList",
  "CallExpression",
  "MemberExpression",
  "ParenthesizedExpression",
]);

/**
 * Whether `fn` is the body of an outline item's function: the one a listed declarator's value
 * runs, or the one such a function's arrow returns (`(r) => Layer.effect(Effect.gen(…))`).
 */
function isItemBody(fn: SyntaxNode): boolean {
  let value = fn;
  while (value.parent && WRAPPERS.has(value.parent.name)) value = value.parent;
  const holder = value.parent;
  if (!holder || functionOf(value)?.from !== fn.from) return false;
  if (holder.name === "VariableDeclaration") {
    return value.prevSibling?.name === "Equals" && isOutlineLevel(holder);
  }
  return (
    holder.name === "ArrowFunction" && holder.lastChild?.from === value.from && isItemBody(holder)
  );
}

/**
 * Where a `const` or `let` is an outline item: at the top of a module or namespace, or in the
 * body of a function another such declaration holds, so a service's functions list under it.
 */
function isOutlineLevel(declaration: SyntaxNode): boolean {
  if (isModuleLevel(declaration)) return true;
  const block = declaration.parent;
  const fn = block?.name === "Block" ? block.parent : null;
  return !!fn && isFunctionValue(fn) && isItemBody(fn);
}

/**
 * A `const` or `let` holding a function or class, or an object with methods, where it is an
 * outline item (`isOutlineLevel`): one item per such declarator (`const a = () => {}, b = 1`
 * lists only `a`).
 */
const variableDeclaration: Rule = (node, doc) => {
  if (!isOutlineLevel(node)) return null;
  const items: RawItem[] = [];
  for (const name of node.getChildren("VariableDefinition")) {
    const value = name.nextSibling?.name === "Equals" ? name.nextSibling.nextSibling : null;
    if (!value) continue;
    const kind: OutlineKind | null = functionOf(value)
      ? "function"
      : value.name === "ClassExpression"
        ? "class"
        : value.name === "ObjectExpression" && hasObjectMethods(value)
          ? "variable"
          : null;
    const label = doc.sliceString(name.from, name.to);
    if (kind && label) {
      items.push({ kind, name: label, from: name.from, to: value.to, nameFrom: name.from });
    }
  }
  return items;
};

const JAVASCRIPT = nodeSpec({
  ClassDeclaration: named("class", "VariableDefinition"),
  InterfaceDeclaration: named("interface", "TypeDefinition"),
  TypeAliasDeclaration: named("type", "TypeDefinition"),
  EnumDeclaration: named("enum", "TypeDefinition"),
  NamespaceDeclaration: named("namespace", "VariableDefinition"),
  FunctionDeclaration: (node, doc) => {
    const name = node.getChild("VariableDefinition");
    if (name) return itemOf("function", node, doc, name.from, name.to);
    // `export default function () {}`
    const keyword = node.getChild("function");
    return node.parent?.getChild("default") && keyword
      ? { kind: "function", name: "default", from: node.from, to: node.to, nameFrom: keyword.from }
      : null;
  },
  MethodDeclaration: named("method", "PropertyDefinition", "PrivatePropertyDefinition"),
  MethodType: named("method", "PropertyDefinition"),
  PropertyDeclaration: (node, doc) => {
    const name = node.getChild("PropertyDefinition") ?? node.getChild("PrivatePropertyDefinition");
    const value = node.getChild("Equals")?.nextSibling ?? null;
    return name && isFunctionValue(value) ? itemOf("method", node, doc, name.from, name.to) : null;
  },
  VariableDeclaration: variableDeclaration,
  // A method of an object literal that a module-level declaration holds.
  Property: (node, doc) => {
    const object = node.parent;
    const declaration = object?.parent;
    if (object?.name !== "ObjectExpression" || declaration?.name !== "VariableDeclaration") {
      return null;
    }
    if (!isModuleLevel(declaration) || !isObjectMethod(node)) return null;
    const name = node.getChild("PropertyDefinition");
    return name ? itemOf("method", node, doc, name.from, name.to) : null;
  },
});

// Python.

const PYTHON = nodeSpec({
  ClassDefinition: named("class", "VariableName"),
  FunctionDefinition: (node, doc) => {
    const name = node.getChild("VariableName");
    if (!name) return null;
    // A method sits in a class's body, perhaps under decorators.
    let owner = node.parent;
    if (owner?.name === "DecoratedStatement") owner = owner.parent;
    const kind = owner?.parent?.name === "ClassDefinition" ? "method" : "function";
    return itemOf(kind, node, doc, name.from, name.to);
  },
});

// Rust.

const rustFunction: Rule = (node, doc) => {
  const name = node.getChild("BoundIdentifier");
  if (!name) return null;
  const owner = node.parent?.parent?.name;
  const kind = owner === "ImplItem" || owner === "TraitItem" ? "method" : "function";
  return itemOf(kind, node, doc, name.from, name.to);
};

const RUST = nodeSpec({
  StructItem: named("struct", "TypeIdentifier"),
  UnionItem: named("struct", "TypeIdentifier"),
  EnumItem: named("enum", "TypeIdentifier"),
  TraitItem: named("trait", "TypeIdentifier"),
  TypeItem: named("type", "TypeIdentifier"),
  ModItem: named("module", "BoundIdentifier"),
  ConstItem: named("constant", "BoundIdentifier"),
  StaticItem: named("constant", "BoundIdentifier"),
  MacroDefinition: named("macro", "Identifier"),
  FunctionItem: rustFunction,
  // `impl<T> Display for Job<T>` reads `Display for Job<T>`.
  ImplItem: headed("impl", "DeclarationList", ["impl", "TypeParamList"]),
});

// CSS.

const CSS = nodeSpec({
  RuleSet: headed("rule", "Block"),
  MediaStatement: headed("at-rule", "Block"),
  SupportsStatement: headed("at-rule", "Block"),
  KeyframesStatement: headed("at-rule", "KeyframeList"),
});

// Markdown.

const HEADING = /^(?:ATXHeading|SetextHeading)([1-6])$/;

/**
 * Headings at the top of the note (not in quotes or lists), nesting by level: a heading's section
 * runs to the next heading of its level or above, or the end of the note.
 */
function markdownOutline(tree: Tree, doc: Text): OutlineItem[] {
  const outline: { -readonly [K in keyof OutlineItem]: OutlineItem[K] }[] = [];
  // The headings whose sections are still open, outermost first.
  const open: { level: number; index: number }[] = [];
  for (let block = tree.topNode.firstChild; block; block = block.nextSibling) {
    const level = Number(HEADING.exec(block.name)?.[1] ?? 0);
    if (!level) continue;
    const line = doc.lineAt(block.from);
    const atx = block.name.startsWith("ATX");
    const lead = (atx ? /^\s*#{1,6}\s*/ : /^\s*/).exec(line.text)?.[0].length ?? 0;
    const name = collapse((atx ? line.text.replace(/\s#+\s*$/, "") : line.text).slice(lead));
    if (!name) continue;
    while (open.length > 0 && open[open.length - 1]!.level >= level) {
      outline[open.pop()!.index]!.to = block.from;
    }
    const item = { kind: "heading" as const, name, from: block.from, to: doc.length };
    outline.push({ ...item, nameFrom: line.from + lead, depth: open.length });
    open.push({ level, index: outline.length - 1 });
  }
  return outline;
}

const MARKDOWN: OutlineSpec = { extract: markdownOutline };

/** The outline specs by CodeMirror language name. */
export const OUTLINE_SPECS: Readonly<Record<string, OutlineSpec>> = {
  markdown: MARKDOWN,
  javascript: JAVASCRIPT,
  typescript: JAVASCRIPT,
  jsx: JAVASCRIPT,
  tsx: JAVASCRIPT,
  python: PYTHON,
  rust: RUST,
  css: CSS,
};

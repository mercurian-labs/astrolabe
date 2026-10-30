import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vite-plus/test";

import { codeLanguageFor } from "../code/code.ts";
import { livePreview } from "../markdown/livePreview.ts";
import {
  deepestItemAt,
  documentOutline,
  hasOutline,
  outline,
  outlinePath,
  revealOutlineItem,
  type OutlineItem,
} from "./outline.ts";

/** A state of `file`'s language, its text with `|` marking the cursor. */
async function stateOf(file: string, text: string, extensions: Extension = []) {
  const support = file.endsWith(".md") ? livePreview() : await codeLanguageFor(file)!.load();
  const cursor = text.indexOf("|");
  return EditorState.create({
    doc: text.replace("|", ""),
    selection: { anchor: Math.max(0, cursor) },
    extensions: [support, extensions],
  });
}

/** Each item as `kind name`, indented two spaces per depth. */
const tree = (items: readonly OutlineItem[]) =>
  items.map((item) => `${"  ".repeat(item.depth)}${item.kind} ${item.name}`);

const names = (items: readonly OutlineItem[]) => items.map((item) => item.name);

describe("a Markdown outline", () => {
  const note = [
    "---",
    "title: Note",
    "---",
    "# Guide ##",
    "Intro.",
    "## Install",
    "> # Not a section",
    "```",
    "# not a heading",
    "```",
    "### From source",
    "## Use",
    "Setext title",
    "============",
    "- # in a list",
    "#",
  ].join("\n");

  it("nests headings by level, without their marks, and skips quotes, lists and code", async () => {
    const state = await stateOf("note.md", note);
    const { items, complete } = documentOutline(state);
    expect(complete).toBe(true);
    expect(tree(items)).toEqual([
      "heading Guide",
      "  heading Install",
      "    heading From source",
      "  heading Use",
      "heading Setext title",
    ]);
    const install = items[1]!;
    expect(state.sliceDoc(install.nameFrom, install.nameFrom + 7)).toBe("Install");
  });

  it("puts a cursor in the sections around it, a heading's line start in that heading", async () => {
    const at = (text: string) => outlinePath(state, state.doc.toString().indexOf(text));
    const state = await stateOf("note.md", note);
    expect(names(at("Intro"))).toEqual(["Guide"]);
    expect(names(at("not a heading"))).toEqual(["Guide", "Install"]);
    expect(names(at("### From"))).toEqual(["Guide", "Install", "From source"]);
    expect(names(at("## Use"))).toEqual(["Guide", "Use"]);
    expect(names(outlinePath(state, state.doc.length))).toEqual(["Setext title"]);
    expect(names(outlinePath(state, 0))).toEqual([]);
  });
});

describe("a TypeScript outline", () => {
  const source = `import x from "y";
export class Store<T> extends Base {
  private size = 1;
  static make(): Store<never> { return new Store(); }
  #reset() {}
  onChange = () => {};
  onClose = async () => {};
}
interface Shape { area(): number; name: string }
export type Id = string;
enum Color { Red }
export default function () {}
function outer() {
  const local = () => {};
  function inner() {}
}
const add = (a: number, b: number) => a + b, limit = 3, sub = function () {};
export const Klass = class {};
export const api = { get() {}, post: async () => {}, base: "/" };
const config = { port: 1 };
let count = 0;
namespace Tools { export const run = () => {}; }
`;

  it("lists declarations, methods, and module-level consts holding functions or classes", async () => {
    const { items } = documentOutline(await stateOf("a.ts", source));
    expect(tree(items)).toEqual([
      "class Store",
      "  method make",
      "  method #reset",
      "  method onChange",
      "  method onClose",
      "interface Shape",
      "  method area",
      "type Id",
      "enum Color",
      "function default",
      "function outer",
      "  function inner",
      "function add",
      "function sub",
      "class Klass",
      "variable api",
      "  method get",
      "  method post",
      "namespace Tools",
      "  function run",
    ]);
  });

  it("reads JavaScript and JSX the same way", async () => {
    const jsx = `export function App() { return <div />; }\nconst Button = () => <b />;\n`;
    expect(names(documentOutline(await stateOf("a.jsx", jsx)).items)).toEqual(["App", "Button"]);
    expect(names(documentOutline(await stateOf("a.tsx", jsx)).items)).toEqual(["App", "Button"]);
  });

  it("finds the path at the cursor by walking up from it", async () => {
    const state = await stateOf(
      "a.ts",
      "class A {\n  run() {\n    const x = |1;\n  }\n}\nconst f = () => 1;",
    );
    expect(tree(outlinePath(state))).toEqual(["class A", "  method run"]);
    const at = (text: string) => outlinePath(state, state.doc.toString().indexOf(text));
    expect(names(at("run"))).toEqual(["A", "run"]);
    expect(names(at("() => 1"))).toEqual(["f"]);
    expect(names(outlinePath(state, state.doc.length))).toEqual([]);
  });

  it("starts the picker on the deepest item around the cursor", async () => {
    const state = await stateOf(
      "a.ts",
      "class A {\n  run() {}\n  stop() { | }\n}\nfunction b() {}",
    );
    const { items } = documentOutline(state);
    expect(deepestItemAt(items, state.selection.main.head)?.name).toBe("stop");
    expect(deepestItemAt(items, state.doc.length)).toBeNull();
  });

  it("lists consts whose call wraps a function body, and the function consts inside", async () => {
    const service = `const make = Effect.fn("make")(function* () {
  const sql = yield* SqlClient;
  const run = Effect.fn("run")(function* (id: string) {
    const step = (n: number) => n + 1;
    const total = 1;
  });
  const traced = Effect.fn("traced")(function* () {}, Effect.orDie);
  const layer = Layer.effect(Tag, make);
  const memo = useMemo(() => 1, []);
  const ids = items.map((item) => item.id);
  const iife = (() => 2)();
  const resume = Effect.gen(function* () {
    const again = () => {};
  }).pipe(Effect.orDie);
  return { run };
});
export const layer = Layer.effect(Tag, make);
const decode = Schema.decodeUnknownEffect(Body);
export const handler = toHandler((input) => {
  const reply = async () => {};
});
const enrich = Effect.fn("enrich")((ids: string[]) => Effect.succeed(ids));
const layerRpc = (session: Session) =>
  Layer.effect(
    Effect.gen(function* () {
      const handle = Effect.fn("handle")(function* () {});
    }),
  );
`;
    const state = await stateOf("a.ts", service);
    expect(tree(documentOutline(state).items)).toEqual([
      "function make",
      "  function run",
      "    function step",
      "  function traced",
      "  function iife",
      "  function resume",
      "    function again",
      "function handler",
      "  function reply",
      "function enrich",
      "function layerRpc",
      "  function handle",
    ]);
    const at = (text: string) => outlinePath(state, service.indexOf(text));
    expect(names(at("n + 1"))).toEqual(["make", "run", "step"]);
    expect(names(at("total"))).toEqual(["make", "run"]);
  });

  it("reads a large file as far as the parser has gone, and all of it given time", async () => {
    const big = Array.from({ length: 4000 }, (_, index) => `function f${index}() {}`).join("\n");
    const state = await stateOf("a.ts", big);
    const partial = documentOutline(state, 0);
    expect(partial.complete).toBe(false);
    expect(partial.items.length).toBeGreaterThan(0);
    expect(partial.items.length).toBeLessThan(4000);
    const full = documentOutline(state, 10_000);
    expect(full).toMatchObject({ complete: true });
    expect(full.items.at(-1)?.name).toBe("f3999");
  });

  it("reads each syntax tree once", async () => {
    const state = await stateOf("a.ts", source);
    const first = documentOutline(state).items;
    expect(documentOutline(state).items).toBe(first);
    const moved = state.update({ selection: { anchor: 10 } }).state;
    expect(documentOutline(moved).items).toBe(first);
  });
});

describe("other languages", () => {
  it("Python: classes, methods (decorated too), and functions", async () => {
    const source = `class Foo(Base):\n    x = 1\n    def method(self):\n        def inner():\n            pass\n    @property\n    async def size(self): return 1\ndef top(): pass\n`;
    expect(tree(documentOutline(await stateOf("a.py", source)).items)).toEqual([
      "class Foo",
      "  method method",
      "    function inner",
      "  method size",
      "function top",
    ]);
  });

  it("Rust: items, impls by what they implement, and their methods", async () => {
    const source = `pub struct Job { id: u32 }\nenum Color { Red }\ntrait Run { fn run(&self); }\nimpl<T> Run for Job<T> {\n    fn run(&self) {}\n}\nmod inner { pub fn f() {} }\npub const MAX: u32 = 1;\ntype Alias = u32;\nmacro_rules! m { () => {} }\nfn main() {}\n`;
    expect(tree(documentOutline(await stateOf("a.rs", source)).items)).toEqual([
      "struct Job",
      "enum Color",
      "trait Run",
      "  method run",
      "impl Run for Job<T>",
      "  method run",
      "module inner",
      "  function f",
      "constant MAX",
      "type Alias",
      "macro m",
      "function main",
    ]);
  });

  it("CSS: rules by their selectors, inside their at-rules", async () => {
    const source = `.a,\n  .b > c { color: red }\n@media (max-width: 10px) { .x { color: blue } }\n`;
    expect(tree(documentOutline(await stateOf("a.css", source)).items)).toEqual([
      "rule .a, .b > c",
      "at-rule @media (max-width: 10px)",
      "  rule .x",
    ]);
  });

  it("has nothing for a language without a spec", async () => {
    const state = await stateOf("a.json", `{ "a": 1 }`);
    expect(documentOutline(state)).toEqual({ items: [], complete: true });
    expect(outlinePath(state)).toEqual([]);
  });
});

describe("the outline extension", () => {
  async function viewOf(file: string, text: string, onPath?: (path: string[]) => void) {
    const state = await stateOf(
      file,
      text,
      outline(onPath ? { onPath: (path) => onPath(names(path)) } : {}),
    );
    const view = new EditorView({ state, parent: document.body });
    return Object.assign(view, { [Symbol.dispose]: () => view.destroy() });
  }

  it("marks the editor", async () => {
    using view = await viewOf("a.ts", "const a = 1;");
    expect(hasOutline(view.state)).toBe(true);
    expect(view.dom.hasAttribute("data-outline")).toBe(true);
    expect(hasOutline(EditorState.create())).toBe(false);
  });

  it("reports the path when its names change, not on every keystroke or move", async () => {
    const paths: string[][] = [];
    using view = await viewOf("a.ts", "class A {\n  run() {\n    |\n  }\n  stop() {}\n}", (path) =>
      paths.push(path),
    );
    expect(paths).toEqual([["A", "run"]]);
    const cursor = view.state.selection.main.head;
    view.dispatch({ changes: { from: cursor, insert: "let x = 1;" } });
    view.dispatch({ selection: { anchor: cursor + 2 } });
    expect(paths).toHaveLength(1);

    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("stop") } });
    expect(paths.at(-1)).toEqual(["A", "stop"]);
    const name = view.state.doc.toString().indexOf("stop");
    view.dispatch({ changes: { from: name, to: name + 4, insert: "halt" } });
    expect(paths.at(-1)).toEqual(["A", "halt"]);
    expect(paths).toHaveLength(3);
  });

  it("jumps to an item's name", async () => {
    using view = await viewOf("a.ts", "|\n\nclass A {\n  run() {}\n}");
    const run = documentOutline(view.state).items[1]!;
    revealOutlineItem(view, run);
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("run"));
  });
});

import { describe, expect, it } from "vite-plus/test";

import type { CodeEdge, EdgeKind } from "../model/code.ts";
import { extractFile } from "../parse/extract.ts";
import { languageOf } from "../parse/languages.ts";
import { GO_SNIPPET, PY_SNIPPET, RS_SNIPPET, TS_SNIPPET } from "../testing/snippets.ts";
import { CodeIndexer } from "./indexer.ts";

async function indexOf(files: Readonly<Record<string, string>>, paths: ReadonlyArray<string> = []) {
  const indexer = new CodeIndexer(paths);
  for (const [path, text] of Object.entries(files)) {
    const language = languageOf(path);
    if (language === null) throw new Error(path);
    indexer.put(await extractFile(path, language, text));
  }
  indexer.resolve(indexer.facts.keys());
  return indexer.snapshot("test", "test");
}

/** A symbol's use links, as `kind target (resolution)`. */
const linksFrom = (
  edges: ReadonlyArray<CodeEdge>,
  from: string,
  kinds: ReadonlyArray<EdgeKind> = ["calls", "instantiates"],
) =>
  edges
    .filter((edge) => edge.from === from && kinds.includes(edge.kind))
    .map((edge) => `${edge.kind} ${edge.to} (${edge.resolution})`)
    .toSorted();

describe("resolution", () => {
  it("labels a link exact through an import, a heuristic across files, and marks the unknown", async () => {
    const index = await indexOf({
      "src/util.ts": "export function helper() {}\n",
      "src/other.ts": "export function helper() {}\n",
      "src/a.ts": "export function render() {}\n",
      "src/b.ts": "export function render() {}\n",
      "src/only.ts": "export function single() {}\n",
      "src/app.ts": `import { helper } from "./util.ts";
export function main() {
  helper();
  render();
  single();
  missing();
}
`,
    });
    expect(linksFrom(index.edges, "src/app.ts#function:main")).toEqual([
      "calls frontier:missing (heuristic)",
      "calls src/a.ts#function:render (heuristic)",
      "calls src/b.ts#function:render (heuristic)",
      "calls src/only.ts#function:single (exact)",
      "calls src/util.ts#function:helper (exact)",
    ]);
    expect(index.frontier).toEqual([{ id: "frontier:missing", name: "missing", frontier: true }]);
    expect(index.edges).toContainEqual({
      from: "src/app.ts#file:app.ts",
      to: "src/util.ts#file:util.ts",
      kind: "imports",
      resolution: "exact",
    });
  });

  it("labels several candidates in one file an overload", async () => {
    const index = await indexOf({
      "src/shapes.ts": "class A {\n  area() {}\n}\nclass B {\n  area() {}\n}\n",
      "src/app.ts": "export function main(shape) {\n  shape.area();\n}\n",
    });
    expect(linksFrom(index.edges, "src/app.ts#function:main")).toEqual([
      "calls src/shapes.ts#method:A.area (overload)",
      "calls src/shapes.ts#method:B.area (overload)",
    ]);
  });

  it("tells constructing a class from calling a function, in each language", async () => {
    const index = await indexOf({
      "pkg/coder.py":
        "class Coder:\n    pass\n\ndef make():\n    pass\n\ndef main():\n    Coder()\n    make()\n",
      "src/app.ts":
        "class Widget {}\nfunction make() {}\nexport function main() {\n  new Widget();\n  make();\n}\n",
      "src/circle.rs":
        "struct Circle;\nimpl Circle {\n    fn new() -> Self { Circle }\n}\nfn main() {\n    Circle::new();\n}\n",
    });
    expect(linksFrom(index.edges, "pkg/coder.py#function:main")).toEqual([
      "calls pkg/coder.py#function:make (exact)",
      "instantiates pkg/coder.py#class:Coder (exact)",
    ]);
    expect(linksFrom(index.edges, "src/app.ts#function:main")).toEqual([
      "calls src/app.ts#function:make (exact)",
      "instantiates src/app.ts#class:Widget (exact)",
    ]);
    expect(linksFrom(index.edges, "src/circle.rs#function:main")).toEqual([
      "instantiates src/circle.rs#class:Circle (exact)",
    ]);
  });

  it("derives overrides from inheritance and implementation, with the base link's resolution", async () => {
    const index = await indexOf({
      "src/shape.ts": "export interface Shape {\n  area(): number;\n  name(): string;\n}\n",
      "src/base.ts": "export class Base {\n  draw() {}\n}\n",
      "src/square.ts": `import type { Shape } from "./shape.ts";
import { Base } from "./base.ts";
export class Square extends Base implements Shape {
  area() { return 1; }
  draw() {}
  extra() {}
}
`,
      "pkg/a.py": "class Base:\n    def run(self):\n        pass\n",
      "pkg/b.py": "class Base:\n    def run(self):\n        pass\n",
      "pkg/c.py": "class Child(Base):\n    def run(self):\n        pass\n",
    });
    const overrides = (from: string) => linksFrom(index.edges, from, ["overrides"]);
    expect(overrides("src/square.ts#method:Square.area")).toEqual([
      "overrides src/shape.ts#method:Shape.area (exact)",
    ]);
    expect(overrides("src/square.ts#method:Square.draw")).toEqual([
      "overrides src/base.ts#method:Base.draw (exact)",
    ]);
    expect(overrides("src/square.ts#method:Square.extra")).toEqual([]);
    // `Base` is two classes by name alone, so each override is a guess too.
    expect(overrides("pkg/c.py#method:Child.run")).toEqual([
      "overrides pkg/a.py#method:Base.run (heuristic)",
      "overrides pkg/b.py#method:Base.run (heuristic)",
    ]);
  });

  it("links each file to what it exports", async () => {
    const index = await indexOf({ "src/shapes.ts": TS_SNIPPET });
    expect(
      index.edges
        .filter((edge) => edge.kind === "exports")
        .map((edge) => `${edge.from} -> ${edge.to} (${edge.resolution})`),
    ).toEqual(
      [
        "src/shapes.ts#class:Base",
        "src/shapes.ts#class:Square",
        "src/shapes.ts#constant:SIDES",
        "src/shapes.ts#function:build",
        "src/shapes.ts#interface:Shape",
      ].map((to) => `src/shapes.ts#file:shapes.ts -> ${to} (exact)`),
    );
  });

  it("links a function passed as a value as a reference, never a frontier", async () => {
    const index = await indexOf({
      "src/app.ts": `function render() {}
export function main(items: Array<number>) {
  items.map(render);
  items.map(unknownValue);
}
`,
    });
    expect(linksFrom(index.edges, "src/app.ts#function:main", ["references"])).toEqual([
      "references src/app.ts#function:render (exact)",
    ]);
    expect(index.frontier).toEqual([]);
  });

  it("follows a namespace import to the module and an aliased name to its original", async () => {
    const index = await indexOf({
      "src/lib.ts": "export function run() {}\nexport function start() {}\n",
      "src/elsewhere.ts": "export function run() {}\nexport function begin() {}\n",
      "src/app.ts": `import * as Lib from "./lib.ts";
import { begin as go } from "./elsewhere.ts";
export function main() {
  Lib.run();
  go();
}
`,
    });
    expect(linksFrom(index.edges, "src/app.ts#function:main")).toEqual([
      "calls src/elsewhere.ts#function:begin (exact)",
      "calls src/lib.ts#function:run (exact)",
    ]);
  });

  it("records a name imported from outside the index as external: no edge, no frontier", async () => {
    const index = await indexOf({
      "src/local.ts": "export function gen() {}\nexport function pipe() {}\n",
      "src/app.ts": `import { Effect, pipe } from "effect";
export const main = () => pipe(Effect.gen());
`,
    });
    expect(linksFrom(index.edges, "src/app.ts#function:main")).toEqual([]);
    expect(index.frontier).toEqual([]);
    expect(index.externals).toEqual([
      { from: "src/app.ts#function:main", name: "gen", source: "effect" },
      { from: "src/app.ts#function:main", name: "pipe", source: "effect" },
    ]);
  });

  it("makes a frontier only of a bare, unbound name nothing defines and no global carries", async () => {
    const index = await indexOf({
      "src/app.ts": `export function main(items: Array<number>, callback: () => void) {
  const [, setValue] = [0, (next: number) => next];
  setValue(1);
  callback();
  const seen = new Map();
  Math.max(1, 2);
  items.map(String);
  this.unknown();
  for (const undo of []) undo();
  notWrittenYet();
  return new Missing();
}
`,
    });
    expect(index.frontier.map((symbol) => symbol.name)).toEqual(["Missing", "notWrittenYet"]);
    expect(linksFrom(index.edges, "src/app.ts#function:main")).toEqual([
      "calls frontier:notWrittenYet (heuristic)",
      "instantiates frontier:Missing (heuristic)",
    ]);
  });

  it("never makes a frontier of a language's builtins", async () => {
    const index = await indexOf({
      "pkg/app.py": "def main():\n    print(len(sorted([])))\n    raise ConnectionResetError()\n",
      "cmd/main.go": 'package main\n\nfunc main() {\n\t_ = append(make([]int, 0), len("x"))\n}\n',
      "src/main.rs": 'fn main() {\n    println!("{}", Some(1).is_some());\n}\n',
      "src/map.ts": "export class OverlayMap<K, V> implements ReadonlyMap<K, V> {}\n",
    });
    expect(index.frontier).toEqual([]);
  });

  it("follows a default import to what the module exports as default, not to its local name", async () => {
    const index = await indexOf({
      "src/lib.ts": "export default function actual() {}\n",
      "src/other.ts": "export function run() {}\n",
      "src/widget.ts": "class Widget {}\nexport default Widget;\n",
      "src/app.ts": `import run from "./lib";
import Thing from "./widget.ts";
export function main() {
  run();
  new Thing();
}
`,
    });
    expect(linksFrom(index.edges, "src/app.ts#function:main")).toEqual([
      "calls src/lib.ts#function:actual (exact)",
      "instantiates src/widget.ts#class:Widget (exact)",
    ]);
  });

  it("resolves namespaced constructors on the class name, inside the index or out", async () => {
    const index = await indexOf({
      "src/lib.ts": "export class Widget {}\n",
      "src/app.ts": `import * as Lib from "./lib.ts";
import * as THREE from "three";
export function main() {
  new Lib.Widget();
  new THREE.Scene();
}
`,
    });
    expect(linksFrom(index.edges, "src/app.ts#function:main")).toEqual([
      "instantiates src/lib.ts#class:Widget (exact)",
    ]);
    expect(index.frontier).toEqual([]);
    expect(index.externals).toEqual([
      { from: "src/app.ts#function:main", name: "Scene", source: "three" },
    ]);
  });

  it("resolves Python and Rust aliases on the original name", async () => {
    const index = await indexOf({
      "pkg/io.py": "class InputOutput:\n    pass\n",
      "pkg/util.py": "def helper():\n    pass\n",
      "pkg/main.py":
        "from .io import InputOutput as IO\nimport pkg.util as u\n\ndef main():\n    IO()\n    u.helper()\n",
      "src/shapes.rs": "pub fn area() {}\n",
      "src/main.rs": "use crate::shapes::area as surface;\nfn main() {\n    surface();\n}\n",
    });
    expect(linksFrom(index.edges, "pkg/main.py#function:main")).toEqual([
      "calls pkg/util.py#function:helper (exact)",
      "instantiates pkg/io.py#class:InputOutput (exact)",
    ]);
    expect(linksFrom(index.edges, "src/main.rs#function:main")).toEqual([
      "calls src/shapes.rs#function:area (exact)",
    ]);
  });

  it("follows Go package imports by directory", async () => {
    const index = await indexOf({
      "store/store.go": "package store\n\nfunc Open() {}\n",
      "cache/cache.go": "package cache\n\nfunc Open() {}\n",
      "server/server.go": `package server

import st "example.com/app/store"

func Start() {
	st.Open()
}
`,
    });
    expect(linksFrom(index.edges, "server/server.go#function:Start")).toEqual([
      "calls store/store.go#function:Open (exact)",
    ]);
  });

  it("follows Rust use paths from the crate root", async () => {
    const index = await indexOf({
      "src/shapes.rs": "pub trait Shape {}\n",
      "src/other.rs": "pub trait Shape {}\n",
      "src/circle.rs": "use crate::shapes::Shape;\npub struct Circle;\nimpl Shape for Circle {}\n",
    });
    expect(linksFrom(index.edges, "src/circle.rs#class:Circle", ["implements"])).toEqual([
      "implements src/shapes.rs#interface:Shape (exact)",
    ]);
  });
});

describe("contract and failure links", () => {
  it("resolves accepts and returns like references, never to a builtin", async () => {
    const index = await indexOf({
      "src/model.ts": "export interface Model {}\nexport class Cache {}\n",
      "src/a/opts.ts": "export interface Options {}\n",
      "src/b/opts.ts": "export interface Options {}\n",
      "src/app.ts": `import type { Model } from "./model.ts";
export function load(options: Options, name: string): Promise<Model> {
  const cache: Cache = new Cache();
  return Promise.resolve({} as Model);
}
`,
    });
    const from = "src/app.ts#function:load";
    expect(linksFrom(index.edges, from, ["accepts", "returns", "references"])).toEqual([
      "accepts src/a/opts.ts#interface:Options (heuristic)",
      "accepts src/b/opts.ts#interface:Options (heuristic)",
      // A type used in the body stays a reference.
      "references src/model.ts#class:Cache (exact)",
      "returns src/model.ts#interface:Model (exact)",
    ]);
  });

  it("resolves throws and catches to error types, never to a builtin or a frontier", async () => {
    const index = await indexOf({
      "pkg/errors.py":
        "class ConfigError(Exception):\n    pass\n\nclass Timeout(Exception):\n    pass\n",
      "pkg/run.py": `from .errors import ConfigError, Timeout

def run():
    try:
        raise ConfigError("bad")
    except Timeout:
        pass
    except ValueError:
        pass
    raise Unknown()
`,
    });
    expect(linksFrom(index.edges, "pkg/run.py#function:run", ["throws", "catches"])).toEqual([
      "catches pkg/errors.py#class:Timeout (exact)",
      "throws pkg/errors.py#class:ConfigError (exact)",
    ]);
    expect(index.frontier.map((symbol) => symbol.name)).toEqual(["Unknown"]);
    expect(
      index.edges.some((edge) => edge.kind === "throws" && edge.to.startsWith("frontier:")),
    ).toBe(false);
  });
});

describe("containment", () => {
  /** A symbol's chain of parents up to its root folder. */
  const chainOf = (index: Awaited<ReturnType<typeof indexOf>>, id: string) => {
    const byId = new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
    const chain: Array<string> = [];
    for (
      let at = byId.get(id);
      at !== undefined;
      at = at.parent === undefined ? undefined : byId.get(at.parent)
    ) {
      chain.push(`${at.kind}:${at.name}`);
    }
    return chain;
  };

  it("hangs method → class → file → folder → root folder in each language", async () => {
    const index = await indexOf(
      {
        "app/src/shapes.ts": TS_SNIPPET,
        "app/pkg/coder.py": PY_SNIPPET,
        "app/server/server.go": GO_SNIPPET,
        "app/src/circle.rs": RS_SNIPPET,
      },
      ["app"],
    );
    expect(chainOf(index, "app/src/shapes.ts#method:Square.area")).toEqual([
      "method:area",
      "class:Square",
      "file:shapes.ts",
      "folder:src",
      "folder:app",
    ]);
    expect(chainOf(index, "app/pkg/coder.py#method:Coder.run")).toEqual([
      "method:run",
      "class:Coder",
      "file:coder.py",
      "folder:pkg",
      "folder:app",
    ]);
    // A Go folder holding Go files is a package.
    expect(chainOf(index, "app/server/server.go#method:Server.Serve")).toEqual([
      "method:Serve",
      "class:Server",
      "file:server.go",
      "package:server",
      "folder:app",
    ]);
    expect(chainOf(index, "app/src/circle.rs#method:Circle.area")).toEqual([
      "method:area",
      "class:Circle",
      "file:circle.rs",
      "folder:src",
      "folder:app",
    ]);
    // No folder above the root, and no containment among the links.
    expect(
      index.symbols
        .filter((symbol) => symbol.kind === "folder" || symbol.kind === "package")
        .map((symbol) => symbol.id),
    ).toEqual([
      "app#folder:app",
      "app/pkg#folder:pkg",
      "app/server#package:server",
      "app/src#folder:src",
    ]);
    expect(index.edges.some((edge) => (edge.kind as string) === "contains")).toBe(false);
  });

  it("makes a Rust module folder a package", async () => {
    const index = await indexOf({
      "src/lib.rs": "mod shapes;\n",
      "src/shapes/mod.rs": "pub mod circle;\n",
      "src/shapes/circle.rs": "pub struct Circle;\n",
      "src/util/text.rs": "pub fn trim() {}\n",
    });
    expect(
      index.symbols
        .filter((symbol) => symbol.range.endLine === 0)
        .map((symbol) => `${symbol.id} <- ${symbol.parent ?? "-"}`),
    ).toEqual([
      "src#package:src <- -",
      "src/shapes#package:shapes <- src#package:src",
      "src/util#folder:util <- src#package:src",
    ]);
  });
});

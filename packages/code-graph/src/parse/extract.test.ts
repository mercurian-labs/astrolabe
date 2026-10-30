import { describe, expect, it } from "vite-plus/test";

import { GO_SNIPPET, PY_SNIPPET, RS_SNIPPET, TS_SNIPPET } from "../testing/snippets.ts";
import { extractFile, type FileFacts } from "./extract.ts";

/** Each symbol as `id <- parent`. */
const tree = (facts: FileFacts) =>
  facts.symbols.map((symbol) => `${symbol.id} <- ${symbol.parent ?? "-"}`);
const references = (facts: FileFacts) =>
  facts.references.map(
    (reference) =>
      `${reference.from} ${reference.kind} ${reference.qualifier === null ? "" : `${reference.qualifier}.`}${reference.name}`,
  );
/** Each import binding without where it is written. */
const bindings = (facts: FileFacts) =>
  facts.imports.map(({ line: _line, text: _text, ...binding }) => binding);

describe("extractFile", () => {
  it("reads TypeScript kinds, parents, heritage, calls, constructions, exports, and imports", async () => {
    const facts = await extractFile("src/shapes.ts", "typescript", TS_SNIPPET);
    const at = (rest: string) => `src/shapes.ts#${rest}`;
    const file = at("file:shapes.ts");
    expect(tree(facts)).toEqual([
      `${file} <- -`,
      `${at("interface:Shape")} <- ${file}`,
      `${at("method:Shape.area")} <- ${at("interface:Shape")}`,
      `${at("class:Base")} <- ${file}`,
      `${at("class:Square")} <- ${file}`,
      `${at("method:Square.area")} <- ${at("class:Square")}`,
      `${at("function:build")} <- ${file}`,
      `${at("constant:SIDES")} <- ${file}`,
    ]);
    expect(references(facts)).toEqual([
      `${at("class:Square")} inherits Base`,
      `${at("class:Square")} implements Shape`,
      `${at("method:Square.area")} calls helper`,
      `${at("function:build")} instantiates Square`,
      `${file} calls Lib.run`,
    ]);
    expect(facts.exports).toEqual([
      at("class:Base"),
      at("class:Square"),
      at("constant:SIDES"),
      at("function:build"),
      at("interface:Shape"),
    ]);
    expect(bindings(facts)).toContainEqual({
      kind: "named",
      source: "./util.ts",
      local: "helper",
      imported: "helper",
    });
    expect(bindings(facts)).toContainEqual({
      kind: "namespace",
      source: "./lib.ts",
      local: "Lib",
      imported: null,
    });
    expect(facts.symbols.find((symbol) => symbol.id === at("method:Square.area"))?.range).toEqual({
      startLine: 11,
      endLine: 13,
    });
  });

  it("reads Python kinds, parents, bases, calls, and from-imports", async () => {
    const facts = await extractFile("pkg/coder.py", "python", PY_SNIPPET);
    const at = (rest: string) => `pkg/coder.py#${rest}`;
    const file = at("file:coder.py");
    expect(tree(facts)).toEqual([
      `${file} <- -`,
      `${at("class:Coder")} <- ${file}`,
      `${at("method:Coder.run")} <- ${at("class:Coder")}`,
      `${at("method:Coder.send")} <- ${at("class:Coder")}`,
      `${at("function:main")} <- ${file}`,
      `${at("constant:LIMIT")} <- ${file}`,
    ]);
    expect(references(facts)).toEqual([
      `${at("class:Coder")} inherits Base`,
      `${at("method:Coder.run")} calls self.send`,
      `${at("method:Coder.run")} calls InputOutput`,
      `${at("function:main")} calls Coder`,
      `${at("function:main")} calls *.run`,
    ]);
    // Without `__all__`, a Python module exports nothing by this reading.
    expect(facts.exports).toEqual([]);
    expect(bindings(facts)).toContainEqual({
      kind: "named",
      source: ".io",
      local: "InputOutput",
      imported: "InputOutput",
    });
  });

  it("reads Go kinds, receiver methods under their struct, calls, exports, and imports", async () => {
    const facts = await extractFile("server/server.go", "go", GO_SNIPPET);
    const at = (rest: string) => `server/server.go#${rest}`;
    const file = at("file:server.go");
    expect(tree(facts)).toEqual([
      `${file} <- -`,
      `${at("interface:Handler")} <- ${file}`,
      `${at("method:Handler.Serve")} <- ${at("interface:Handler")}`,
      `${at("class:Server")} <- ${file}`,
      `${at("method:Server.Serve")} <- ${at("class:Server")}`,
      `${at("function:New")} <- ${file}`,
    ]);
    expect(references(facts)).toContain(`${at("method:Server.Serve")} calls fmt.Println`);
    expect(references(facts)).toContain(`${at("method:Server.Serve")} calls st.Open`);
    // Capitalised names are exported; an interface's method is the interface's.
    expect(facts.exports).toEqual([
      at("class:Server"),
      at("function:New"),
      at("interface:Handler"),
      at("method:Server.Serve"),
    ]);
    expect(bindings(facts)).toEqual([
      { kind: "namespace", source: "fmt", local: "fmt", imported: null },
      { kind: "namespace", source: "example.com/app/store", local: "st", imported: null },
    ]);
  });

  it("reads Rust kinds, impl methods under their struct, constructions, pub exports, and use", async () => {
    const facts = await extractFile("src/circle.rs", "rust", RS_SNIPPET);
    const at = (rest: string) => `src/circle.rs#${rest}`;
    const file = at("file:circle.rs");
    expect(tree(facts)).toEqual([
      `${file} <- -`,
      `${at("class:Circle")} <- ${file}`,
      `${at("method:Circle.area")} <- ${at("class:Circle")}`,
      `${at("method:Circle.new")} <- ${at("class:Circle")}`,
      `${at("function:helper")} <- ${file}`,
      `${at("function:main")} <- ${file}`,
    ]);
    expect(references(facts)).toEqual([
      `${at("class:Circle")} implements Shape`,
      `${at("method:Circle.area")} calls helper`,
      // `Circle::new(1.0)` constructs a Circle.
      `${at("function:main")} instantiates Circle`,
      `${at("function:main")} calls c.area`,
      `${at("method:Circle.new")} returns Self`,
    ]);
    expect(facts.exports).toEqual([at("class:Circle"), at("method:Circle.new")]);
    expect(bindings(facts)).toEqual([
      { kind: "named", source: "crate::shapes", local: "Shape", imported: "Shape" },
    ]);
  });

  it("reads enums in each language", async () => {
    const cases = [
      ["src/color.ts", "typescript", "export enum Color { Red }\n"],
      ["pkg/color.py", "python", "from enum import Enum\n\nclass Color(Enum):\n    RED = 1\n"],
      ["src/color.rs", "rust", "pub enum Color { Red }\n"],
    ] as const;
    for (const [path, language, text] of cases) {
      const facts = await extractFile(path, language, text);
      expect(facts.symbols.map((symbol) => symbol.kind)).toEqual(["file", "enum"]);
    }
    // Go has no enum: an iota block is constants.
    const go = await extractFile(
      "color/color.go",
      "go",
      "package color\n\nconst (\n\tRed = iota\n\tGreen\n)\n",
    );
    expect(go.symbols.map((symbol) => symbol.kind)).toEqual(["file", "constant", "constant"]);
  });

  it("reads exports from `export` clauses, `__all__`, and `pub`", async () => {
    const ts = await extractFile(
      "src/a.ts",
      "typescript",
      "function a() {}\nfunction b() {}\nfunction hidden() {}\nexport { a, b as c };\n",
    );
    expect(ts.exports).toEqual(["src/a.ts#function:a", "src/a.ts#function:b"]);
    const py = await extractFile(
      "pkg/a.py",
      "python",
      '__all__ = ["run"]\n\ndef run():\n    pass\n\ndef hidden():\n    pass\n',
    );
    expect(py.exports).toEqual(["pkg/a.py#function:run"]);
    const rs = await extractFile("src/a.rs", "rust", "pub fn run() {}\nfn hidden() {}\n");
    expect(rs.exports).toEqual(["src/a.rs#function:run"]);
  });

  it("tells a function passed as a value from a call", async () => {
    const facts = await extractFile(
      "src/app.ts",
      "typescript",
      "export function main(items: Array<number>) {\n  items.map(render);\n  run();\n}\n",
    );
    expect(references(facts)).toEqual([
      "src/app.ts#function:main calls items.map",
      "src/app.ts#function:main values render",
      "src/app.ts#function:main calls run",
      // A parameter's annotation is what the function accepts, not a mention.
      "src/app.ts#function:main accepts Array",
    ]);
  });

  it("hashes a definition's own text: editing a method leaves its class and file alone", async () => {
    const before = await extractFile("src/shapes.ts", "typescript", TS_SNIPPET);
    const after = await extractFile(
      "src/shapes.ts",
      "typescript",
      TS_SNIPPET.replace("helper(2)", "helper(3)"),
    );
    const changed = after.symbols
      .filter((symbol, index) => symbol.hash !== before.symbols[index]?.hash)
      .map((symbol) => symbol.id);
    expect(changed).toEqual(["src/shapes.ts#method:Square.area"]);
  });

  it("names a namespaced constructor by its class, reached through its namespace", async () => {
    const facts = await extractFile(
      "src/app.ts",
      "typescript",
      "export function main() {\n  new Lib.Widget();\n  new A.B.Gadget();\n}\n",
    );
    expect(references(facts)).toEqual([
      "src/app.ts#function:main instantiates Lib.Widget",
      "src/app.ts#function:main instantiates A.B.Gadget",
    ]);
  });

  it("reads default imports and the file's default export", async () => {
    const importer = await extractFile("src/app.ts", "typescript", 'import run from "./lib";\n');
    expect(bindings(importer)).toContainEqual({
      kind: "named",
      source: "./lib",
      local: "run",
      imported: "default",
    });
    for (const [text, name] of [
      ["export default function actual() {}\n", "actual"],
      ["export default class Widget {}\n", "Widget"],
      ["function inner() {}\nexport default inner;\n", "inner"],
      ["export function plain() {}\n", null],
    ] as const) {
      expect((await extractFile("src/lib.ts", "typescript", text)).defaultExport).toBe(name);
    }
  });

  it("records the lines a reference is made on and where each import is written", async () => {
    const text = [
      'import { helper } from "./util.ts";',
      "import {",
      "  other,",
      '} from "./other.ts";',
      "export function run() {",
      "  helper();",
      "  other();",
      "  helper();",
      "}",
      "",
    ].join("\n");
    const facts = await extractFile("src/run.ts", "typescript", text);
    expect(facts.references.map((reference) => [reference.name, reference.lines])).toEqual([
      ["helper", [6, 8]],
      ["other", [7]],
    ]);
    expect(
      facts.imports
        .filter((binding) => binding.kind === "named")
        .map((binding) => [binding.local, binding.line, binding.text]),
    ).toEqual([
      ["helper", 1, 'import { helper } from "./util.ts";'],
      ["other", 2, 'import { other, } from "./other.ts";'],
    ]);
  });
});

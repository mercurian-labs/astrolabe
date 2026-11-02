import { describe, expect, it } from "vite-plus/test";

import type { StoredSymbol } from "./facts.ts";
import { Modules, parseNodeId, symbolTree } from "./levels.ts";
import { Packages } from "./resolve.ts";

const files = (paths: ReadonlyArray<string>) => new Map(paths.map((path) => [path, "blob"]));

const pkg = (name: string, dir: string) => ({
  name,
  dir,
  manifest: `${dir}/package.json`,
  exports: null,
  imports: null,
  main: null,
});

describe("Modules", () => {
  it("groups TypeScript by workspace package, and leaves a file outside one as its own module", () => {
    const modules = new Modules(
      files(["packages/app/src/a.ts", "scripts/build.ts"]),
      new Packages([pkg("@fixture/app", "packages/app")]),
    );
    expect(modules.of("packages/app/src/a.ts", "typescript")).toEqual({
      id: "module:packages/app",
      folder: "packages/app",
      name: "@fixture/app",
    });
    expect(modules.of("scripts/build.ts", "typescript")).toBeNull();
  });

  it("groups Go by folder and Python by package, named from the outermost package", () => {
    const modules = new Modules(
      files([
        "cmd/server/main.go",
        "app/__init__.py",
        "app/models/__init__.py",
        "app/models/user.py",
        "manage.py",
      ]),
      new Packages([]),
    );
    expect(modules.of("cmd/server/main.go", "go")?.name).toBe("server");
    expect(modules.of("app/models/user.py", "python")).toEqual({
      id: "module:app/models",
      folder: "app/models",
      name: "app.models",
    });
    expect(modules.of("manage.py", "python")).toBeNull();
  });

  it("groups Rust by the mod holding a file, a.rs together with the folder a/", () => {
    const modules = new Modules(
      files(["crate/src/lib.rs", "crate/src/net.rs", "crate/src/net/tcp.rs", "crate/src/util.rs"]),
      new Packages([]),
    );
    expect(modules.of("crate/src/net.rs", "rust")?.id).toBe("module:crate/src/net");
    expect(modules.of("crate/src/net/tcp.rs", "rust")?.id).toBe("module:crate/src/net");
    // A crate's root folder is named for the crate.
    expect(modules.of("crate/src/lib.rs", "rust")).toEqual({
      id: "module:crate/src",
      folder: "crate/src",
      name: "crate",
    });
    expect(modules.of("crate/src/util.rs", "rust")?.id).toBe("module:crate/src");
  });
});

const symbol = (qualified: string, line: number): StoredSymbol => ({
  name: qualified.slice(qualified.lastIndexOf(".") + 1),
  kind: "function",
  qualified,
  line,
  endLine: line,
  parent: null,
  signature: null,
  exported: true,
  hash: qualified,
});

describe("symbolTree", () => {
  it("puts a definition under the definition its name is qualified by", () => {
    const tree = symbolTree([
      symbol("Shape", 1),
      symbol("Shape.area", 2),
      symbol("Shape.area.inner", 3),
      symbol("helper", 9),
      symbol("Missing.method", 10),
    ]);
    expect(tree.top.map((each) => each.qualified)).toEqual(["Shape", "helper", "Missing.method"]);
    expect(tree.members.get("Shape")?.map((each) => each.qualified)).toEqual(["Shape.area"]);
    expect(tree.ownerOf("Shape.area.inner")).toEqual({ top: "Shape", member: "Shape.area" });
    expect(tree.ownerOf("helper")).toEqual({ top: "helper", member: null });
    expect(tree.ownerOf("absent")).toBeNull();
  });
});

describe("parseNodeId", () => {
  it("reads paths, modules and definitions", () => {
    expect(parseNodeId("src/a.ts")).toEqual({ kind: "path", path: "src/a.ts" });
    expect(parseNodeId("module:packages/app")).toEqual({ kind: "module", folder: "packages/app" });
    expect(parseNodeId("src/a.ts#Shape.area")).toEqual({
      kind: "symbol",
      path: "src/a.ts",
      qualified: "Shape.area",
    });
  });
});

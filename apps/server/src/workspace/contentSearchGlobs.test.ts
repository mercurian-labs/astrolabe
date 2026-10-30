import { describe, expect, it } from "vite-plus/test";

import { makeContentSearchPathFilter, splitGlobPatterns } from "./contentSearchGlobs.ts";

const paths = ["src/a.rs", "src/api/b.rs", "web/c.ts", "web/d.ts", "README.md", "vendor/x/e.ts"];

function filtered(input: { readonly include?: string; readonly exclude?: string }) {
  const filter = makeContentSearchPathFilter(input);
  return filter ? paths.filter(filter.matches) : paths;
}

describe("splitGlobPatterns", () => {
  it("splits on commas outside braces and unescapes escaped commas", () => {
    expect(splitGlobPatterns("src/**,{a,b}.rs,x\\,y")).toEqual(["src/**", "{a,b}.rs", "x,y"]);
  });

  it("trims patterns, drops empty ones and strips leading ./ and /", () => {
    expect(splitGlobPatterns(" *.ts , ,./src/,/docs")).toEqual(["*.ts", "src/", "docs"]);
    expect(splitGlobPatterns("")).toEqual([]);
  });
});

describe("makeContentSearchPathFilter", () => {
  it("has no filter without patterns", () => {
    expect(makeContentSearchPathFilter({ include: " , ", exclude: "" })).toBeNull();
  });

  it("keeps only included files, and an inclusion matching nothing doesn't block the others", () => {
    expect(filtered({ include: "*.odd" })).toEqual([]);
    expect(filtered({ include: "*.rs" })).toEqual(["src/a.rs", "src/api/b.rs"]);
    expect(filtered({ include: "*.ts, *.odd" })).toEqual(["web/c.ts", "web/d.ts", "vendor/x/e.ts"]);
  });

  it("removes excluded files, and exclusions win over inclusions", () => {
    expect(filtered({ exclude: "*.rs" })).toEqual([
      "web/c.ts",
      "web/d.ts",
      "README.md",
      "vendor/x/e.ts",
    ]);
    expect(filtered({ exclude: "*.nothing" })).toEqual(paths);
    expect(filtered({ include: "*.ts", exclude: "*.ts" })).toEqual([]);
    expect(filtered({ include: "*.ts", exclude: "*.rs" })).toEqual([
      "web/c.ts",
      "web/d.ts",
      "vendor/x/e.ts",
    ]);
  });

  it("treats a path as covering everything below it", () => {
    expect(filtered({ include: "src/api" })).toEqual(["src/api/b.rs"]);
    expect(filtered({ include: "src/api/" })).toEqual(["src/api/b.rs"]);
    expect(filtered({ exclude: "vendor" })).not.toContain("vendor/x/e.ts");
    expect(filtered({ include: "README.md" })).toEqual(["README.md"]);
    expect(filtered({ include: "src/a" })).toEqual([]);
  });

  it("supports **, braces, classes and escapes", () => {
    expect(filtered({ include: "**/b.rs" })).toEqual(["src/api/b.rs"]);
    expect(filtered({ include: "web/{c,d}.ts" })).toEqual(["web/c.ts", "web/d.ts"]);
    expect(filtered({ include: "web/[!c].ts" })).toEqual(["web/d.ts"]);
    expect(filtered({ include: "vendor/*" })).toEqual(["vendor/x/e.ts"]);
    const literal = makeContentSearchPathFilter({ include: "a\\*b" });
    expect(literal?.matches("a*b")).toBe(true);
    expect(literal?.matches("axxb")).toBe(false);
  });

  it("only skips directories that nothing below can match", () => {
    const filter = makeContentSearchPathFilter({
      include: "node_modules/pkg/**, *.md",
      exclude: "node_modules/pkg/dist",
    })!;
    expect(filter.mayMatchBelow("node_modules")).toBe(true);
    expect(filter.mayMatchBelow("node_modules/pkg")).toBe(true);
    expect(filter.mayMatchBelow("node_modules/pkg/dist")).toBe(false);
    expect(filter.mayMatchBelow("target")).toBe(true);

    const narrow = makeContentSearchPathFilter({ include: "node_modules/pkg/**" })!;
    expect(narrow.mayMatchBelow("node_modules/other")).toBe(false);
    expect(narrow.mayMatchBelow("target")).toBe(false);
  });

  it("asks fff to prefilter only with inclusions it reads at least as broadly", () => {
    const constraints = (include: string, exclude?: string) =>
      makeContentSearchPathFilter({ include, ...(exclude ? { exclude } : {}) })?.fffConstraints;
    expect(constraints("*.ts, src/api/**, docs/, *.{md,txt}")).toEqual([
      "*.ts",
      "src/api/",
      "docs/",
      "*.{md,txt}",
    ]);
    expect(constraints("*.ts, src/a.ts")).toEqual([]);
    expect(constraints("src/*.ts")).toEqual([]);
    expect(constraints("*.ts", "*.rs")).toEqual(["*.ts"]);
  });
});

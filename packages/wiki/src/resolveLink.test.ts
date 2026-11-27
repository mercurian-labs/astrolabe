import { describe, expect, it } from "vite-plus/test";

import {
  isWikiPath,
  linkFiles,
  projectLinkFiles,
  resolveLink,
  resolveProjectLink,
  unwrittenFile,
  unwrittenProjectFile,
  writtenProjectLink,
} from "./index.ts";

const VAULT = linkFiles([
  "Name.md",
  "a/Name.md",
  "b/Name.md",
  "a/deep/Name.md",
  "a/NoRoot.md",
  "b/NoRoot.md",
  "a/deep/NoRoot.md",
  "ca/Case.md",
  "cb/case.md",
]);
const LINKERS = ["L.md", "a/L.md", "a/deep/L.md", "b/L.md", "c/L.md"] as const;

/** Section A1, read across: root, `a/`, `a/deep/`, `b/`, `c/`. Null is a red link. */
const A1: ReadonlyArray<readonly [string, ReadonlyArray<string | null>]> = [
  ["Name", ["Name.md", "Name.md", "Name.md", "Name.md", "Name.md"]],
  ["NoRoot", ["a/NoRoot.md", "a/NoRoot.md", "a/deep/NoRoot.md", "b/NoRoot.md", "a/NoRoot.md"]],
  ["a/Name", ["a/Name.md", "a/Name.md", "a/Name.md", "a/Name.md", "a/Name.md"]],
  ["deep/Name", Array(5).fill("a/deep/Name.md")],
  ["eep/Name", Array(5).fill("a/deep/Name.md")],
  ["c/Name", Array(5).fill(null)],
  ["./Name", ["Name.md", "a/Name.md", "a/deep/Name.md", "b/Name.md", null]],
  ["./NoRoot", ["a/NoRoot.md", "a/NoRoot.md", "a/deep/NoRoot.md", "b/NoRoot.md", null]],
  ["./deep/Name", ["a/deep/Name.md", "a/deep/Name.md", null, null, null]],
  ["../Name", ["Name.md", "Name.md", "a/Name.md", "Name.md", "Name.md"]],
  ["../NoRoot", Array(5).fill("a/NoRoot.md")],
  ["../../Name", Array(5).fill("Name.md")],
  ["/a/Name", Array(5).fill("a/Name.md")],
  ["/Name", Array(5).fill("Name.md")],
  ["/NoRoot", Array(5).fill(null)],
  ["/deep/Name", Array(5).fill(null)],
  ["a/Name.md", Array(5).fill("a/Name.md")],
  ["Name.md", Array(5).fill("Name.md")],
  ["NoRoot.md", ["a/NoRoot.md", "a/NoRoot.md", "a/deep/NoRoot.md", "b/NoRoot.md", "a/NoRoot.md"]],
  ["name", Array(5).fill("Name.md")],
  ["NAME", Array(5).fill("Name.md")],
  ["noroot", ["a/NoRoot.md", "a/NoRoot.md", "a/deep/NoRoot.md", "b/NoRoot.md", "a/NoRoot.md"]],
  ["NOROOT", ["a/NoRoot.md", "a/NoRoot.md", "a/deep/NoRoot.md", "b/NoRoot.md", "a/NoRoot.md"]],
  ["A/Name", Array(5).fill("a/Name.md")],
  ["DEEP/Name", Array(5).fill("a/deep/Name.md")],
  ["Case", ["ca/Case.md", "ca/Case.md", "ca/Case.md", "ca/Case.md", "ca/Case.md"]],
];

/** A2 and the rest: the copies, the linker, the link, and where it went. */
const SINGLES: ReadonlyArray<
  readonly [shows: string, files: string[], from: string | null, link: string, to: string | null]
> = [
  ["p/Name is raw text", ["a/deep/Name.md"], "ww/x/L.md", "p/Name", "a/deep/Name.md"],
  ["e/Name isn't a suffix", ["a/deep/Name.md"], "t/L.md", "e/Name", null],
  ["Name.MD", ["Name.md"], "t/L.md", "Name.MD", "Name.md"],
  ["NAME.md", ["Name.md"], null, "NAME.md", "Name.md"],
  ["not alphabetical", ["zz1/T1.md", "aa1/bb/T1.md"], null, "T1", "zz1/T1.md"],
  ["not depth", ["longfoldername/T4.md", "a4/b4/T4.md"], null, "T4", "a4/b4/T4.md"],
  ["shorter beats alphabetical", ["zzz/T16.md", "aaaaaa/T16.md"], null, "T16", "zzz/T16.md"],
  ["shorter beats shallower", ["zz/yy/T17.md", "aaaaaaaaaa/T17.md"], null, "T17", "zz/yy/T17.md"],
  [
    "below the linker beats shorter",
    ["w/x/sub/T7.md", "aa7/T7.md"],
    "w/x/L.md",
    "T7",
    "w/x/sub/T7.md",
  ],
  ["elsewhere, shorter", ["w/x/sub/T7.md", "aa7/T7.md"], "q/L.md", "T7", "aa7/T7.md"],
  [
    "below the linker beats a parent copy",
    ["ww/T27.md", "ww/x/deeper/T27.md"],
    "ww/x/L.md",
    "T27",
    "ww/x/deeper/T27.md",
  ],
  [
    "shortest inside the linker's folder",
    ["ww/x/longlonglong/T22.md", "ww/x/p/q/T22.md"],
    "ww/x/L.md",
    "T22",
    "ww/x/p/q/T22.md",
  ],
  ["exact beats below the linker", ["T24.md", "ww/x/sub/T24.md"], "ww/x/L.md", "T24", "T24.md"],
  [
    "an exact path beats the linker's copy",
    ["deep/T12.md", "k1/deep/T12.md", "k2/deep/T12.md"],
    "k2/L.md",
    "deep/T12",
    "deep/T12.md",
  ],
  [
    "a bare name prefers the linker",
    ["deep/T12.md", "k1/deep/T12.md", "k2/deep/T12.md"],
    "k2/L.md",
    "T12",
    "k2/deep/T12.md",
  ],
  [
    "a suffix uses the linker too",
    ["k1/deep/T11.md", "k2/deep/T11.md"],
    "k2/L.md",
    "deep/T11",
    "k2/deep/T11.md",
  ],
  ["a path is root-first", ["q15/T15.md", "m/q15/T15.md"], "m/L.md", "q15/T15", "q15/T15.md"],
  ["bare, from m/", ["q15/T15.md", "m/q15/T15.md"], "m/L.md", "T15", "m/q15/T15.md"],
  ["a suffix has no boundary", ["adeep/T18.md", "x/deep/T18.md"], null, "deep/T18", "adeep/T18.md"],
  ["w/xy counts as under w/x", ["w/xy/B1.md", "q/B1.md"], "w/x/L.md", "B1", "w/xy/B1.md"],
  ["control", ["w/x/sub2/B2.md", "q/B2.md"], "w/x/L.md", "B2", "w/x/sub2/B2.md"],
  ["./ joins, then suffix matches", ["pre/ww/x/T26.md"], "ww/x/L.md", "./T26", "pre/ww/x/T26.md"],
  ["a bare name is whole", ["Name.md"], null, "ame", null],
  ["with its extension too", ["Name.md"], null, "me.md", null],
  ["a parent folder gives nothing", ["aa/P1.md", "ww/P1.md"], "ww/x/L.md", "P1", "aa/P1.md"],
  ["a cousin folder gives nothing", ["aa/y/C1.md", "ww/y/C1.md"], "ww/x/L.md", "C1", "aa/y/C1.md"],
  ["exact case has no preference", ["ca/Case.md", "cb/case.md"], null, "case", "ca/Case.md"],
  ["from cb/", ["ca/Case.md", "cb/case.md"], "cb/L.md", "CASE", "cb/case.md"],
  ["a folder's case", ["ca/Case.md", "cb/case.md"], "cb/L.md", "ca/case", "ca/Case.md"],
  ["and the other", ["ca/Case.md", "cb/case.md"], "ca/L.md", "CB/Case", "cb/case.md"],
  ["a heading goes", ["a/Name.md"], null, "a/Name#Heading", "a/Name.md"],
  ["an alias goes", ["a/Name.md"], null, "a/Name|shown", "a/Name.md"],
  ["a table's bar too", ["a/Name.md"], null, "a/Name\\|shown", "a/Name.md"],
  ["a folder is no document", ["a/Name.md"], null, "a/", null],
  ["nor is its name", ["a/Name.md"], null, "a", null],
  // Ours: Obsidian's tie changes across startups, so byte order decides.
  ["a tie is byte order", ["ob/Q1.md", "oa/Q1.md"], null, "Q1", "oa/Q1.md"],
  ["not locale order", ["b/U.md", "B/U.md"], null, "U", "B/U.md"],
  // Ours: a hidden document opens by its path and no other way.
  ["hidden, exact", [".github/Guide.md"], null, ".github/Guide", ".github/Guide.md"],
  ["hidden, exact from /", [".github/Guide.md"], null, "/.github/Guide", ".github/Guide.md"],
  ["hidden, relative", [".github/Guide.md"], ".github/L.md", "./Guide", ".github/Guide.md"],
  ["hidden, bare", [".github/Guide.md"], null, "Guide", null],
  ["hidden, from beside it", [".github/Guide.md"], ".github/L.md", "Guide", null],
  ["hidden, by suffix", [".x/deep/Guide.md"], null, "deep/Guide", null],
  ["a visible copy wins", [".a/Guide.md", "zzzz/Guide.md"], null, "Guide", "zzzz/Guide.md"],
  // A dot in a name isn't always an extension: flat wikis have these.
  ["a dotted name", ["Release 1.2.md"], null, "Release 1.2", "Release 1.2.md"],
  // A case-sensitive server, which the probe couldn't try: identity is the path.
  ["its own spelling", ["cz/Cs.md", "cz/cs.md"], null, "cz/cs", "cz/cs.md"],
];

/** Section E: the extension is part of an attachment's name. */
const E = linkFiles([
  "image.png",
  "ea/image.png",
  "eb/image.png",
  "ea/deep/image.png",
  "ea/noroot.png",
  "eb/noroot.png",
  "Both.md",
  "Both.png",
  "fa/Mix.png",
  "fb/Mix.md",
  "Dup.md",
  "Dup.canvas",
]);
const ATTACHMENTS: ReadonlyArray<readonly [string, string | null, string | null]> = [
  ["image.png", "ea/L.md", "image.png"],
  ["image", "ea/L.md", null],
  ["noroot.png", "ea/L.md", "ea/noroot.png"],
  ["noroot.png", "eb/L.md", "eb/noroot.png"],
  ["noroot.png", null, "ea/noroot.png"],
  ["./image.png", "ea/L.md", "ea/image.png"],
  ["./image.png", "ec/L.md", null],
  ["../image.png", "ea/deep/L.md", "ea/image.png"],
  ["../image.png", "ea/L.md", "image.png"],
  ["deep/image.png", "eb/L.md", "ea/deep/image.png"],
  ["/ea/image.png", "eb/L.md", "ea/image.png"],
  ["IMAGE.PNG", "ea/L.md", "image.png"],
  ["Both", null, "Both.md"],
  ["Both.png", null, "Both.png"],
  ["Mix", "fa/L.md", "fb/Mix.md"],
  ["Dup", null, "Dup.md"],
  ["Dup.canvas", null, "Dup.canvas"],
];

describe("resolveLink", () => {
  it.each(A1)("[[%s]] as section A1 observed", (link, targets) => {
    expect(LINKERS.map((from) => resolveLink(link, from, VAULT).file)).toEqual(targets);
  });

  it.each(SINGLES)("%s", (_shows, files, from, link, to) => {
    expect(resolveLink(link, from, linkFiles(files)).file).toBe(to);
  });

  it.each(ATTACHMENTS)("![[%s]] from %s", (link, from, to) => {
    expect(resolveLink(link, from, E).file).toBe(to);
  });

  it("names what else the search matched, however the linker narrowed it", () => {
    expect(resolveLink("NoRoot", "c/L.md", VAULT)).toEqual({
      file: "a/NoRoot.md",
      others: ["a/deep/NoRoot.md", "b/NoRoot.md"],
    });
    expect(resolveLink("NoRoot", "b/L.md", VAULT)).toEqual({
      file: "b/NoRoot.md",
      others: ["a/NoRoot.md", "a/deep/NoRoot.md"],
    });
    expect(resolveLink("../NoRoot", "a/deep/L.md", VAULT).others).toEqual([]);
    expect(resolveLink("a/Name", null, VAULT).others).toEqual([]);
    expect(resolveLink("Missing", null, VAULT)).toEqual({ file: null, others: [] });
  });

  it("finds a path that holds what would start a heading or an alias", () => {
    expect(resolveLink("/docs/c#/a|b.md", null, linkFiles(["docs/c#/a|b.md"])).file).toBe(
      "docs/c#/a|b.md",
    );
  });

  it.each(["/C# notes.md", "/C|notes.md"])("finds nothing else for the exact %s", (path) => {
    expect(resolveLink(path, null, linkFiles(["C.md"]))).toEqual({ file: null, others: [] });
  });
});

describe("unwrittenFile", () => {
  it.each([
    ["S", "a/deep/L.md", "a/deep/S.md"],
    ["S", null, "S.md"],
    ["S.md", "c/L.md", "c/S.md"],
    ["x/S", "c/L.md", "x/S.md"],
    ["deep/S", "a/deep/L.md", "deep/S.md"],
    ["/S", "c/L.md", "S.md"],
    ["/C# notes.md", "c/L.md", "C# notes.md"],
    ["./S", "c/L.md", "c/S.md"],
    ["../S", "a/deep/L.md", "a/S.md"],
    ["S#Heading|shown", "c/L.md", "c/S.md"],
    ["Board.canvas", "c/L.md", "c/Board.canvas"],
    ["Release 1.2", null, "Release 1.2.md"],
  ])("[[%s]] from %s lands at %s", (link, from, file) => {
    expect(unwrittenFile(link, from)).toBe(file);
  });
});

describe("isWikiPath", () => {
  it.each(["Plan.md", "a/b/Plan.md", ".notes/Plan.md", "a/.hidden/Plan.md", ".Plan.md"])(
    "holds %s",
    (file) => expect(isWikiPath(file)).toBe(true),
  );

  it.each([
    "",
    "/Plan.md",
    "../Plan.md",
    "a/../Plan.md",
    "a/./Plan.md",
    "a//Plan.md",
    "a/",
    ".git/config",
    "a/.git/Plan.md",
    ".GIT/Plan.md",
    "a\\Plan.md",
    "C:/Plan.md",
    "a/Pl\nan.md",
    "a/Pl\0an.md",
  ])("refuses %j", (file) => expect(isWikiPath(file)).toBe(false));
});

const PROJECT = projectLinkFiles([
  ["web", ["Plan.md", "a/Shared.md", "Note: subtitle.md", "x/L.md"]],
  ["app", ["docs/Plan.md", "Spec.md", "z/Spec.md", "a/Shared.md", "b/Shared.md", "Only.md"]],
  ["lib", ["Spec.md", "Lib.md", "lib/Plan.md"]],
]);
const WEB = { root: "web", file: "x/L.md" } as const;

/** The link, its linker's root, and where it lands as `root:file`; null is red, `?` ambiguous. */
const PROJECT_LINKS: ReadonlyArray<readonly [string, string, string | null]> = [
  ["Plan", "web", "web:Plan.md"],
  ["Plan", "app", "app:docs/Plan.md"],
  ["Plan", "lib", "lib:lib/Plan.md"],
  ["Lib", "web", "lib:Lib.md"],
  ["Only", "lib", "app:Only.md"],
  ["Spec", "web", "?"],
  ["Spec", "app", "app:Spec.md"],
  ["Shared", "lib", "?"],
  ["Missing", "web", null],
  ["Lib#Heading|shown @depends", "web", "lib:Lib.md"],
  ["app:Plan", "web", "app:docs/Plan.md"],
  ["app:docs/Plan", "lib", "app:docs/Plan.md"],
  ["app:Spec#Heading|shown @type", "web", "app:Spec.md"],
  ["app:z/Spec\\|shown", "web", "app:z/Spec.md"],
  ["lib:/Spec", "web", "lib:Spec.md"],
  ["lib:Plan", "web", "lib:lib/Plan.md"],
  ["web:Plan", "web", "web:Plan.md"],
  ["web:./L", "web", "web:x/L.md"],
  ["app:Lib", "web", null],
  ["app:Missing", "web", null],
  ["Note: subtitle", "web", "web:Note: subtitle.md"],
  ["Note: subtitle", "app", "web:Note: subtitle.md"],
  ["nope:Plan", "web", null],
  ["APP:Plan", "web", null],
  ["/Lib", "web", null],
  ["./Lib", "web", null],
  ["../Lib", "web", null],
];

describe("resolveProjectLink", () => {
  it.each(PROJECT_LINKS)("[[%s]] from %s lands on %s", (link, root, to) => {
    const found = resolveProjectLink(
      link,
      { root, file: root === "web" ? "x/L.md" : null },
      PROJECT,
    );
    const landed =
      found.ambiguous.length > 0
        ? "?"
        : found.file === null
          ? null
          : `${found.file.root}:${found.file.file}`;
    expect(landed).toBe(to);
  });

  it("names every match an ambiguous link chooses between, root by root, and picks none", () => {
    expect(resolveProjectLink("Spec", WEB, PROJECT).ambiguous).toEqual([
      { root: "app", file: "Spec.md" },
      { root: "lib", file: "Spec.md" },
    ]);
    expect(resolveProjectLink("Shared", { root: "lib", file: null }, PROJECT)).toEqual({
      file: null,
      others: [],
      ambiguous: [
        { root: "web", file: "a/Shared.md" },
        { root: "app", file: "a/Shared.md" },
        { root: "app", file: "b/Shared.md" },
      ],
    });
  });

  it("keeps a root's own search as it was, and names what else matched in that root", () => {
    for (const [link, from] of [
      ["Spec", "Spec.md"],
      ["Shared", null],
      ["Plan", "a/L.md"],
    ] as const) {
      const alone = resolveLink(link, from, PROJECT.get("app") ?? linkFiles([]));
      const found = resolveProjectLink(link, { root: "app", file: from }, PROJECT);
      expect(found.file?.file ?? null).toBe(alone.file);
      expect(found.others.map(({ file }) => file)).toEqual(alone.others);
    }
    expect(resolveProjectLink("Plan", { root: "lib", file: null }, PROJECT).others).toEqual([]);
  });

  it("never lets a new root retarget a link that landed in its own root", () => {
    const before = projectLinkFiles([
      ["web", ["Plan.md", "design: notes.md"]],
      ["app", ["Lib.md"]],
    ]);
    const after = projectLinkFiles([
      ["web", ["Plan.md", "design: notes.md"]],
      ["app", ["Lib.md", "Plan.md"]],
      ["design", ["notes.md", " notes.md", "Plan.md"]],
    ]);
    for (const link of ["Plan", "design: notes", "design:Plan"]) {
      const from = { root: "web", file: null };
      const first = resolveProjectLink(link, from, before).file;
      if (first !== null) expect(resolveProjectLink(link, from, after).file).toEqual(first);
    }
    expect(resolveProjectLink("design:Plan", WEB, after).file).toEqual({
      root: "design",
      file: "Plan.md",
    });
    // A bare link that only another root carried can become ambiguous, never silently move.
    expect(resolveProjectLink("Lib", WEB, before).file).toEqual({ root: "app", file: "Lib.md" });
    const third = new Map([...before, ["lib", linkFiles(["Lib.md"])]]);
    expect(resolveProjectLink("Lib", WEB, third).ambiguous).toHaveLength(2);
  });
});

describe("writtenProjectLink", () => {
  it.each([
    ["web", "Plan.md", "web", "Plan"],
    ["web", "a/Shared.md", "web", "Shared"],
    ["app", "docs/Plan.md", "web", "app:Plan|Plan"],
    ["app", "Spec.md", "web", "app:Spec|Spec"],
    ["app", "z/Spec.md", "web", "app:z/Spec|Spec"],
    ["app", "z/Spec.md", "app", "z/Spec|Spec"],
    ["lib", "lib/Plan.md", "app", "lib:Plan|Plan"],
    ["web", "Note: subtitle.md", "app", "web:Note: subtitle|Note: subtitle"],
  ])("%s:%s from %s writes %s", (root, file, fromRoot, text) => {
    expect(writtenProjectLink({ root, file }, fromRoot, PROJECT)).toBe(text);
  });

  it("writes a link that lands back on its file from any root", () => {
    for (const [root, rootFiles] of PROJECT) {
      for (const [file] of rootFiles.byPath.values()) {
        if (file === undefined) continue;
        for (const fromRoot of PROJECT.keys()) {
          const written = writtenProjectLink({ root, file }, fromRoot, PROJECT);
          const landed = resolveProjectLink(written, { root: fromRoot, file: null }, PROJECT);
          expect(landed.file).toEqual({ root, file });
        }
      }
    }
  });
});

describe("unwrittenProjectFile", () => {
  it.each([
    ["New", "web", "x/New.md"],
    ["app:New", "app", "New.md"],
    ["app:d/New#H|shown", "app", "d/New.md"],
    ["web:New", "web", "x/New.md"],
    ["nope:New", "web", "x/nope:New.md"],
  ])("[[%s]] from web:x/L.md lands in %s at %s", (link, root, file) => {
    expect(unwrittenProjectFile(link, WEB, PROJECT)).toEqual({ root, file });
  });
});

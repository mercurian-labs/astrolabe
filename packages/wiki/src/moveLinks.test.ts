import { describe, expect, it } from "vite-plus/test";

import {
  AmendmentError,
  indexFiles,
  linkFiles,
  planAmendment,
  planFolderRename,
  planRename,
  resolveLink,
  shortestLink,
  type WikiBlob,
  type WikiFiles,
} from "./index.ts";

const stamp = () => ({ amendment: "m", at: "2026-11-06T00:00:00.000Z", newId: () => "w" });

/** LINKS-REPORT C2, read across: the files, the move, and each changed note's text afterwards. */
const MOVES: ReadonlyArray<{
  readonly row: string;
  readonly files: WikiFiles;
  readonly from: string;
  readonly to: string;
  readonly after: WikiFiles;
}> = [
  {
    row: "1-2: a unique name, in every form",
    files: {
      "G/N.md": "x",
      "L.md": "[[G/N]] [[N]] [[G/N|al]] [[N#H]] ![[N]] [m](G/N.md) [[G/N.md]]",
    },
    from: "G/N",
    to: "Nr",
    after: { "L.md": "[[Nr]] [[Nr]] [[Nr|al]] [[Nr#H]] ![[Nr]] [m](Nr.md) [[Nr]]" },
  },
  {
    row: "3-4: moved, a bare link stays and its file isn't written",
    files: { "lt/U.md": "x", "A.md": "[[lt/U]] [[U]]", "Bare.md": "[[U]]" },
    from: "lt/U",
    to: "mv/U",
    after: { "A.md": "[[U]] [[U]]" },
  },
  {
    row: "6-8: a rename makes a name shared, and a bystander keeps its target",
    files: {
      "G/Foo.md": "x",
      "G/longer/Bar.md": "y",
      "Moved.md": "[[Foo]] [[G/Foo]]",
      "Stander.md": "[[Bar]] [[longer/Bar]] [[G/longer/Bar]]",
    },
    from: "G/Foo",
    to: "Bar",
    after: {
      "Moved.md": "[[G/Bar]] [[G/Bar]]",
      "Stander.md": "[[G/longer/Bar]] [[longer/Bar]] [[G/longer/Bar]]",
    },
  },
  {
    row: "9-10: a rename ends sharing, and nothing else shortens",
    files: {
      "q/Sh.md": "x",
      "G/longer/Sh.md": "y",
      "L.md": "[[q/Sh]] [[longer/Sh]] [[G/longer/Sh]]",
    },
    from: "q/Sh",
    to: "Shx",
    after: { "L.md": "[[Shx]] [[longer/Sh]] [[G/longer/Sh]]" },
  },
  {
    row: "12-13: a move to the root changes the winner",
    files: {
      "longer/Mv.md": "x",
      "q/Mv.md": "y",
      "Sub/L.md": "[[longer/Mv]]",
      "Sub/Stander.md": "[[q/Mv]] [[Mv]]",
    },
    from: "longer/Mv",
    to: "/Mv",
    after: { "Sub/L.md": "[[Mv]]", "Sub/Stander.md": "[[q/Mv]] [[q/Mv]]" },
  },
  {
    row: "14: a shared copy moves and stays shared",
    files: { "q/Sd.md": "x", "s/Sd.md": "y", "L.md": "[[q/Sd]] [[s/Sd]]" },
    from: "q/Sd",
    to: "r/Sd",
    after: { "L.md": "[[r/Sd]] [[s/Sd]]" },
  },
  {
    row: "16-19: the linker moves",
    files: {
      "src/L.md":
        "[[../T]] [m](../T.md) [[./Sib]] [[Sib]] [m](Sib.md) [[Pk]] [[Un]] [[other/Un]] [[Nowhere]]",
      "T.md": "t",
      "src/Sib.md": "s",
      "src/Pk.md": "p",
      "other/longer/Pk.md": "copy beside the linker's new place",
      "other/Un.md": "u",
    },
    from: "src/L",
    to: "other/longer/L",
    after: {
      "other/longer/L.md":
        "[[T]] [m](T.md) [[Sib]] [[Sib]] [m](Sib.md) [[src/Pk]] [[Un]] [[other/Un]] [[Nowhere]]",
    },
  },
  {
    row: "a heading, an alias and a table's bar stay",
    files: {
      "G/N.md": "x",
      "L.md": "| [[G/N#H\\|al]] |\n\n`[[G/N]]`\n\n```\n[[G/N]]\n```\n",
    },
    from: "G/N",
    to: "b/N",
    after: { "L.md": "| [[N#H\\|al]] |\n\n`[[G/N]]`\n\n```\n[[G/N]]\n```\n" },
  },
  {
    row: "a Markdown link keeps its encoding, a web address isn't one",
    files: {
      "a b/My Note.md": "x",
      "L.md":
        '[one](a%20b/My%20Note.md "t") [two](<a b/My Note.md#H>) [web](http://a/My%20Note.md)',
      "Dup/My Note.md": "y",
    },
    from: "a b/My Note",
    to: "c d/My Note",
    after: {
      "L.md":
        '[one](c%20d/My%20Note.md "t") [two](<c d/My Note.md#H>) [web](http://a/My%20Note.md)',
    },
  },
];

describe("moving a document", () => {
  it.each(MOVES)("$row", ({ files, from, to, after }) => {
    const { changes } = planRename(files, [], from, to);
    const written = Object.entries(changes).filter(
      ([file, text]) => text !== null && (file in after || file in files),
    );
    expect(Object.fromEntries(written)).toEqual(after);
  });

  it("reads back every link on the target it had", () => {
    const files = MOVES[6]?.files ?? {};
    const { changes } = planRename(files, [], "src/L", "other/longer/L");
    const next = indexFiles({ ...files, "other/longer/L.md": changes["other/longer/L.md"] ?? "" });
    const note = next.notes.get("other/longer/L.md");
    const listed = linkFiles(Object.keys(files).filter((file) => file !== "src/L.md"));
    const landed = note?.links.map(
      (link) => resolveLink(link.target, "other/longer/L.md", listed).file,
    );
    expect(landed).toEqual([
      "T.md",
      "src/Sib.md",
      "src/Sib.md",
      "src/Pk.md",
      "other/Un.md",
      "other/Un.md",
      null,
    ]);
  });

  it("takes a case-only rename, and refuses a taken path, a reserved name and a dot-path", () => {
    expect(planRename({ "cz/CsT.md": "x" }, [], "cz/CsT", "cst").changes["cz/cst.md"]).toBe("x");
    const files = { "a/N.md": "x", "b/N.md": "y" };
    expect(() => planRename(files, [], "a/N", "b/n")).toThrow(AmendmentError);
    expect(() => planRename(files, [], "a/N", "a/README")).toThrow(AmendmentError);
    expect(() => planRename(files, [], "a/N", "../N")).toThrow(AmendmentError);
    expect(() => planRename(files, [], "a/N", ".git/N")).toThrow(AmendmentError);
    expect(() => planRename(files, [{ file: "c/N.md", oid: "1" }], "a/N", "c/N")).toThrow(
      AmendmentError,
    );
  });

  it("leaves a base's contents to a move, and follows them in a rename in place", () => {
    const files = {
      "a/N.md": "x",
      "Open.base": 'filters: file.hasLink("a/N")\nviews:\n  - type: table\n',
    };
    expect(planRename(files, [], "a/N", "b/N").changes["Open.base"]).toBeUndefined();
    expect(planRename(files, [], "a/N", "M").changes["Open.base"]).toContain("a/M");
  });

  it("rewrites map edges by what they resolve to, and a map can move", () => {
    const map = [
      "---",
      "version: 1",
      "name: Product",
      "purpose: Teach it.",
      "types:",
      "  relates: Relates",
      "edges:",
      "  - { from: A, type: relates, to: a/B, rationale: Why }",
      "---",
      "",
      "See [[B]].",
      "",
    ].join("\n");
    const files = { "m/Product.skillmap.md": map, "A.md": "[[B]]", "a/B.md": "x" };
    const moved = planRename(files, [], "a/B", "z/C").changes;
    expect(moved["m/Product.skillmap.md"]).toContain("to: C");
    expect(moved["m/Product.skillmap.md"]).toContain("See [[C]].");
    expect(moved["A.md"]).toBe("[[C]]");
    const landed = planAmendment(files, moved, stamp()).errors;
    expect(landed).toEqual([]);
    const map2 = planRename(files, [], "m/Product.skillmap.md", "n/Teach").changes;
    expect(map2["n/Teach.skillmap.md"]).toBe(map);
    expect(map2["m/Product.skillmap.md"]).toBeNull();
  });

  it("carries a base and a canvas with its cards", () => {
    const board = JSON.stringify({
      nodes: [
        { id: "f", type: "file", file: "a/N.md", subpath: "#H" },
        { id: "g", type: "group", background: "a/N.md" },
        { id: "t", type: "text", text: "[[a/N]] [[Red]]" },
      ],
      edges: [],
    });
    const files = { "a/N.md": "x", "Board.canvas": board, "b/Other.md": "y" };
    const canvas = JSON.parse(planRename(files, [], "a/N", "b/N").changes["Board.canvas"] ?? "");
    expect(canvas.nodes[0]).toMatchObject({ file: "b/N.md", subpath: "#H" });
    expect(canvas.nodes[1].background).toBe("b/N.md");
    expect(canvas.nodes[2].text).toBe("[[N]] [[Red]]");
    const base = planRename({ "a/Q.base": "views: []\n" }, [], "a/Q.base", "b/R");
    expect(base.changes).toEqual({ "a/Q.base": null, "b/R.base": "views: []\n" });
  });

  it("leaves a note's attachments, and breaks no embed moving it", () => {
    const others: ReadonlyArray<WikiBlob> = [
      { file: "m1/sub/e1.png", oid: "1" },
      { file: "m1/e3.png", oid: "2" },
      { file: "m1/sub/dup.png", oid: "3" },
      { file: "m4/sub/dup.png", oid: "4" },
    ];
    const files = {
      "m1/N.md": "![[e1.png]] ![[sub/e1.png]] ![[./e3.png]] ![](sub/e1.png) ![[m1/sub/dup.png]]",
    };
    const { changes, blobs } = planRename(files, others, "m1/N", "xa/N");
    expect(blobs).toEqual({});
    expect(changes["xa/N.md"]).toBe(
      "![[e1.png]] ![[sub/e1.png]] ![[e3.png]] ![](sub/e1.png) ![[m1/sub/dup.png]]",
    );
  });
});

describe("renaming a folder", () => {
  const files: WikiFiles = {
    "Name.md": "root",
    "a/Name.md": "[[./Name]] [[a/Name]]",
    "a/deep/Name.md": "[[../Name]]",
    "a/NoRoot.md": "n",
    "a/deep/Keep.md": "k",
    "b/Name.md": "b",
    "b/NoRoot.md": "b",
    "dd/Lone.md": "l",
    "dd/sub/Lone2.md": "l",
    "L.md": [
      '---\nup: "[[a/Name]]"\n---',
      "[[a/Name]] [[/a/Name]] [[a/Name.md]] [[A/Name]]",
      "[[a/deep/Name]] [[deep/Name]] [[eep/Name]] [[DEEP/Name]]",
      "[[a/Name|al]] [[a/NoRoot#H]] ![[a/Name]] [m](a/Name.md)",
      "[[Name]] [[b/Name]] [[c/Name]] [[a]] [[a/]]",
      "plain a/Name.md text",
    ].join("\n"),
    "b/L.md": "[[NoRoot]]",
    "c/L.md": "[[NoRoot]] [[dd/Lone]] [[dd/sub/Lone2]] [[sub/Lone2]]",
    "Open.base": 'filters: file.inFolder("a")\nviews:\n  - type: table\n',
    "Board.canvas": JSON.stringify({
      nodes: [
        { id: "f", type: "file", file: "a/Name.md" },
        { id: "i", type: "file", file: "a/sub/shot.png" },
        { id: "t", type: "text", text: "[[a/deep/Name]]" },
      ],
      edges: [],
    }),
  };
  const others: ReadonlyArray<WikiBlob> = [
    { file: "a/sub/shot.png", oid: "1" },
    { file: "a/README.md", oid: "2" },
    { file: "b/shot.png", oid: "3" },
  ];

  it("is a move of each file (LINKS-REPORT D)", () => {
    const { changes, blobs } = planFolderRename(files, others, "a", "z");
    expect(changes["L.md"]).toBe(
      [
        '---\nup: "[[z/Name]]"\n---',
        "[[z/Name]] [[z/Name]] [[z/Name]] [[z/Name]]",
        "[[z/deep/Name]] [[z/deep/Name]] [[z/deep/Name]] [[z/deep/Name]]",
        "[[z/Name|al]] [[z/NoRoot#H]] ![[z/Name]] [m](z/Name.md)",
        "[[Name]] [[b/Name]] [[c/Name]] [[a]] [[a/]]",
        "plain a/Name.md text",
      ].join("\n"),
    );
    expect(changes["a/Name.md"]).toBeNull();
    expect(changes["z/Name.md"]).toBe("[[z/Name]] [[z/Name]]");
    expect(changes["z/deep/Name.md"]).toBe("[[z/Name]]");
    expect(changes["z/deep/Keep.md"]).toBe("k");
    expect(changes["b/L.md"]).toBeUndefined();
    expect(changes["c/L.md"]).toBe("[[z/NoRoot]] [[dd/Lone]] [[dd/sub/Lone2]] [[sub/Lone2]]");
    expect(changes["Open.base"]).toBeUndefined();
    const board = JSON.parse(changes["Board.canvas"] ?? "");
    expect(board.nodes.map((node: { file?: string }) => node.file).slice(0, 2)).toEqual([
      "z/Name.md",
      "z/sub/shot.png",
    ]);
    expect(board.nodes[2].text).toBe("[[z/deep/Name]]");
    expect(blobs).toEqual({
      "a/sub/shot.png": null,
      "z/sub/shot.png": "1",
      "a/README.md": null,
      "z/README.md": "2",
    });
  });

  it("collapses unique names, and takes a move into another folder", () => {
    const { changes } = planFolderRename(files, others, "dd", "e/ee");
    expect(changes["c/L.md"]).toBe("[[NoRoot]] [[Lone]] [[Lone2]] [[Lone2]]");
    expect(changes["e/ee/sub/Lone2.md"]).toBe("l");
  });

  it("rewrites an attachment's embed only when it would break", () => {
    const moved = planFolderRename(
      { "m8/N.md": "![[m8/sub/dup.png]] ![[sub/dup.png]] ![[e5.png]]" },
      [
        { file: "m8/sub/dup.png", oid: "1" },
        { file: "x/dup.png", oid: "2" },
        { file: "m8/sub/e5.png", oid: "3" },
      ],
      "m8",
      "z8",
    );
    expect(moved.changes["z8/N.md"]).toBe("![[z8/sub/dup.png]] ![[sub/dup.png]] ![[e5.png]]");
  });

  it("refuses to land on what's there, inside itself, or nowhere", () => {
    expect(() => planFolderRename(files, others, "a", "b")).toThrow(/exists/);
    expect(() => planFolderRename(files, others, "a", "a/deep/a")).toThrow(/inside itself/);
    expect(() => planFolderRename(files, others, "a", "a")).toThrow(AmendmentError);
    expect(() => planFolderRename(files, others, "nope", "z")).toThrow(/No folder/);
    expect(() => planFolderRename(files, others, "a", "../z")).toThrow(AmendmentError);
    expect(() => planFolderRename(files, others, "a", ".git")).toThrow(AmendmentError);
  });
});

describe("writing a link", () => {
  const listed = linkFiles([
    "Name.md",
    "a/Name.md",
    "a/deep/Name.md",
    "bt/sub/Uniq.md",
    "x/image.png",
    "x/Board.canvas",
    ".hidden/Lone.md",
  ]);
  it.each([
    ["Name.md", "Name"],
    ["a/Name.md", "a/Name"],
    ["a/deep/Name.md", "a/deep/Name"],
    ["bt/sub/Uniq.md", "Uniq"],
    ["x/image.png", "image.png"],
    ["x/Board.canvas", "Board.canvas"],
    [".hidden/Lone.md", ".hidden/Lone"],
  ])("shortest for %s is %s", (file, text) => {
    expect(shortestLink(file, listed)).toBe(text);
  });
});

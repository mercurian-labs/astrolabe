// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  canvasBounds,
  canvasChangeSections,
  canvasChangeSummary,
  canvasData,
  canvasDocument,
  canvasDrawingProblems,
  canvasInkBounds,
  canvasInkEnd,
  canvasEmbeds,
  canvasFileName,
  canvasFrame,
  canvasFrameCards,
  canvasNameKey,
  canvasUniqueTitle,
  canvasLayoutKind,
  diffCanvas,
  parseCanvas,
  placeCanvas,
  reviewCanvas,
  reviewCanvasFiles,
  serializeCanvas,
  type CanvasBounds,
  type CanvasDrawing,
} from "./canvas.ts";
import { canvasLinks, canvasOutline, canvasSourceOutline, renameInCanvas } from "./canvasIndex.ts";

const fixtureFolder = new URL("./fixtures/obsidian-canvas/", import.meta.url);
const fixture = (name: string) => NodeFS.readFileSync(new URL(name, fixtureFolder), "utf8");
/** Files as Obsidian saved them; the others are input we wrote for it to open. */
const saved = NodeFS.readdirSync(fixtureFolder).filter((name) => fixture(name).includes('\n\t"'));

describe("serializeCanvas", () => {
  it.each(saved)("writes %s back byte for byte", (name) => {
    expect(serializeCanvas(JSON.parse(fixture(name)))).toBe(fixture(name));
  });

  it("covers the formats the report names", () => {
    expect(saved).toEqual(
      expect.arrayContaining(["ed-format.after-edit.canvas", "hand-after-edit.canvas"]),
    );
  });

  it("keeps `{}` as it is and expands an empty container's parent", () => {
    expect(serializeCanvas({})).toBe("{}");
    expect(serializeCanvas({ nodes: [], edges: [] })).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
    expect(serializeCanvas({ c: { d: {} } })).toBe('{\n\t"c":{\n\t\t"d":{}\n\t}\n}');
  });
});

describe("diffCanvas", () => {
  const card = { id: "a", type: "text", text: "One", x: 0, y: 0, width: 250, height: 60 };
  const arrow = { id: "e", fromNode: "a", toNode: "b" };
  const other = { ...card, id: "b", text: "Two" };
  const marks = (before: unknown, after: unknown) =>
    diffCanvas(before, after).changes.map(({ id, item, mark, also }) => [id, item, mark, also]);

  it.each([
    ["a moved card", { x: 20 }, "moved", []],
    ["a resized card", { width: 300 }, "moved", []],
    ["a recoloured card", { color: "1" }, "restyled", []],
    ["new text", { text: "Uno" }, "text", []],
    ["a key it can't read", { note: true }, "text", []],
    ["text moved and recoloured", { text: "Uno", x: 1, color: "2" }, "text", ["restyled", "moved"]],
    ["a recoloured move", { x: 1, color: "2" }, "restyled", ["moved"]],
    ["a new style", { astrolabe: { style: { width: 4 } } }, "restyled", []],
    ["a new shape", { astrolabe: { shape: "ellipse" } }, "text", []],
  ])("reads %s", (_, change, mark, also) => {
    expect(marks({ nodes: [card] }, { nodes: [{ ...card, ...change }] })).toEqual([
      ["a", "card", mark, also],
    ]);
  });

  it.each([
    ["new pressure as what it says", { pressure: [0.9, 0.2] }, "text"],
    ["a hand-drawn look as its style", { astrolabe: { style: { sloppiness: 2 } } }, "restyled"],
    ["route as its style", { astrolabe: { style: { route: "elbow" } } }, "restyled"],
    [
      "bends as moved",
      { type: "arrow", from: { x: 0, y: 0 }, to: { x: 9, y: 9 }, bends: [4, 1] },
      "moved",
    ],
    [
      "heads as restyled",
      { type: "arrow", from: { x: 0, y: 0 }, to: { x: 9, y: 9 }, toEnd: "none" },
      "restyled",
    ],
  ])("reads a drawing's %s", (_, change, mark) => {
    const stroke = {
      id: "s",
      type: "stroke",
      x: 0,
      y: 0,
      points: [0, 0, 9, 9],
      pressure: [0.5, 0.5],
    };
    const drawn = (ink: object) => ({ nodes: [], astrolabe: { drawings: [ink] } });
    const before =
      "from" in change ? { id: "s", type: "arrow", from: change.from, to: change.to } : stroke;
    expect(marks(drawn(before), drawn({ ...before, ...change }))).toEqual([
      ["s", "drawing", mark, []],
    ]);
  });

  it("says a first order, which keys everything, once as order rather than as each card's change", () => {
    const before = {
      nodes: [card, other],
      edges: [{ ...arrow }],
      astrolabe: { drawings: [{ id: "s", type: "stroke", x: 0, y: 0, points: [0, 0] }] },
    };
    const keyed = (thing: object, z: string) => ({ ...thing, astrolabe: { z } });
    const after = {
      nodes: [keyed(other, "a1"), keyed(card, "a3")],
      edges: [keyed(arrow, "a0")],
      astrolabe: {
        drawings: [keyed({ id: "s", type: "stroke", x: 0, y: 0, points: [0, 0] }, "a2")],
      },
    };
    const diff = diffCanvas(before, after);
    expect(diff).toMatchObject({ changes: [], order: true, rest: false });
    expect(canvasChangeSummary(diff.changes, diff.order)).toBe("Order changed");
    // Keys that keep the order as it showed say nothing.
    const same = {
      ...after,
      nodes: [keyed(card, "a1"), keyed(other, "a3")],
      astrolabe: {
        drawings: [keyed({ id: "s", type: "stroke", x: 0, y: 0, points: [0, 0] }, "a4")],
      },
    };
    expect(diffCanvas(before, same)).toMatchObject({ changes: [], order: false });
    const moved = { ...after, nodes: [{ ...keyed(other, "a1"), x: 9 }, keyed(card, "a3")] };
    expect(canvasChangeSummary(diffCanvas(before, moved).changes, true)).toBe(
      "1 moved, order changed",
    );
  });

  it("matches by id, ignoring key order, and sees what's added and removed", () => {
    const reordered = { height: 60, width: 250, y: 0, x: 0, text: "One", type: "text", id: "a" };
    expect(marks({ nodes: [card] }, { nodes: [reordered] })).toEqual([]);
    expect(marks({ nodes: [card] }, { nodes: [other] })).toEqual([
      ["b", "card", "added", []],
      ["a", "card", "removed", []],
    ]);
  });

  it.each([
    ["a new label", { label: "why" }, "text"],
    ["a new target", { toNode: "c" }, "text"],
    ["a new colour", { color: "3" }, "restyled"],
    ["new ends", { toEnd: "none" }, "restyled"],
    ["new sides", { fromSide: "top" }, "moved"],
    ["a new style", { astrolabe: { style: { dash: "dotted" } } }, "restyled"],
  ])("reads an arrow with %s", (_, change, mark) => {
    expect(marks({ edges: [arrow] }, { edges: [{ ...arrow, ...change }] })).toEqual([
      ["e", "arrow", mark, []],
    ]);
  });

  it("counts a card type it can't draw, and what's outside the cards", () => {
    const unknown = { id: "u", type: "sticker", x: 0, y: 0, width: 1, height: 1 };
    expect(diffCanvas({ nodes: [unknown] }, { nodes: [{ ...unknown, shine: 1 }] })).toMatchObject({
      changes: [{ id: "u", mark: "text", name: "sticker card" }],
      rest: false,
    });
    expect(diffCanvas({ nodes: [], extra: 1 }, { nodes: [], extra: 2 }).rest).toBe(true);
  });

  it("names what changed and what it said before", () => {
    const text = (said: string) => ({ ...card, text: said });
    const [change] = diffCanvas(
      { nodes: [text("# Title\nOld line\nSame")] },
      { nodes: [text("# Title\nNew line\nSame")] },
    ).changes;
    expect(change).toMatchObject({ name: "Title", was: "Old line" });
    const [linked] = diffCanvas(
      { nodes: [card, other], edges: [] },
      { nodes: [card, other], edges: [{ ...arrow, label: "why" }] },
    ).changes;
    expect(linked).toMatchObject({ item: "arrow", name: "One → Two: why", was: null });
    const [plain] = diffCanvas(
      { nodes: [] },
      {
        nodes: [
          text("**Request** a `refund` via [[Pay|payments]], [the form](x) and ~~fax~~ _now_"),
        ],
      },
    ).changes;
    expect(plain?.name).toBe("Request a refund via payments, the form and fax now");
  });

  it("uses the ids the board draws under", () => {
    const repeated = { nodes: [card, { ...card, text: "Again" }] };
    const data = canvasData(repeated);
    const [change] = diffCanvas({ nodes: [card] }, repeated).changes;
    expect(data.nodes.map((node) => node.id)).toContain(change?.id);
  });
});

describe("reviewCanvas", () => {
  const card = { id: "a", type: "text", text: "One", x: 0, y: 0, width: 250, height: 60 };
  const gone = { ...card, id: "gone", text: "Gone" };
  const kept = { ...card, id: "kept", x: 300 };
  const stroke = (id: string, x = 0) => ({ id, type: "stroke", x, y: 0, points: [0, 0, 9, 9] });
  const story = { title: "Tour", steps: [{ note: "Start", cards: ["a"] }] };
  const before = {
    nodes: [card, gone, kept],
    edges: [
      { id: "ag", fromNode: "a", toNode: "gone" },
      { id: "ak", fromNode: "a", toNode: "kept" },
    ],
    astrolabe: {
      stories: [story],
      drawings: [
        stroke("still"),
        stroke("rubbed"),
        { id: "pointer", type: "arrow", from: { node: "gone", side: "top" }, to: { x: 0, y: 0 } },
      ],
    },
  };
  const after = {
    nodes: [{ ...card, text: "Uno" }, kept, { ...card, id: "new" }],
    edges: [{ id: "ak", fromNode: "a", toNode: "kept", color: "1" }],
    astrolabe: { stories: [story], drawings: [stroke("still", 40), stroke("scribble")] },
  };

  it("draws the new version with what it removed beneath, marked", () => {
    const review = reviewCanvas(before, after);
    expect(review.data.nodes.map((node) => node.id)).toEqual(["gone", "a", "kept", "new"]);
    expect(review.data.edges.map((edge) => edge.id)).toEqual(["ak", "ag"]);
    expect(review.data.drawings?.map((ink) => ink.id)).toEqual([
      "still",
      "scribble",
      "rubbed",
      "pointer",
    ]);
    expect(review.marks).toEqual({
      cards: { a: "text", new: "added", gone: "removed" },
      arrows: { ak: "restyled", ag: "removed" },
      drawings: { still: "moved", scribble: "added", rubbed: "removed", pointer: "removed" },
    });
    expect(review.changes.filter((change) => change.item === "drawing")).toMatchObject([
      { id: "still", name: "Drawing" },
      { id: "scribble" },
      { id: "rubbed" },
      { id: "pointer", name: "Gone → a point" },
    ]);
    expect(review.changes.every((change) => change.drawn)).toBe(true);
    expect(review.rest).toBe(false);
  });

  it("says when a change can't be found on the board", () => {
    const unknown = { id: "u", type: "sticker" };
    const review = reviewCanvas({ nodes: [] }, { nodes: [unknown] });
    expect(review.changes).toMatchObject([{ id: "u", drawn: false }]);
  });

  it("treats a file added or deleted as all added or all removed", () => {
    const review = (was: string | null, now: string | null) => {
      const result = reviewCanvasFiles(was, now);
      if ("invalid" in result) throw new Error(result.invalid);
      return canvasChangeSummary(result.changes);
    };
    expect(review(null, JSON.stringify(before))).toBe("8 added");
    expect(review(JSON.stringify(before), null)).toBe("8 removed");
  });

  it("says which version it can't read", () => {
    expect(reviewCanvasFiles("{ nope", "{}")).toMatchObject({
      invalid: expect.stringContaining("before this change"),
    });
    expect(reviewCanvasFiles("{}", "{ nope")).toMatchObject({
      invalid: expect.stringContaining("This change's version"),
    });
  });

  it("folds moves below what to read first", () => {
    const changes = [{ mark: "moved" }, { mark: "text" }, { mark: "added" }] as const;
    expect(canvasChangeSections(changes)).toEqual({
      changed: [{ mark: "added" }, { mark: "text" }],
      moved: [{ mark: "moved" }],
    });
    expect(canvasChangeSummary(changes)).toBe("1 added, 1 changed, 1 moved");
  });
});

describe("parseCanvas", () => {
  it("leaves out a drawn arrow on a node the board doesn't have, which the file keeps", () => {
    const parsed = parseCanvas(
      JSON.stringify({
        nodes: [{ id: "here", type: "text", text: "Here" }],
        astrolabe: {
          drawings: [
            { id: "lost", type: "arrow", from: { node: "gone", side: "top" }, to: { x: 0, y: 0 } },
            { id: "kept", type: "arrow", from: { node: "here", side: "top" }, to: { x: 0, y: 0 } },
          ],
        },
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.drawings?.map((ink) => ink.id)).toEqual(["kept"]);
  });

  it("keeps what doesn't draw in the document, and writes it back", () => {
    const parsed = parseCanvas(fixture("survive-input.canvas"));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.nodes.map((node) => node.id)).toEqual([
      "mover",
      "fracstill",
      "link",
      "linkedge",
    ]);
    const rewritten = JSON.parse(serializeCanvas(parsed.document));
    expect(rewritten).toEqual(JSON.parse(fixture("survive-input.canvas")));
    expect(Object.keys(rewritten)).toEqual(["extra", "nodes", "edges", "zzz"]);
  });

  it("is saved back by Obsidian with a card's and an arrow's nested objects, where order keys live", () => {
    // Obsidian opened survive-input, moved a card and saved: it keeps the objects nested in a
    // link card and an edge, though it drops a card type it doesn't know and the edge to it.
    const was = JSON.parse(fixture("survive-input.canvas"));
    const now = JSON.parse(fixture("survive-after-move-edit.canvas"));
    const find = (list: ReadonlyArray<Record<string, unknown>>, id: string) =>
      list.find((each) => each.id === id);
    expect(find(now.nodes, "link")).toMatchObject({
      astrolabe: find(was.nodes, "link")!.astrolabe,
    });
    expect(find(now.edges, "e1")).toMatchObject({ meta: { a: 1 }, style: "dashed" });
    expect(Object.keys(now)).toEqual(["extra", "nodes", "edges", "zzz"]);
  });

  it.each([
    ["empty text", "", 0],
    ["whitespace", " \n", 0],
    ["an empty object", "{}", 0],
    ["an array", "[1,2,3]", 0],
    ["no edges", '{"nodes":[{"id":"a","type":"text","text":"t"}]}', 1],
    ["no nodes", '{"edges":[]}', 0],
  ])("opens %s", (_name, source, count) => {
    const parsed = parseCanvas(source);
    expect(parsed.ok && parsed.data.nodes.length).toBe(count);
  });

  it("reads a style beside a shape, leaving what it can't use for the file to keep", () => {
    const style = {
      fill: "none",
      width: 4,
      dash: "dotted",
      corners: "round",
      opacity: 0.5,
      sloppiness: 2,
      route: "elbow",
    };
    const card = {
      id: "a",
      type: "text",
      text: "t",
      astrolabe: { shape: "diamond", style: { ...style, glow: 2, width: -1 } },
    };
    const stroke = { id: "s", type: "stroke", x: 0, y: 0, points: [0, 0], astrolabe: { style } };
    const group = {
      id: "g",
      type: "group",
      astrolabe: { style: { dash: "wavy", sloppiness: 3, route: "wiggly" } },
    };
    const document = {
      nodes: [card, group],
      edges: [{ id: "e", fromNode: "a", toNode: "g", astrolabe: { style: { opacity: 2 } } }],
      astrolabe: { drawings: [stroke] },
    };
    const data = canvasData(document);
    const { width: _bad, ...kept } = style;
    expect(data.nodes[0]).toMatchObject({ astrolabe: { shape: "diamond", style: kept } });
    expect(data.nodes[1]).not.toHaveProperty("astrolabe");
    expect(data.edges[0]).not.toHaveProperty("astrolabe");
    expect(data.drawings?.[0]).toMatchObject({ astrolabe: { style } });
    expect(JSON.parse(serializeCanvas(document))).toEqual(document);
  });

  it("reads a stroke's pressure only when it has one for each point, each 0 to 1", () => {
    const stroke = (id: string, pressure: unknown) => ({
      id,
      type: "stroke",
      x: 0,
      y: 0,
      points: [0, 0, 4, 4, 8, 8],
      pressure,
    });
    const document = {
      nodes: [],
      astrolabe: {
        drawings: [
          stroke("pen", [0.2, 0.5, 1]),
          stroke("short", [0.2, 0.5]),
          stroke("over", [0.2, 0.5, 1.5]),
          stroke("text", "hard"),
        ],
      },
    };
    const drawings = canvasData(document).drawings ?? [];
    expect(drawings.map((ink) => (ink.type === "stroke" ? ink.pressure : null))).toEqual([
      [0.2, 0.5, 1],
      undefined,
      undefined,
      undefined,
    ]);
    expect(JSON.parse(serializeCanvas(document))).toEqual(document);
  });

  it("reads a drawn arrow's heads, bends and ends anywhere on a card, as an older one if they don't hold", () => {
    const arrow = (id: string, keys: Record<string, unknown>) => ({
      id,
      type: "arrow",
      from: { node: "a", side: "right" },
      to: { x: 300, y: 40 },
      ...keys,
    });
    const document = {
      nodes: [{ id: "a", type: "text", text: "A", x: 0, y: 0, width: 200, height: 100 }],
      astrolabe: {
        drawings: [
          arrow("line", { fromEnd: "arrow", toEnd: "none", bends: [100, 200, 150, 220] }),
          arrow("anywhere", { from: { node: "a", side: "bottom", at: [0.25, 1] } }),
          arrow("odd", {
            fromEnd: "dot",
            bends: [1, 2, 3],
            from: { node: "a", side: "top", at: [2, 0] },
          }),
          arrow("old", {}),
        ],
      },
    };
    const [line, anywhere, odd, old] = canvasData(document).drawings ?? [];
    expect(line).toMatchObject({ fromEnd: "arrow", toEnd: "none", bends: [100, 200, 150, 220] });
    expect(anywhere).toMatchObject({ from: { node: "a", side: "bottom", at: [0.25, 1] } });
    expect(odd).toEqual(arrow("odd", { from: { node: "a", side: "top" } }));
    expect(old).toEqual(arrow("old", {}));
    expect(canvasInkBounds(line!, new Map([["a", document.nodes[0]!]]))).toEqual({
      x: 100,
      y: 40,
      width: 200,
      height: 180,
    });
    expect(JSON.parse(serializeCanvas(document))).toEqual(document);
  });

  it("puts an end anywhere on a card where it follows the card, moved or resized", () => {
    const end = { node: "a", side: "bottom", at: [0.25, 1] } as const;
    const card = { x: 0, y: 0, width: 200, height: 100 };
    expect(canvasInkEnd(end, new Map([["a", card]]))).toEqual({ x: 50, y: 100 });
    const moved = { x: 40, y: -20, width: 400, height: 50 };
    expect(canvasInkEnd(end, new Map([["a", moved]]))).toEqual({ x: 140, y: 30 });
    expect(canvasInkEnd({ node: "a", side: "bottom" }, new Map([["a", moved]]))).toEqual({
      x: 240,
      y: 30,
    });
  });

  it("refuses only text that isn't JSON", () => {
    expect(parseCanvas("{nope").ok).toBe(false);
  });

  it("draws a card the file left incomplete", () => {
    const { nodes } = canvasData({
      nodes: [{ type: "text" }, { id: "a", type: "file", x: "1" }, "junk"],
    });
    expect(nodes[0]).toMatchObject({ id: "node-0", text: "", x: 0, width: 100, height: 100 });
    expect(nodes[1]).toMatchObject({ id: "a", file: "", x: 0 });
    expect(nodes).toHaveLength(2);
  });

  it("gives repeated ids distinct keys, keeping both cards", () => {
    const parsed = parseCanvas(fixture("bad-dup-id.afterclose.canvas"));
    expect(parsed.ok && parsed.data.nodes.map((node) => node.id)).toEqual(["a", "a~1"]);
  });

  it("reads a pinned base view, and a code card's reference", () => {
    const parsed = parseCanvas(fixture("base-pinned.canvas"));
    expect(parsed.ok && parsed.data.nodes[0]).toMatchObject({ type: "file" });
    const { nodes } = canvasData({
      nodes: [
        {
          id: "c",
          type: "link",
          url: "https://x.test",
          astrolabe: { code: { path: "a.ts", lines: [1, 2], commit: "abc" } },
        },
      ],
    });
    expect(nodes[0]).toMatchObject({
      astrolabe: { code: { path: "a.ts", lines: [1, 2], commit: "abc" } },
    });
  });
});

describe("canvas links", () => {
  const data = canvasData({
    nodes: [
      { id: "a", type: "text", text: "[[Ghost]] and ![[Alpha#Top]]" },
      { id: "b", type: "file", file: "Beta.md", subpath: "#H" },
      { id: "c", type: "file", file: "Board.canvas" },
      { id: "d", type: "link", url: "https://x.test" },
    ],
    edges: [{ id: "e", fromNode: "b", toNode: "c" }],
  });

  it("reads text cards and file cards, and never arrows", () => {
    expect(canvasLinks(data)).toEqual([
      { target: "Ghost", card: "text" },
      { target: "Alpha", card: "text" },
      { target: "Beta", card: "file" },
      { target: "Board.canvas", card: "file" },
    ]);
  });
});

describe("renameInCanvas", () => {
  const rename = {
    path: (file: string) => (file === "~/N1.md" ? "~/N1r.md" : null),
    link: (target: string) => (target === "~/N1" ? "~/N1r" : null),
  };

  it("matches what Obsidian saves", () => {
    expect(renameInCanvas(fixture("links-on-deleteNote-closed.canvas"), rename)).toBe(
      fixture("links-on-renameNote-open.canvas"),
    );
  });

  it("follows a group's background by its whole path", () => {
    const source = '{"nodes":[{"id":"g","type":"group","background":"a/pic.png"}],"edges":[]}';
    const next = renameInCanvas(source, {
      path: (file) => (file === "a/pic.png" ? "a/new.png" : null),
      link: () => null,
    });
    expect(JSON.parse(next).nodes[0].background).toBe("a/new.png");
  });

  it("leaves a file with nothing to rename in the bytes it had", () => {
    const source = fixture("hand-before-edit.canvas");
    expect(renameInCanvas(source, rename)).toBe(source);
    expect(renameInCanvas("{nope", rename)).toBe("{nope");
  });

  it("keeps a card's other keys and their order", () => {
    const next = renameInCanvas(
      '{"nodes":[{"keep":1,"id":"a","type":"file","file":"~/N1.md","subpath":"#H","x":0}]}',
      rename,
    );
    expect(Object.keys(JSON.parse(next).nodes[0])).toEqual([
      "keep",
      "id",
      "type",
      "file",
      "subpath",
      "x",
    ]);
  });
});

describe("canvasOutline", () => {
  const data = canvasData({
    nodes: [
      { id: "outer", type: "group", label: "Outer", x: 0, y: 0, width: 500, height: 500 },
      { id: "inner", type: "group", label: "Inner", x: 10, y: 10, width: 200, height: 200 },
      { id: "a", type: "text", text: "first\nsecond", x: 20, y: 20, width: 50, height: 50 },
      {
        id: "b",
        type: "file",
        file: "Note.md",
        subpath: "#Top",
        x: 300,
        y: 300,
        width: 50,
        height: 50,
      },
      {
        id: "c",
        type: "text",
        text: "half out",
        x: 480,
        y: 0,
        width: 50,
        height: 50,
        astrolabe: { shape: "ellipse" },
      },
    ],
    edges: [
      {
        id: "e",
        fromNode: "a",
        toNode: "b",
        label: "uses",
        fromEnd: "arrow",
        astrolabe: { style: { route: "elbow" } },
      },
    ],
    astrolabe: {
      drawings: [
        { id: "s", type: "stroke", x: 0, y: 0, points: [0, 0, 10, 10] },
        { id: "f", type: "arrow", from: { x: 0, y: 0 }, to: { node: "a", side: "top" } },
      ],
      stories: [
        {
          title: "Tour",
          steps: [
            { note: "Start inside.", group: "inner" },
            { label: "Then", note: "Out to the note.", cards: ["a", "b"] },
          ],
        },
      ],
    },
  });

  it("files cards under the smallest group wholly holding them, with no coordinates, and no old stories", () => {
    expect(canvasOutline("Board.canvas", data)).toBe(
      [
        "Board.canvas: 3 cards, 2 groups, 1 arrow.",
        "2 hand drawings, not listed.",
        "[c] (ellipse) half out",
        "",
        "Group [outer] Outer",
        "[b] File: Note.md#Top",
        "",
        "Group [inner] Inner",
        "[a] first",
        "  second",
        "",
        "Arrows",
        "[a] <-> [b] (elbow): uses",
      ].join("\n"),
    );
  });

  it("says which card is on top where cards overlap, and the drawings each is over or under", () => {
    const box = (id: string, x: number, z?: string) => ({
      id,
      type: "text",
      text: id,
      x,
      y: 0,
      width: 100,
      height: 100,
      ...(z === undefined ? {} : { astrolabe: { z } }),
    });
    const outline = canvasOutline(
      "Board.canvas",
      canvasData({
        nodes: [box("under", 0, "a2"), box("over", 50, "a3"), box("alone", 500, "a1")],
        edges: [],
        astrolabe: {
          drawings: [
            {
              id: "s",
              type: "stroke",
              x: 60,
              y: 10,
              points: [0, 0, 10, 10],
              astrolabe: { z: "a4" },
            },
            {
              id: "t",
              type: "stroke",
              x: 510,
              y: 10,
              points: [0, 0, 10, 10],
              astrolabe: { z: "a0" },
            },
          ],
        },
      }),
    );
    expect(outline.split("\n").slice(-4)).toEqual([
      "Overlapping",
      "[alone] over a drawing",
      "[under] under a drawing",
      "[over] over [under], under a drawing",
    ]);
  });

  it("says what's wrong with a file that isn't JSON, and shows it", () => {
    expect(canvasSourceOutline("Board.canvas", "{nope")).toContain("{nope");
  });
});

const overlap = (a: CanvasBounds, b: CanvasBounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const contains = (outer: CanvasBounds, inner: CanvasBounds) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const cards = (...ids: string[]) => ids.map((id) => ({ id, text: id }));

const positionOf = (drawing: CanvasDrawing, id: string) => {
  const node = placeCanvas(drawing).nodes.find((each) => each.id === id);
  if (node === undefined) throw new Error(`No node ${id}`);
  return node;
};

describe("placeCanvas", () => {
  it("draws the same board from the same drawing", () => {
    const drawing: CanvasDrawing = {
      cards: cards("a", "b", "c", "d"),
      arrows: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    };
    expect(placeCanvas(drawing)).toEqual(placeCanvas(drawing));
  });

  it("places cards downstream of what points at them, whichever way the board runs", () => {
    const drawing: CanvasDrawing = {
      cards: cards("end", "middle", "start"),
      arrows: [
        { from: "start", to: "middle" },
        { from: "middle", to: "end" },
      ],
    };
    const start = positionOf(drawing, "start");
    const middle = positionOf(drawing, "middle");
    const end = positionOf(drawing, "end");
    expect(start.x + start.y).toBeLessThan(middle.x + middle.y);
    expect(middle.x + middle.y).toBeLessThan(end.x + end.y);
  });

  it("runs on Hermes, the phone's engine, which has no toSorted or toReversed", () => {
    const { toSorted, toReversed } = Array.prototype;
    const prototype = Array.prototype as unknown as Record<string, unknown>;
    delete prototype.toSorted;
    delete prototype.toReversed;
    try {
      const { nodes } = placeCanvas({
        cards: cards("a", "b", "c"),
        arrows: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
        ],
      });
      expect(nodes).toHaveLength(3);
    } finally {
      prototype.toSorted = toSorted;
      prototype.toReversed = toReversed;
    }
  });

  it("starts a cycle at the first card written, even when a later one is in a group", () => {
    const drawing: CanvasDrawing = {
      cards: [
        { id: "client", text: "Client" },
        { id: "service", text: "Service", group: "server" },
        { id: "git", text: "Git" },
      ],
      groups: [{ id: "server" }],
      arrows: [
        { from: "client", to: "service" },
        { from: "service", to: "git" },
        { from: "git", to: "client" },
      ],
    };
    const client = positionOf(drawing, "client");
    const server = positionOf(drawing, "server");
    const git = positionOf(drawing, "git");
    expect(client.x + client.y).toBeLessThan(server.x + server.y);
    expect(server.x + server.y).toBeLessThan(git.x + git.y);
  });

  it("draws an empty group rather than dropping what the agent named", () => {
    const { nodes } = placeCanvas({ cards: cards("a"), groups: [{ id: "empty", label: "Empty" }] });
    expect(nodes.map((node) => node.id).toSorted()).toEqual(["a", "empty"]);
  });

  it("never overlaps cards, in flows, cycles, fans and loose grids", () => {
    const ids = Array.from({ length: 60 }, (_, index) => `c${index}`);
    const drawing: CanvasDrawing = {
      cards: ids.map((id, index) => ({ id, text: "word ".repeat(index + 1) })),
      arrows: [
        ...ids.slice(1, 30).map((id) => ({ from: "c0", to: id })),
        { from: "c29", to: "c0" },
        { from: "c30", to: "c31" },
      ],
    };
    const { nodes } = placeCanvas(drawing);
    expect(nodes).toHaveLength(60);
    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id !== b.id) expect(overlap(a, b), `${a.id} and ${b.id}`).toBe(false);
      }
    }
  });

  it("keeps a group's cards inside it and clear of everything else", () => {
    const drawing: CanvasDrawing = {
      cards: [
        { id: "in", text: "Inbound", group: "server" },
        { id: "out", text: "Outbound", group: "server" },
        { id: "client", text: "Client" },
      ],
      groups: [{ id: "server", label: "Server" }],
      arrows: [
        { from: "client", to: "in" },
        { from: "in", to: "out" },
      ],
    };
    const { nodes } = placeCanvas(drawing);
    const group = nodes.find((node) => node.id === "server");
    const client = nodes.find((node) => node.id === "client");
    if (group === undefined || client === undefined) throw new Error("Missing node");
    for (const id of ["in", "out"]) {
      const card = nodes.find((node) => node.id === id);
      if (card === undefined) throw new Error("Missing card");
      expect(contains(group, card)).toBe(true);
    }
    expect(overlap(group, client)).toBe(false);
    expect(nodes[0]?.id, "groups draw beneath their cards").toBe("server");
  });

  it("writes spec JSON: whole numbers, preset colours and arrow ends", () => {
    const { nodes, edges } = placeCanvas({
      cards: [
        { id: "a", text: "A", color: "red" },
        { id: "b", text: "B" },
      ],
      arrows: [
        { from: "a", to: "b", ends: "both", label: "calls", color: "cyan", route: "elbow" },
        { from: "b", to: "a", ends: "none", route: "curved" },
      ],
    });
    expect(nodes[0]?.color).toBe("1");
    for (const node of nodes) {
      for (const value of [node.x, node.y, node.width, node.height]) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
    expect(edges[0]).toMatchObject({
      fromEnd: "arrow",
      label: "calls",
      color: "5",
      astrolabe: { style: { route: "elbow" } },
    });
    expect(edges[1]).toMatchObject({ toEnd: "none" });
    // Curved is what an arrow is with nothing said.
    expect(edges[1]).not.toHaveProperty("astrolabe");
  });

  it("keeps a code card's path and lines, and leaves its link for saving", () => {
    const { nodes } = placeCanvas({
      cards: [
        { id: "a", path: "src/a.ts", line: 10, endLine: 20, text: "The merge" },
        { id: "b", path: "src/b.ts", line: 7 },
      ],
    });
    expect(nodes[0]).toMatchObject({
      type: "link",
      url: "",
      astrolabe: { caption: "The merge", code: { path: "src/a.ts", lines: [10, 20] } },
    });
    expect(nodes[1]).toMatchObject({ astrolabe: { code: { lines: [7, 7] } } });
  });

  it("leaves out arrows to cards the drawing doesn't hold", () => {
    const { edges } = placeCanvas({
      cards: cards("a"),
      arrows: [{ from: "a", to: "missing" }],
    });
    expect(edges).toEqual([]);
  });

  describe("lanes and frames", () => {
    it("lays groups out as lanes, with the arrows deciding the columns", () => {
      const drawing: CanvasDrawing = {
        cards: [
          { id: "form", text: "Form", group: "browser" },
          { id: "cookie", text: "Cookie", group: "browser" },
          { id: "login", text: "POST /login", group: "server" },
          { id: "check", text: "Check the hash", group: "server" },
          { id: "users", text: "Users table", group: "store" },
          { id: "sessions", text: "Sessions", group: "store" },
        ],
        groups: [
          { id: "browser", label: "Browser" },
          { id: "server", label: "API" },
          { id: "store", label: "Storage" },
        ],
        arrows: [
          { from: "form", to: "login" },
          { from: "login", to: "users" },
          { from: "users", to: "check" },
          { from: "check", to: "sessions" },
          { from: "sessions", to: "cookie" },
        ],
        layout: { kind: "lanes" },
      };
      expect(canvasLayoutKind({ ...drawing, layout: undefined })).toBe("map");
      const board = placeCanvas(drawing);
      const at = new Map(board.nodes.map((node) => [node.id, node]));
      // Each lane is a band, top to bottom in order, holding its own cards.
      const lanes = ["browser", "server", "store"].map((id) => at.get(id)!);
      expect(lanes.map((lane) => lane.y)).toEqual(
        lanes.map((lane) => lane.y).sort((a, b) => a - b),
      );
      for (const card of drawing.cards)
        expect(contains(at.get(card.group!)!, at.get(card.id)!)).toBe(true);
      // Each card sits a column after the card that points at it, whatever its lane.
      const order = ["form", "login", "users", "check", "sessions", "cookie"];
      const xs = order.map((id) => at.get(id)!.x);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      expect(new Set(xs).size).toBe(order.length);
      // Every lane is a frame a link can name.
      expect(canvasFrame(board, "storage")?.id).toBe("store");
      expect(canvasData(canvasDocument(board))).toEqual(board);
      const cards = board.nodes.filter((node) => node.type !== "group");
      for (const a of cards) {
        for (const b of cards)
          if (a.id !== b.id) expect(overlap(a, b), `${a.id} and ${b.id}`).toBe(false);
      }
    });

    it("finds a frame by its group's label ignoring case, else by id, and its cards", () => {
      const card = (id: string, x: number) => ({
        id,
        type: "text",
        text: id,
        x,
        y: 40,
        width: 100,
        height: 60,
      });
      const data = canvasData({
        nodes: [
          { id: "g", type: "group", label: "Checkout Flow", x: 0, y: 0, width: 400, height: 140 },
          { id: "h", type: "group", x: 600, y: 0, width: 200, height: 140 },
          card("a", 20),
          card("b", 200),
          card("c", 620),
        ],
      });
      expect(canvasFrame(data, " checkout flow ")?.id).toBe("g");
      expect(canvasFrame(data, "H")?.id).toBe("h");
      expect(canvasFrame(data, "Missing")).toBeUndefined();
      expect(canvasFrame(data, "")).toBeUndefined();
      expect([...canvasFrameCards(data, canvasFrame(data, "Checkout Flow")!)].sort()).toEqual([
        "a",
        "b",
      ]);
    });

    it.each([
      ["Checkout Flow", "Checkout Flow.canvas"],
      ["  Auth: sign-in / out  ", "Auth sign-in out.canvas"],
      ["[[Weird]] #title|x", "Weird title x.canvas"],
      ["Board.canvas", "Board.canvas"],
      ["...", "Canvas.canvas"],
      ["", "Canvas.canvas"],
    ])("names a canvas titled %j as %s", (title, file) => {
      expect(canvasFileName(title)).toBe(file);
    });

    it("numbers a title whose file name an earlier canvas already has, ignoring case", () => {
      expect(canvasUniqueTitle("Flow", [])).toBe("Flow");
      expect(canvasUniqueTitle("Flow", ["Other"])).toBe("Flow");
      expect(canvasUniqueTitle("flow", ["Flow"])).toBe("flow 2");
      expect(canvasUniqueTitle("Flow", ["Flow", "flow 2", "Flow: 3"])).toBe("Flow 4");
      expect(canvasNameKey(" Checkout Flow.CANVAS ")).toBe(canvasNameKey("checkout flow"));

      const longTitle = "A".repeat(105);
      const second = canvasUniqueTitle(longTitle, [longTitle]);
      expect(canvasNameKey(canvasFileName(second))).not.toBe(
        canvasNameKey(canvasFileName(longTitle)),
      );
      expect(second.endsWith(" 2")).toBe(true);
    });

    it("normalizes escaped newlines in card text while preserving code blocks and inline code", () => {
      const placed = placeCanvas({
        cards: [
          {
            id: "a",
            text: '### Heading\\n\\nBody line\\r\\nNext `fmt.Printf("\\n")`\\n```ts\\nconst s = "a\\\\nb";\\n```',
          },
        ],
      });
      const text = placed.nodes[0]?.type === "text" ? placed.nodes[0].text : "";
      expect(text).toBe(
        '### Heading\n\nBody line\nNext `fmt.Printf("\\n")`\n```ts\nconst s = "a\\\\nb";\n```',
      );
    });

    it("lists the embeds a board can be stitched in with: the whole of it, then each frame", () => {
      const data = canvasData({
        nodes: [
          { id: "g", type: "group", label: "Pay", x: 0, y: 0, width: 400, height: 140 },
          { id: "h", type: "group", label: "a|b", x: 600, y: 0, width: 200, height: 140 },
          { id: "u", type: "group", x: 900, y: 0, width: 200, height: 140 },
        ],
      });
      expect(canvasEmbeds("Flow.canvas", data)).toEqual([
        "![[Flow.canvas]]",
        "![[Flow.canvas#Pay]]",
        "![[Flow.canvas#h]]",
      ]);
    });

    it("reads an old file with stories as its board alone, and writes the stories back untouched", () => {
      const source = JSON.stringify({
        nodes: [
          { id: "g", type: "group", label: "Start", x: 0, y: 0, width: 300, height: 140 },
          { id: "a", type: "text", text: "A", x: 20, y: 40, width: 100, height: 60 },
        ],
        edges: [],
        astrolabe: {
          stories: [{ title: "Tour", steps: [{ note: "Here", cards: ["a"], heading: {} }] }],
        },
      });
      const parsed = parseCanvas(source);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.data).toEqual({ nodes: parsed.data.nodes, edges: [] });
      expect(canvasBounds(parsed.data)).toEqual({ x: 0, y: 0, width: 300, height: 140 });
      expect(canvasFrame(parsed.data, "start")?.id).toBe("g");
      expect(JSON.parse(serializeCanvas(parsed.document)).astrolabe.stories[0].title).toBe("Tour");
    });

    it("writes a board as a document that reads back the same", () => {
      const board = placeCanvas({
        cards: [
          { id: "a", text: "A", group: "g" },
          { id: "b", path: "src/b.ts", line: 3, endLine: 9, text: "B" },
          { id: "c", url: "https://example.com" },
        ],
        groups: [{ id: "g", label: "G" }],
        arrows: [{ from: "a", to: "b", label: "calls", ends: "both" }],
      });
      expect(canvasData(canvasDocument(board))).toEqual(board);
      expect(canvasDocument(board)).not.toHaveProperty("astrolabe");
    });
  });

  it("runs a long chain down the board, since across a chat column it would be a thin ribbon", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `c${index}`);
    const { width, height } = canvasBounds(
      placeCanvas({
        cards: cards(...ids),
        arrows: ids.slice(1).map((id, index) => ({ from: `c${index}`, to: id })),
      }),
    );
    expect(height).toBeGreaterThan(width);
  });

  it("normalizes double-escaped \\n line breaks in card text while preserving inline code and real newlines", () => {
    const { nodes } = placeCanvas({
      cards: [
        { id: "escaped", text: "**Title**\\nFirst line\\nSecond line" },
        { id: "code", text: "**Split**\\nUses `\\n` separator" },
        { id: "real", text: "**Title**\nKeep literal \\n when real newlines exist" },
      ],
    });
    const textOf = (id: string) => {
      const node = nodes.find((candidate) => candidate.id === id);
      return node?.type === "text" ? node.text : undefined;
    };
    expect(textOf("escaped")).toBe("**Title**\nFirst line\nSecond line");
    expect(textOf("code")).toBe("**Split**\nUses `\\n` separator");
    expect(textOf("real")).toBe("**Title**\nKeep literal \\n when real newlines exist");
  });
});

describe("canvasDrawingProblems", () => {
  it("accepts a drawing whose references all hold", () => {
    expect(
      canvasDrawingProblems({
        cards: [
          { id: "a", text: "A", group: "g" },
          { id: "b", path: "src/a.ts", line: 3, endLine: 9 },
          { id: "c", url: "https://example.com" },
        ],
        groups: [{ id: "g" }],
        arrows: [{ from: "a", to: "g" }],
      }),
    ).toEqual([]);
  });

  it.each([
    ["a repeated id", { cards: [...cards("a"), ...cards("a")] }, "used twice"],
    ["a group sharing a card's id", { cards: cards("a"), groups: [{ id: "a" }] }, "used twice"],
    ["an empty card", { cards: [{ id: "a" }] }, "needs text, url or path"],
    ["a link that is also code", { cards: [{ id: "a", url: "x", path: "y" }] }, "only be one"],
    ["an unknown group", { cards: [{ id: "a", text: "A", group: "g" }] }, "isn't in `groups`"],
    ["an absolute path", { cards: [{ id: "a", path: "/etc/passwd" }] }, "relative"],
    ["a Windows path", { cards: [{ id: "a", path: "C:\\x" }] }, "relative"],
    ["a path out of the repository", { cards: [{ id: "a", path: "src/../../x" }] }, "relative"],
    ["endLine alone", { cards: [{ id: "a", path: "x", endLine: 3 }] }, "without line"],
    ["a line zero", { cards: [{ id: "a", path: "x", line: 0 }] }, "before the first"],
    [
      "lines backwards",
      { cards: [{ id: "a", path: "x", line: 9, endLine: 3 }] },
      "before it starts",
    ],
    ["an unknown arrow end", { cards: cards("a"), arrows: [{ from: "a", to: "b" }] }, "isn't here"],
  ] satisfies ReadonlyArray<readonly [string, CanvasDrawing, string]>)(
    "refuses %s",
    (_name, drawing, problem) => {
      expect(canvasDrawingProblems(drawing).join(" ")).toContain(problem);
    },
  );

  it("doesn't mistake a double dot in a name for leaving the repository", () => {
    expect(canvasDrawingProblems({ cards: [{ id: "a", path: "src/a..b.ts" }] })).toEqual([]);
  });
});

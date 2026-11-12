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
  canvasLayoutKind,
  canvasSteps,
  diffCanvas,
  parseCanvas,
  placeCanvas,
  reviewCanvas,
  reviewCanvasFiles,
  serializeCanvas,
  type CanvasBounds,
  type CanvasData,
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
  ])("reads %s", (_, change, mark, also) => {
    expect(marks({ nodes: [card] }, { nodes: [{ ...card, ...change }] })).toEqual([
      ["a", "card", mark, also],
    ]);
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
  const before = {
    nodes: [card, gone, kept],
    edges: [
      { id: "ag", fromNode: "a", toNode: "gone" },
      { id: "ak", fromNode: "a", toNode: "kept" },
    ],
  };
  const after = {
    nodes: [{ ...card, text: "Uno" }, kept, { ...card, id: "new" }],
    edges: [{ id: "ak", fromNode: "a", toNode: "kept", color: "1" }],
  };

  it("draws the new version with what it removed beneath, marked", () => {
    const review = reviewCanvas(before, after);
    expect(review.data.nodes.map((node) => node.id)).toEqual(["gone", "a", "kept", "new"]);
    expect(review.data.edges.map((edge) => edge.id)).toEqual(["ak", "ag"]);
    expect(review.marks).toEqual({
      cards: { a: "text", new: "added", gone: "removed" },
      arrows: { ak: "restyled", ag: "removed" },
    });
    expect(review.changes.every((change) => change.drawn)).toBe(true);
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
    expect(review(null, JSON.stringify(before))).toBe("5 added");
    expect(review(JSON.stringify(before), null)).toBe("5 removed");
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
    edges: [{ id: "e", fromNode: "a", toNode: "b", label: "uses", fromEnd: "arrow" }],
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

  it("files cards under the smallest group wholly holding them, with no coordinates, then its stories", () => {
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
        "[a] <-> [b]: uses",
        "",
        "Story: Tour",
        "1. [inner] Start inside.",
        "2. [a] [b] Then. Out to the note.",
      ].join("\n"),
    );
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
        { from: "a", to: "b", ends: "both", label: "calls", color: "cyan" },
        { from: "b", to: "a", ends: "none" },
      ],
    });
    expect(nodes[0]?.color).toBe("1");
    for (const node of nodes) {
      for (const value of [node.x, node.y, node.width, node.height]) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
    expect(edges[0]).toMatchObject({ fromEnd: "arrow", label: "calls", color: "5" });
    expect(edges[1]).toMatchObject({ toEnd: "none" });
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

  describe("stories", () => {
    const step = (name: string, ...ids: string[]) => ({ note: `Step ${name}`, cards: ids });
    const story = (...steps: ReturnType<typeof step>[]) => ({ title: "Story", steps });
    const lit = (drawing: CanvasDrawing, at = 0) =>
      canvasSteps(placeCanvas(drawing), at).map((each) => [each.note, [...each.cards].sort()]);
    const positions = (data: CanvasData) =>
      data.nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));

    it("walks a story's steps in the order they were written", () => {
      expect(
        lit({
          cards: cards("a", "b", "c"),
          stories: [story(step("two", "c"), step("one", "a", "b"))],
        }),
      ).toEqual([
        ["Step two", ["c"]],
        ["Step one", ["a", "b"]],
      ]);
    });

    it("frames a card shared by neighbours in both steps, and docks one from far back", () => {
      // `s` is shared by neighbours; `a` comes back three steps later.
      const shared: CanvasDrawing = {
        cards: cards("a", "b", "c", "d", "e", "f", "s"),
        stories: [
          story(
            step("1", "a", "s"),
            step("2", "s", "b"),
            step("3", "c", "d"),
            step("4", "e", "a"),
            step("5", "f"),
          ),
        ],
      };
      const board = placeCanvas(shared);
      const walked = canvasSteps(board);
      const s = board.nodes.find((node) => node.id === "s");
      if (s === undefined) throw new Error("s isn't on the board");
      expect(walked.map((each) => contains(each.frame, s))).toEqual([
        true,
        true,
        false,
        false,
        false,
      ]);
      expect(walked[0]?.docked.size).toBe(0);
      expect(walked[1]?.docked.size).toBe(0);

      // During step 4, `a` stands beside its frame rather than three steps away.
      const fourth = walked[3];
      const docked = fourth?.docked.get("a");
      if (fourth === undefined || docked === undefined) throw new Error("a isn't docked");
      expect(docked.from).toBe(0);
      expect(overlap(docked, fourth.frame)).toBe(false);
      expect(contains(fourth.bounds, docked)).toBe(true);
      const whole = canvasBounds(board);
      expect(fourth.bounds.width * fourth.bounds.height).toBeLessThan(whole.width * whole.height);
    });

    it("lets later stories, and stories on a map, walk the board without moving a card", () => {
      const first = story(step("1", "a", "b"), step("2", "c"));
      const second = { title: "Backwards", steps: [step("x", "c"), step("y", "a")] };
      const walk: CanvasDrawing = { cards: cards("a", "b", "c"), stories: [first] };
      const both = placeCanvas({ ...walk, stories: [first, second] });
      expect(positions(both)).toEqual(positions(placeCanvas(walk)));
      expect(both.stories?.map((each) => each.title)).toEqual(["Story", "Backwards"]);
      expect(lit({ ...walk, stories: [first, second] }, 1)).toEqual([
        ["Step x", ["c"]],
        ["Step y", ["a"]],
      ]);

      const map: CanvasDrawing = {
        cards: [{ id: "a", text: "A", group: "g" }, ...cards("b", "c")],
        groups: [{ id: "g", label: "G" }],
        arrows: [{ from: "a", to: "b" }],
      };
      expect(
        positions(placeCanvas({ ...map, layout: { kind: "map" }, stories: [second] })),
      ).toEqual(positions(placeCanvas(map)));
    });

    it("lays a story told across groups out in lanes, each step a named column no card has to leave", () => {
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
          { from: "check", to: "sessions" },
          { from: "sessions", to: "cookie" },
        ],
        stories: [
          story(
            step("submit", "form", "login"),
            step("find", "login", "users"),
            step("check", "check", "users"),
            step("session", "check", "sessions", "cookie"),
          ),
        ],
      };
      const board = placeCanvas(drawing);
      const at = new Map(board.nodes.map((node) => [node.id, node]));
      // Each lane is a band, top to bottom in order, holding its own cards.
      const lanes = ["browser", "server", "store"].map((id) => at.get(id)!);
      expect(lanes.map((lane) => lane.y)).toEqual(
        lanes.map((lane) => lane.y).sort((a, b) => a - b),
      );
      for (const card of drawing.cards)
        expect(contains(at.get(card.group!)!, at.get(card.id)!)).toBe(true);
      // Cards share the column of the first step that shows them.
      expect(at.get("form")!.x).toBe(at.get("login")!.x);
      expect(at.get("sessions")!.x).toBe(at.get("cookie")!.x);
      expect(at.get("users")!.x).toBeGreaterThan(at.get("login")!.x);
      expect(canvasSteps(board).map((each) => each.docked.size)).toEqual([0, 0, 0, 0]);
      // Each step is named above the column of the cards it brings, clear of every lane.
      const headings = canvasSteps(board).map((each) => each.heading);
      expect(headings.map((each) => each?.x)).toEqual(
        ["form", "users", "check", "sessions"].map((id) => at.get(id)!.x),
      );
      const firstLane = Math.min(...lanes.map((lane) => lane.y));
      for (const heading of headings) expect(heading!.y + heading!.height).toBeLessThan(firstLane);
      expect(canvasBounds(board).y).toBe(Math.min(...headings.map((each) => each!.y)));
      expect(canvasData(canvasDocument(board))).toEqual(board);
      const cards = board.nodes.filter((node) => node.type !== "group");
      for (const a of cards) {
        for (const b of cards)
          if (a.id !== b.id) expect(overlap(a, b), `${a.id} and ${b.id}`).toBe(false);
      }
    });

    it("says where a card it brings in comes from: an earlier step, or its group on the map", () => {
      const card = (id: string, x: number) => ({
        id,
        type: "text",
        text: id,
        x,
        y: 0,
        width: 100,
        height: 60,
      });
      const data = canvasData({
        nodes: [
          { id: "g", type: "group", label: "Store", x: 1960, y: -40, width: 400, height: 140 },
          card("a", 0),
          card("b", 1000),
          card("c", 2000),
        ],
        astrolabe: {
          stories: [
            {
              title: "S",
              steps: [
                { note: "1", cards: ["a"] },
                { note: "2", cards: ["b", "a", "c"] },
              ],
            },
          ],
        },
      });
      const second = canvasSteps(data)[1];
      expect(
        [...(second?.docked ?? new Map())].map(([id, each]) => [id, each.from, each.group]),
      ).toEqual([
        ["a", 0, undefined],
        ["c", undefined, "Store"],
      ]);
    });

    it("makes a step that names a group, or shows exactly its cards, that group", () => {
      const card = (id: string, x: number, y = 40) => ({
        id,
        type: "text",
        text: id,
        x,
        y,
        width: 100,
        height: 60,
      });
      const data = canvasData({
        nodes: [
          { id: "g", type: "group", label: "Server", x: 0, y: 0, width: 400, height: 140 },
          { id: "h", type: "group", x: 0, y: 0, width: 1000, height: 400 },
          card("a", 20),
          card("b", 200),
          card("c", 600),
        ],
        astrolabe: {
          stories: [
            {
              title: "S",
              steps: [
                { note: "named", group: "g" },
                { note: "its cards", cards: ["b", "a"] },
                { note: "some of them", cards: ["a"] },
                { label: "Own", note: "relabelled", group: "g" },
                { note: "gone", group: "missing" },
              ],
            },
          ],
        },
      });
      const steps = canvasSteps(data);
      expect(steps.map((each) => [each.note, each.group, each.label])).toEqual([
        ["named", "g", "Server"],
        ["its cards", "g", "Server"],
        ["some of them", undefined, undefined],
        ["relabelled", "g", "Own"],
      ]);
      expect(steps[0]?.frame).toEqual({ x: 0, y: 0, width: 400, height: 140 });
      expect(steps[0]?.bounds).toEqual(steps[0]?.frame);
      expect([...(steps[0]?.cards ?? [])].sort()).toEqual(["a", "b"]);
      expect(steps[0]?.docked.size).toBe(0);
    });

    it("lays a story told group by group out in the order it walks them, each step its group", () => {
      const drawing: CanvasDrawing = {
        cards: [
          { id: "pay", text: "Charge the card", group: "payments" },
          { id: "cart", text: "Cart", group: "store" },
          { id: "price", text: "Price it", group: "orders" },
        ],
        groups: [
          { id: "payments", label: "Payments" },
          { id: "orders", label: "Orders API" },
          { id: "store", label: "Storefront" },
        ],
        stories: [
          {
            title: "Buying",
            steps: [
              { note: "Shop", group: "store" },
              { note: "Order", group: "orders" },
              { note: "Pay", group: "payments" },
            ],
          },
        ],
      };
      expect(canvasLayoutKind(drawing)).toBe("flow");
      const board = placeCanvas(drawing);
      expect(board.nodes.filter((node) => node.type === "group").map((node) => node.id)).toEqual([
        "store",
        "orders",
        "payments",
      ]);
      expect(canvasSteps(board).map((each) => [each.group, each.label, [...each.cards]])).toEqual([
        ["store", "Storefront", ["cart"]],
        ["orders", "Orders API", ["price"]],
        ["payments", "Payments", ["pay"]],
      ]);
    });

    it("keeps every card clear of the others", () => {
      const { nodes } = placeCanvas({
        cards: cards("a", "b", "c", "d", "e"),
        stories: [story(step("1", "a", "b"), step("2", "b", "c"), step("3", "d"), step("4", "a"))],
        arrows: [{ from: "a", to: "b" }],
      });
      for (const a of nodes) {
        for (const b of nodes) {
          if (a.id !== b.id) expect(overlap(a, b), `${a.id} and ${b.id}`).toBe(false);
        }
      }
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
        stories: [story(step("1", "a", "b"), step("2", "c"))],
      });
      expect(canvasData(canvasDocument(board))).toEqual(board);
    });

    it("reads a file's stories from its top level, leaving out steps with no card or group", () => {
      const data = canvasData({
        nodes: [{ id: "a", type: "text", text: "A", x: 0, y: 0, width: 100, height: 60 }],
        astrolabe: {
          stories: [
            {
              title: "Tour",
              steps: [
                { label: "Start", note: "Here", cards: ["a"] },
                { note: "Nothing", cards: [] },
                { note: "A group", group: "g" },
              ],
            },
            { title: "Empty", steps: [] },
          ],
        },
      });
      expect(data.stories).toEqual([
        {
          title: "Tour",
          steps: [
            { label: "Start", note: "Here", cards: ["a"] },
            { note: "A group", cards: [], group: "g" },
          ],
        },
      ]);
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
    [
      "a step naming an unknown card",
      { cards: cards("a"), stories: [{ title: "S", steps: [{ note: "N", cards: ["b"] }] }] },
      "isn't here",
    ],
    [
      "a step with no card",
      { cards: cards("a"), stories: [{ title: "S", steps: [{ note: "N", cards: [] }] }] },
      "needs cards or a group",
    ],
    [
      "a step naming an unknown group",
      { cards: cards("a"), stories: [{ title: "S", steps: [{ note: "N", group: "g" }] }] },
      "isn't in `groups`",
    ],
    [
      "a step with a group and cards",
      {
        cards: [{ id: "a", text: "A", group: "g" }],
        groups: [{ id: "g" }],
        stories: [{ title: "S", steps: [{ note: "N", group: "g", cards: ["a"] }] }],
      },
      "give one",
    ],
    [
      "a story with no step",
      { cards: cards("a"), stories: [{ title: "S", steps: [] }] },
      "needs a step",
    ],
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

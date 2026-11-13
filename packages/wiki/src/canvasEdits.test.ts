// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import {
  canvasBounds,
  canvasData,
  canvasInkEnd,
  parseCanvas,
  serializeCanvas,
  type CanvasBounds,
} from "./canvas.ts";
import {
  applyCanvasEdits,
  applyCanvasHandEdits,
  CANVAS_MAX_DRAWINGS,
  canvasStepPick,
  canvasStoryEdit,
  canvasStyleKeys,
  CanvasEditError,
  type CanvasEdit,
  type CanvasHandEdit,
  type CanvasStoryChange,
} from "./canvasEdits.ts";
import { canvasPlace } from "./canvasPlace.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(new URL(`./fixtures/obsidian-canvas/${name}`, import.meta.url), "utf8");

const ORIGIN = { x: 0, y: 0, width: 0, height: 0 };
const EMPTY = serializeCanvas({ nodes: [], edges: [] });
const card = (id: string, x: number, y: number, extra: object = {}) => ({
  id,
  type: "text",
  text: id,
  x,
  y,
  width: 200,
  height: 100,
  ...extra,
});
const group = (id: string, x: number, y: number, width: number, height: number) => ({
  id,
  type: "group",
  label: id,
  x,
  y,
  width,
  height,
});
const board = (nodes: ReadonlyArray<object>, edges: ReadonlyArray<object> = []) =>
  serializeCanvas({ nodes, edges });
const apply = (source: string | null, edits: ReadonlyArray<CanvasEdit>) =>
  applyCanvasEdits("Board.canvas", source, edits, "seed");
const read = (source: string | null) => {
  const parsed = parseCanvas(source ?? "");
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
};
const overlaps = (a: CanvasBounds, b: CanvasBounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("applyCanvasEdits", () => {
  it("starts a canvas, and mints 16 hex ids for the refs it was sent", () => {
    const { source, cards } = apply(null, [
      { op: "create" },
      { op: "add", ref: "a", text: "First" },
      { op: "add", ref: "b", url: "https://example.com" },
      { op: "connect", from: "a", to: "b", label: "goes to" },
    ]);
    expect(Object.keys(cards)).toEqual(["a", "b"]);
    expect(cards.a).toMatch(/^[0-9a-f]{16}$/);
    expect(cards.b).not.toBe(cards.a);
    const { data } = read(source);
    expect(data.nodes.map((node) => node.type)).toEqual(["text", "link"]);
    expect(data.edges[0]).toMatchObject({
      fromNode: cards.a,
      toNode: cards.b,
      fromSide: "right",
      toSide: "left",
      label: "goes to",
    });
    expect(data.nodes[1]).toMatchObject({ width: 400, height: 400 });
    expect(data.nodes[0]).toMatchObject({ width: 250, height: 60 });
  });

  it("writes a new card's keys in Obsidian's order and the serializer's bytes", () => {
    const { source, cards } = apply(board([]), [{ op: "add", ref: "a", text: "Hi", color: "red" }]);
    expect(source).toBe(
      `{\n\t"nodes":[\n\t\t{"id":"${cards.a}","x":0,"y":0,"width":250,"height":60,"type":"text","text":"Hi","color":"1"}\n\t],\n\t"edges":[]\n}`,
    );
  });

  it("is the same every time for the same seed", () => {
    const edits: ReadonlyArray<CanvasEdit> = [
      { op: "add", ref: "a", text: "A" },
      { op: "add", ref: "b", text: "B" },
    ];
    expect(apply(EMPTY, edits)).toEqual(apply(EMPTY, edits));
  });

  it("keeps what it doesn't know: unknown keys, card types, dangling arrows, fractions", () => {
    const source = fixture("survive-input.canvas");
    const before = JSON.parse(source) as { nodes: Array<{ id: string }>; edges: unknown[] };
    const { source: after } = apply(source, [{ op: "add", ref: "new", text: "New" }]);
    const written = JSON.parse(after ?? "") as typeof before;
    expect(written.nodes.slice(0, before.nodes.length)).toEqual(before.nodes);
    expect(written.edges).toEqual(before.edges);
    expect(after).toBe(serializeCanvas(written));
  });

  it("keeps a card of unknown type and a dangling arrow through an edit", () => {
    const weird = { id: "w", type: "weird", x: 0, y: 0, width: 10, height: 10, foo: "bar" };
    const dangling = { id: "e", fromNode: "gone", toNode: "also-gone", meta: { a: 1 } };
    const { source } = apply(serializeCanvas({ extra: "top", nodes: [weird], edges: [dangling] }), [
      { op: "add", ref: "a", text: "A" },
    ]);
    const document = JSON.parse(source ?? "") as Record<string, unknown>;
    expect(Object.keys(document)).toEqual(["extra", "nodes", "edges"]);
    expect((document.nodes as unknown[])[0]).toEqual(weird);
    expect((document.edges as unknown[])[0]).toEqual(dangling);
  });

  it("edits what a card says and leaves its place and unknown keys", () => {
    const { source } = apply(board([card("a", 10, 20, { foo: 1 })]), [
      { op: "edit", card: "a", text: "Changed" },
    ]);
    expect(JSON.parse(source ?? "").nodes[0]).toEqual(
      card("a", 10, 20, { foo: 1, text: "Changed" }),
    );
  });

  it("refuses an edit that doesn't suit the card, and one pinned to code", () => {
    const pinned = {
      id: "c",
      type: "link",
      url: "https://x",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      astrolabe: { path: "a.ts" },
    };
    const source = board([card("a", 0, 0), pinned]);
    expect(() => apply(source, [{ op: "edit", card: "a", url: "https://x" }])).toThrow("text card");
    expect(() => apply(source, [{ op: "edit", card: "c", url: "https://y" }])).toThrow("pinned");
    expect(() => apply(source, [{ op: "edit", card: "a" }])).toThrow("Nothing to change");
  });

  it("swapping a file drops its heading", () => {
    const file = {
      id: "f",
      type: "file",
      file: "A.md",
      subpath: "#H",
      x: 0,
      y: 0,
      width: 9,
      height: 9,
    };
    const { source } = apply(board([file]), [{ op: "edit", card: "f", file: "B.md" }]);
    expect(JSON.parse(source ?? "").nodes[0]).toEqual({
      id: "f",
      type: "file",
      file: "B.md",
      x: 0,
      y: 0,
      width: 9,
      height: 9,
    });
  });

  it("removing a card takes its arrows; removing a group leaves its cards", () => {
    const nodes = [group("g", 0, 0, 500, 500), card("a", 40, 80), card("b", 900, 0)];
    const edges = [{ id: "e", fromNode: "a", toNode: "b" }];
    const withoutCard = read(apply(board(nodes, edges), [{ op: "remove", card: "a" }]).source);
    expect(withoutCard.data.nodes.map((node) => node.id)).toEqual(["g", "b"]);
    expect(withoutCard.data.edges).toEqual([]);
    const withoutGroup = read(apply(board(nodes, edges), [{ op: "remove", card: "g" }]).source);
    expect(withoutGroup.data.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    expect(withoutGroup.data.edges).toHaveLength(1);

    const drawn = serializeCanvas({
      nodes,
      edges,
      astrolabe: {
        drawings: [
          { id: "on-a", type: "arrow", from: { node: "a", side: "top" }, to: { x: 0, y: 0 } },
          { id: "on-b", type: "arrow", from: { x: 0, y: 0 }, to: { node: "b", side: "left" } },
        ],
      },
    });
    const { document } = read(apply(drawn, [{ op: "remove", card: "a" }]).source);
    expect(
      (document as { astrolabe: { drawings: Array<{ id: string }> } }).astrolabe.drawings.map(
        (ink) => ink.id,
      ),
    ).toEqual(["on-b"]);
  });

  it("disconnects by the two ends, either way round, and says when none joins them", () => {
    const source = board(
      [card("a", 0, 0), card("b", 400, 0)],
      [{ id: "e", fromNode: "a", toNode: "b" }],
    );
    expect(
      read(apply(source, [{ op: "disconnect", from: "b", to: "a" }]).source).data.edges,
    ).toEqual([]);
    expect(() =>
      apply(board([card("a", 0, 0), card("b", 400, 0)]), [
        { op: "disconnect", from: "a", to: "b" },
      ]),
    ).toThrow("No arrow joins");
  });

  it("labels and colours cards, groups and arrows, and clears them", () => {
    const source = board(
      [group("g", 0, 0, 400, 400), card("a", 500, 0), card("b", 900, 0, { color: "3" })],
      [{ id: "e", fromNode: "a", toNode: "b", label: "old" }],
    );
    const { source: after } = apply(source, [
      { op: "label", card: "g", label: "New" },
      { op: "label", from: "a", to: "b" },
      { op: "color", card: "a", color: "green" },
      { op: "color", card: "b" },
      { op: "color", from: "a", to: "b", color: "cyan" },
    ]);
    const { nodes, edges } = JSON.parse(after ?? "");
    expect(nodes[0].label).toBe("New");
    expect(nodes[1].color).toBe("4");
    expect("color" in nodes[2]).toBe(false);
    expect("label" in edges[0]).toBe(false);
    expect(edges[0].color).toBe("5");
  });

  it("lets a card go in a group made later in the call, and new arrows name refs", () => {
    const { source, cards } = apply(EMPTY, [
      { op: "add", ref: "a", text: "A", in: "g" },
      { op: "add", ref: "b", text: "B", in: "g" },
      { op: "connect", from: "a", to: "b" },
      { op: "group", ref: "g", label: "Auth" },
    ]);
    const { data } = read(source);
    const holder = data.nodes.find((node) => node.id === cards.g);
    expect(holder).toMatchObject({ type: "group", label: "Auth" });
    for (const id of [cards.a, cards.b]) {
      const held = data.nodes.find((node) => node.id === id);
      expect(held?.x).toBeGreaterThan(holder?.x ?? 0);
      expect((held?.x ?? 0) + (held?.width ?? 0)).toBeLessThan(
        (holder?.x ?? 0) + (holder?.width ?? 0),
      );
    }
  });

  it("draws a group around cards on the board without moving them", () => {
    const nodes = [card("a", 0, 0), card("b", 300, 100)];
    const { source, cards } = apply(board(nodes), [{ op: "group", ref: "g", around: ["a", "b"] }]);
    const { data } = read(source);
    expect(data.nodes.slice(0, 2)).toMatchObject(nodes.map(({ id, x, y }) => ({ id, x, y })));
    expect(data.nodes[2]).toMatchObject({
      id: cards.g,
      label: "Untitled group",
      x: -20,
      y: -20,
      width: 540,
      height: 240,
    });
  });

  it("gives a card with no usable id one before an arrow names it", () => {
    const nameless = { type: "text", text: "A", x: 0, y: 0, width: 100, height: 100 };
    const source = serializeCanvas({ nodes: [nameless, card("b", 400, 0)], edges: [] });
    const { source: after } = apply(source, [{ op: "connect", from: "node-0", to: "b" }]);
    const { nodes, edges } = JSON.parse(after ?? "");
    expect(nodes[0].id).toMatch(/^[0-9a-f]{16}$/);
    expect(edges[0].fromNode).toBe(nodes[0].id);
  });

  it.each([
    ["an unknown card", [{ op: "remove", card: "nope" }], "no card or group"],
    ["a card with nothing on it", [{ op: "add", ref: "x" }], "exactly one of"],
    ["a card that is two things", [{ op: "add", ref: "x", text: "t", url: "u" }], "exactly one of"],
    ["a subpath with no file", [{ op: "add", ref: "x", text: "t", subpath: "#h" }], "subpath"],
    [
      "a ref used twice",
      [
        { op: "add", ref: "x", text: "t" },
        { op: "add", ref: "x", text: "u" },
      ],
      "twice",
    ],
    ["a ref that is an id", [{ op: "add", ref: "a", text: "t" }], "already a card"],
    ["going in a card", [{ op: "add", ref: "x", text: "t", in: "a" }], "isn't a group"],
    ["an arrow to itself", [{ op: "connect", from: "a", to: "a" }], "itself"],
    ["create in the middle", [{ op: "add", ref: "x", text: "t" }, { op: "create" }], "comes first"],
    ["delete in a list", [{ op: "add", ref: "x", text: "t" }, { op: "delete" }], "comes alone"],
  ] as const)("refuses %s, and all of the call with it", (_name, edits, problem) => {
    expect(() => apply(board([card("a", 0, 0)]), edits as ReadonlyArray<CanvasEdit>)).toThrow(
      problem,
    );
  });

  it("creates only what isn't there, and deletes only what is", () => {
    expect(() => apply(EMPTY, [{ op: "create" }])).toThrow("already exists");
    expect(() => apply(null, [{ op: "add", ref: "a", text: "A" }])).toThrow("start one");
    expect(() => apply(null, [{ op: "delete" }])).toThrow("No canvas");
    expect(apply(EMPTY, [{ op: "delete" }]).source).toBeNull();
  });

  it("never rewrites a file that doesn't read, or isn't a canvas", () => {
    expect(() => apply("{nope", [{ op: "add", ref: "a", text: "A" }])).toThrow("isn't valid JSON");
    expect(() => apply("[1,2,3]", [{ op: "add", ref: "a", text: "A" }])).toThrow(
      "doesn't hold a canvas",
    );
  });

  it("grows a group to fit, moves no card, and writes only the group's geometry", () => {
    const held = card("a", 40, 80);
    const nodes = [group("g", 0, 0, 280, 220), held];
    const { source, cards } = apply(board(nodes), [{ op: "add", ref: "b", text: "B", in: "g" }]);
    const { data } = read(source);
    const grown = data.nodes[0];
    const added = data.nodes.find((node) => node.id === cards.b);
    expect(data.nodes[1]).toMatchObject({ x: 40, y: 80 });
    expect(grown?.width).toBeGreaterThan(280);
    expect(added?.x).toBeGreaterThanOrEqual(grown?.x ?? 0);
  });
});

describe("canvasPlace", () => {
  const rect = (x: number, y: number, id = `${x},${y}`) => ({
    id,
    type: "text",
    x,
    y,
    width: 200,
    height: 100,
  });
  const noOverlaps = (rects: ReadonlyArray<CanvasBounds>) => {
    rects.forEach((a, position) => {
      for (const b of rects.slice(position + 1)) expect(overlaps(a, b)).toBe(false);
    });
  };

  it("is deterministic, and leaves everything on the board where it stands", () => {
    const nodes = [rect(0, 0), rect(300, 0), rect(0, 300)];
    const batch = { cards: [{ id: "n", width: 250, height: 60 }] };
    expect(canvasPlace(nodes, batch)).toEqual(canvasPlace(nodes, batch));
    expect(canvasPlace(nodes, batch).grown).toEqual({});
  });

  it("puts a card with `near` beside it, on the side that is free", () => {
    const anchor = rect(0, 0, "a");
    const free = canvasPlace([anchor], {
      cards: [{ id: "n", width: 250, height: 60, near: "a" }],
    });
    expect(free.placed.n).toMatchObject({ x: 300, y: 0 });
    const blocked = canvasPlace([anchor, rect(300, 0, "b")], {
      cards: [{ id: "n", width: 250, height: 60, near: "a" }],
    });
    expect(blocked.placed.n).toMatchObject({ x: 0, y: 200 });
  });

  it("treats an arrow to a card on the board as a `near`", () => {
    const { placed } = canvasPlace([rect(0, 0, "a"), rect(2000, 2000, "far")], {
      cards: [{ id: "n", width: 250, height: 60 }],
      links: [{ from: "a", to: "n" }],
    });
    expect(placed.n?.x).toBeLessThan(600);
    expect(placed.n?.y).toBeLessThan(400);
  });

  it("lands linked new cards laid out together, off the board's short side", () => {
    const nodes = [rect(0, 0), rect(240, 0), rect(480, 0), rect(720, 0)];
    const { placed } = canvasPlace(nodes, {
      cards: [
        { id: "a", width: 250, height: 60 },
        { id: "b", width: 250, height: 60 },
      ],
      links: [{ from: "a", to: "b" }],
    });
    expect(placed.a?.y).toBeGreaterThanOrEqual(100);
    noOverlaps([...nodes, placed.a, placed.b].flatMap((each) => each ?? []));
  });

  it("uses a gap in a group before growing it", () => {
    const nodes = [
      { ...rect(0, 0, "g"), type: "group", width: 800, height: 600 },
      rect(40, 80, "held"),
    ];
    const { placed, grown } = canvasPlace(nodes, {
      cards: [{ id: "n", width: 250, height: 60, in: "g" }],
    });
    expect(grown).toEqual({});
    expect(placed.n).toMatchObject({ x: 280, y: 60 });
  });

  it("takes the gap nearest `near` in a group", () => {
    const nodes = [
      { ...rect(0, 0, "g"), type: "group", width: 1000, height: 800 },
      rect(40, 80, "first"),
      rect(700, 500, "last"),
    ];
    const { placed } = canvasPlace(nodes, {
      cards: [{ id: "n", width: 250, height: 60, in: "g", near: "last" }],
    });
    expect(placed.n).toMatchObject({ x: 280, y: 640 });
  });

  it("grows a group away from what stands beside it, and its holder with it", () => {
    const outer = { ...rect(-100, -100, "outer"), type: "group", width: 600, height: 500 };
    const inner = { ...rect(0, 0, "g"), type: "group", width: 300, height: 200 };
    const held = rect(40, 80, "held");
    const neighbour = rect(0, 700, "below");
    const { placed, grown, outside } = canvasPlace([outer, inner, held, neighbour], {
      cards: [{ id: "n", width: 250, height: 60, in: "g" }],
    });
    expect(outside).toEqual([]);
    expect(grown.g).toBeDefined();
    expect(placed.n).toBeDefined();
    const after = { ...inner, ...grown.g };
    const holder = { ...outer, ...grown.outer };
    expect(holder.x).toBeLessThanOrEqual(after.x);
    expect(holder.y + holder.height).toBeGreaterThanOrEqual(after.y + after.height);
    expect(overlaps(holder, neighbour)).toBe(false);
  });

  it("leaves a card beside a group walled in on every side, and says so", () => {
    const hemmed = { ...rect(0, 0, "g"), type: "group", width: 300, height: 200 };
    const walls = [
      { ...rect(-1000, -40, "left"), width: 1000 },
      { ...rect(300, -40, "right"), width: 1000 },
      { ...rect(-1000, -100, "top"), width: 3000, height: 100 },
      { ...rect(-1000, 200, "bottom"), width: 3000, height: 100 },
      rect(40, 80, "held"),
    ];
    const { placed, grown, outside } = canvasPlace([hemmed, ...walls], {
      cards: [{ id: "n", width: 250, height: 60, in: "g" }],
    });
    expect(outside).toEqual(["n"]);
    expect(grown).toEqual({});
    for (const wall of walls) expect(overlaps(wall, placed.n ?? wall)).toBe(false);
  });

  it("finds room on a crowded board without touching anything", () => {
    const crowd = Array.from({ length: 900 }, (_, position) =>
      rect((position % 30) * 240, Math.floor(position / 30) * 140),
    );
    const { placed } = canvasPlace(crowd, {
      cards: [{ id: "n", width: 250, height: 60, near: crowd[400]?.id }],
    });
    noOverlaps([...crowd, placed.n].flatMap((each) => each ?? []));
  });

  it("never uses a method the phone's engine lacks", () => {
    const source = NodeFS.readFileSync(new URL("./canvasPlace.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\.(toSorted|toReversed|toSpliced|findLast|with)\(/);
  });

  it("lays a new board out as columns from the origin", () => {
    const { placed } = canvasPlace([], {
      cards: [
        { id: "a", width: 250, height: 60 },
        { id: "b", width: 250, height: 60 },
      ],
      links: [{ from: "a", to: "b" }],
    });
    expect(placed.a).toMatchObject({ x: 0, y: 0 });
    expect(overlaps(placed.a ?? ORIGIN, placed.b ?? ORIGIN)).toBe(false);
  });
});

describe("a person's edits", () => {
  const roundTrip = (source: string, edits: ReadonlyArray<CanvasHandEdit>) => {
    const { document, inverse } = applyCanvasHandEdits(read(source).document, edits);
    return { after: serializeCanvas(document), undone: applyInverse(document, inverse) };
  };
  const applyInverse = (document: unknown, inverse: ReadonlyArray<CanvasHandEdit>) =>
    serializeCanvas(applyCanvasHandEdits(document, inverse).document);
  const SURVIVORS = serializeCanvas({
    nodes: [
      card("a", 0.5, 10, { future: { kept: true } }),
      { id: "strange", type: "hologram", x: 5, y: 5, width: 10, height: 10, depth: 3 },
      card("b", 300, 0),
    ],
    edges: [
      { id: "e1", fromNode: "a", toNode: "b", style: "dashed" },
      { id: "e2", fromNode: "a", toNode: "gone" },
    ],
    astrolabe: {
      drawings: [
        { id: "s1", type: "stroke", x: 10, y: 10, points: [0, 0, 5, 5], pressure: [1] },
        { id: "comet", type: "comet", tail: 3 },
        { id: "f1", type: "arrow", from: { x: 0, y: 400 }, to: { node: "a", side: "bottom" } },
      ],
    },
  });

  it.each<[string, ReadonlyArray<CanvasHandEdit>]>([
    ["a move", [{ op: "move", card: "a", x: 20, y: 40 }]],
    ["a resize", [{ op: "resize", card: "a", x: 0, y: 0, width: 60, height: 60 }]],
    ["a colour", [{ op: "set-card", card: "a", keys: { color: "3" } }]],
    ["a raise", [{ op: "reorder", cards: ["a"] }]],
    ["a removal with its arrows", [{ op: "remove-card", card: "a" }]],
    ["a new card", [{ op: "put-card", node: card("c", 1, 1) }]],
    ["an arrow's label", [{ op: "set-arrow", arrow: "e1", keys: { label: "x" } }]],
    ["an arrow's removal", [{ op: "remove-arrow", arrow: "e1" }]],
    ["a new arrow", [{ op: "put-arrow", edge: { id: "e3", fromNode: "b", toNode: "a" } }]],
    [
      "a first story",
      [{ op: "set-stories", stories: [{ title: "T", steps: [{ note: "n", cards: ["a"] }] }] }],
    ],
    [
      "two removals, undone to their places",
      [
        { op: "remove-card", card: "a" },
        { op: "remove-card", card: "b" },
      ],
    ],
    [
      "a new drawing",
      [{ op: "put-drawing", drawing: { id: "s2", type: "stroke", x: 0, y: 0, points: [0, 0] } }],
    ],
    ["a drawing moved", [{ op: "set-drawing", drawing: "s1", keys: { x: 40, y: 50 } }]],
    [
      "an arrow's end re-ended and coloured",
      [{ op: "set-drawing", drawing: "f1", keys: { to: { x: 9, y: 9 }, color: "2" } }],
    ],
    ["a drawing's removal", [{ op: "remove-drawing", drawing: "s1" }]],
    [
      "a style on a card and a stroke, as one edit",
      [
        { op: "set-card", card: "a", keys: canvasStyleKeys({}, { width: 4, fill: "none" }) },
        { op: "set-drawing", drawing: "s1", keys: canvasStyleKeys({}, { width: 4 }) },
      ],
    ],
    [
      "every drawing removed",
      [
        { op: "remove-drawing", drawing: "s1" },
        { op: "remove-drawing", drawing: "comet" },
        { op: "remove-drawing", drawing: "f1" },
      ],
    ],
  ])("%s undoes back to the same bytes, unknowns and all", (_name, edits) => {
    const { after, undone } = roundTrip(SURVIVORS, edits);
    expect(after).not.toBe(SURVIVORS);
    expect(undone).toBe(SURVIVORS);
  });

  it("sets a style beside a shape and what it doesn't know, and clears it away", () => {
    const shaped = { astrolabe: { shape: "ellipse", style: { sloppiness: 1, dash: "dashed" } } };
    expect(canvasStyleKeys(shaped, { width: 2, dash: null })).toEqual({
      astrolabe: { shape: "ellipse", style: { sloppiness: 1, width: 2 } },
    });
    expect(canvasStyleKeys({ astrolabe: { style: { dash: "dashed" } } }, { dash: null })).toEqual({
      astrolabe: null,
    });
  });

  it("writes a file Obsidian reads, leaving what it doesn't name as it was", () => {
    const { source } = apply(SURVIVORS, [{ op: "move", card: "b", x: 20, y: 40 }]);
    const nodes = read(source).document as { nodes: ReadonlyArray<Record<string, unknown>> };
    expect(nodes.nodes[0]).toMatchObject({ x: 0.5, future: { kept: true } });
    expect(nodes.nodes[1]).toMatchObject({ type: "hologram", depth: 3 });
    expect(source).toContain('"style":"dashed"');
    expect(source).toContain('{"id":"e2","fromNode":"a","toNode":"gone"}');
  });

  it("leaves an Obsidian-saved file as Obsidian saved it, but for the card that moved", () => {
    const source = serializeCanvas(read(fixture("hand-after-edit.canvas")).document);
    const [first] = read(source).data.nodes;
    const moved = apply(source, [{ op: "move", card: first!.id, x: 1000, y: 2000 }]).source!;
    const was = source.split("\n");
    const now = moved.split("\n");
    expect(now).toHaveLength(was.length);
    // This card holds a nested object, so it's written across lines.
    expect(now.filter((line, position) => line !== was[position])).toEqual([
      '\t\t\t"x":1000,',
      '\t\t\t"y":2000,',
    ]);
    const undone = applyCanvasHandEdits(read(source).document, [
      { op: "move", card: first!.id, x: 1000, y: 2000 },
    ]);
    expect(serializeCanvas(applyCanvasHandEdits(undone.document, undone.inverse).document)).toBe(
      source,
    );
  });

  it("keeps a card's keys in the order the file has them", () => {
    const { source } = apply(board([card("a", 0, 0, { color: "1", extra: true })]), [
      { op: "move", card: "a", x: 20, y: 40 },
      { op: "set-card", card: "a", keys: { color: null } },
    ]);
    expect(source).toContain('{"id":"a","type":"text","text":"a","x":20,"y":40,');
    expect(source).not.toContain('"color"');
  });

  it("skips what's gone from the head, so a save never fails on someone else's delete", () => {
    const { source } = apply(board([card("a", 0, 0)]), [
      { op: "move", card: "gone", x: 1, y: 1 },
      { op: "remove-card", card: "gone" },
      { op: "remove-arrow", arrow: "gone" },
      { op: "set-arrow", arrow: "gone", keys: { label: "x" } },
      { op: "move", card: "a", x: 40, y: 0 },
    ]);
    expect(read(source).data.nodes[0]).toMatchObject({ x: 40 });
  });

  it("replays a put by id, so a save sent twice leaves one card", () => {
    const put: CanvasHandEdit = { op: "put-card", node: card("c", 1, 1) };
    const { source } = apply(board([card("a", 0, 0)]), [put, put]);
    expect(read(source).data.nodes.map((node) => node.id)).toEqual(["a", "c"]);
  });

  it("moves a dragged card to the top, and undo restores its place in the file", () => {
    const three = board([card("a", 0, 0), card("b", 0, 0), card("c", 0, 0)]);
    const raised = applyCanvasHandEdits(read(three).document, [
      { op: "reorder", cards: ["a", "b"] },
    ]);
    const order = (document: unknown) =>
      (document as { nodes: ReadonlyArray<{ id: string }> }).nodes.map(({ id }) => id);
    expect(order(raised.document)).toEqual(["c", "a", "b"]);
    expect(order(applyCanvasHandEdits(raised.document, raised.inverse).document)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("removes an arrow with its card, and only that one", () => {
    const { source } = apply(SURVIVORS, [{ op: "remove-card", card: "b" }]);
    expect(read(source).data.edges.map((edge) => edge.id)).toEqual(["e2"]);
    const { data } = read(apply(SURVIVORS, [{ op: "remove-card", card: "a" }]).source);
    expect(data.drawings?.map((ink) => ink.id)).toEqual(["s1"]);
  });

  it("keeps a drawing it doesn't know through a save, and draws an arrow's end on its card", () => {
    const { source } = apply(SURVIVORS, [
      { op: "move", card: "a", x: 100, y: 200 },
      { op: "set-drawing", drawing: "s1", keys: { x: 0, y: 0 } },
      { op: "put-drawing", drawing: { id: "s1", type: "stroke", x: 1, y: 1, points: [0, 0] } },
    ]);
    const { document, data } = read(source);
    expect((document as { astrolabe: { drawings: unknown[] } }).astrolabe.drawings[1]).toEqual({
      id: "comet",
      type: "comet",
      tail: 3,
    });
    // A stroke's points are scalars, so they stay on one line however many there are.
    expect(source).toContain('\t\t\t\t"points":[0,0]\n');
    const arrow = data.drawings?.find((ink) => ink.id === "f1");
    if (arrow?.type !== "arrow") throw new Error("f1 isn't an arrow");
    const nodes = new Map(data.nodes.map((node) => [node.id, node]));
    // The card moved to (100, 200) and is 200 by 100: its bottom's middle is where the arrow ends.
    expect(canvasInkEnd(arrow.to, nodes)).toEqual({ x: 200, y: 300 });
    expect(canvasBounds(data)).toMatchObject({ x: 0, y: 0, height: 400 });
  });

  it("refuses a list that mixes a person's edits with an agent's", () => {
    expect(() =>
      apply(board([card("a", 0, 0)]), [
        { op: "move", card: "a", x: 1, y: 1 },
        { op: "remove", card: "a" },
      ]),
    ).toThrow(CanvasEditError);
  });

  it("handles a whole board in one list without slowing per card or drawing", () => {
    const nodes = Array.from({ length: 5000 }, (_, index) => card(`n${index}`, index, 0));
    const drawings = Array.from({ length: CANVAS_MAX_DRAWINGS }, (_, index) => ({
      id: `d${index}`,
      type: "arrow",
      from: { node: `n${index}`, side: "top" },
      to: { x: index, y: 0 },
    }));
    const start = read(serializeCanvas({ nodes, edges: [], astrolabe: { drawings } })).document;
    const removed = applyCanvasHandEdits(start, [
      ...drawings.map(({ id }): CanvasHandEdit => ({ op: "set-drawing", drawing: id, keys: {} })),
      ...drawings
        .filter((_, index) => index % 2 === 0)
        .map(({ id }): CanvasHandEdit => ({ op: "remove-drawing", drawing: id })),
      ...nodes.map(({ id }): CanvasHandEdit => ({ op: "remove-card", card: id })),
    ]);
    expect(removed.document.astrolabe).toBeUndefined();
    expect(serializeCanvas(applyCanvasHandEdits(removed.document, removed.inverse).document)).toBe(
      serializeCanvas(start),
    );
  });
});

describe("a person's stories", () => {
  const STORIED = {
    nodes: [group("g", 0, 0, 500, 300), card("a", 20, 40), card("b", 260, 40), card("c", 700, 0)],
    edges: [],
    astrolabe: {
      theme: "kept",
      stories: [
        "not a story",
        {
          title: "Walk",
          future: 1,
          steps: [
            { note: "First", label: "One", cards: ["a"], pinned: true },
            { note: 3 },
            { note: "Second", group: "g" },
          ],
        },
      ],
    },
  };
  const change = (document: unknown, each: CanvasStoryChange) =>
    applyCanvasHandEdits(document, [canvasStoryEdit(document, each)]).document;
  const steps = (document: unknown, story = 0) =>
    canvasData(document).stories?.[story]?.steps.map((step) => step.label ?? step.note);

  it("changes steps by the places it draws them at, keeping what it doesn't read", () => {
    const edited = change(STORIED, {
      kind: "edit-step",
      story: 0,
      step: 1,
      note: "Then",
      label: "Two",
    });
    expect(steps(edited)).toEqual(["One", "Two"]);
    const moved = change(edited, { kind: "move-step", story: 0, step: 1, to: 0 });
    expect(steps(moved)).toEqual(["Two", "One"]);
    const added = change(moved, { kind: "add-step", story: 0, at: 1, step: { cards: ["c"] } });
    expect(steps(added)).toEqual(["Two", "", "One"]);
    const unlabelled = change(added, { kind: "edit-step", story: 0, step: 2, label: " " });
    expect(steps(unlabelled)).toEqual(["Two", "", "First"]);
    const { astrolabe } = unlabelled as { astrolabe: { theme: string; stories: unknown[] } };
    expect(astrolabe.theme).toBe("kept");
    expect(astrolabe.stories[0]).toBe("not a story");
    expect(astrolabe.stories[1]).toMatchObject({
      future: 1,
      steps: expect.arrayContaining([{ note: 3 }]),
    });
    expect(JSON.stringify(astrolabe.stories)).toContain('"pinned":true');
  });

  it("starts a story with a step, and drops one whose last step goes", () => {
    const started = change(STORIED, { kind: "add-step", story: 1, at: 0, step: { group: "g" } });
    expect(canvasData(started).stories?.map((story) => story.title)).toEqual(["Walk", "Story 2"]);
    const renamed = change(started, { kind: "rename-story", story: 1, title: "Tour" });
    expect(canvasData(renamed).stories?.[1]?.title).toBe("Tour");
    const emptied = change(renamed, { kind: "remove-step", story: 1, step: 0 });
    expect(canvasData(emptied).stories?.map((story) => story.title)).toEqual(["Walk"]);
    const none = change(emptied, { kind: "remove-story", story: 0 });
    expect(canvasData(none).stories).toBeUndefined();
    expect(
      applyCanvasHandEdits(STORIED, [canvasStoryEdit(STORIED, { kind: "remove-story", story: 0 })])
        .inverse,
    ).toEqual([{ op: "set-stories", stories: STORIED.astrolabe.stories }]);
  });

  it.each<[string, ReadonlyArray<string>, unknown]>([
    ["a group alone is that group", ["g"], { group: "g" }],
    ["cards are those cards", ["a", "c"], { cards: ["a", "c"] }],
    ["a group with other cards brings its own", ["g", "c"], { cards: ["c", "a", "b"] }],
    ["nothing shows no step", [], null],
  ])("makes a step of a selection: %s", (_name, picked, step) => {
    expect(canvasStepPick(canvasData(STORIED), picked)).toEqual(step);
  });
});

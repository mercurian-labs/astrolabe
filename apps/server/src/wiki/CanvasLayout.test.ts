import { assert, it } from "@effect/vitest";
import {
  canvasBounds,
  placeCanvas,
  type CanvasBounds,
  type CanvasData,
  type CanvasDrawing,
} from "@mercurian/wiki/canvas";
import * as Effect from "effect/Effect";

import { layoutCanvas } from "./CanvasLayout.ts";

const cards = (...ids: string[]) => ids.map((id) => ({ id, text: id.toUpperCase() }));
const at = (board: CanvasData, id: string) => {
  const node = board.nodes.find((each) => each.id === id);
  if (node === undefined) throw new Error(`${id} isn't on the board`);
  return node;
};
const inside = (outer: CanvasBounds, inner: CanvasBounds) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
const overlap = (a: CanvasBounds, b: CanvasBounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const assertApart = (board: CanvasData) => {
  const placed = board.nodes.filter((node) => node.type !== "group");
  for (const a of placed) {
    for (const b of placed) {
      if (a.id !== b.id) assert.isFalse(overlap(a, b), `${a.id} and ${b.id} overlap`);
    }
  }
};

it.effect("runs a flow along its arrows, each group drawn around its own cards", () =>
  Effect.gen(function* () {
    const drawing: CanvasDrawing = {
      cards: [
        { id: "client", text: "Client" },
        { id: "api", text: "API", group: "server" },
        { id: "db", text: "Database", group: "server" },
        { id: "cache", text: "Cache" },
      ],
      groups: [{ id: "server", label: "Server" }],
      arrows: [
        { from: "client", to: "api", label: "request" },
        { from: "api", to: "db" },
        { from: "api", to: "cache" },
      ],
      layout: { kind: "flow", direction: "right" },
    };
    const board = yield* layoutCanvas(drawing);
    assertApart(board);
    assert.isTrue(inside(at(board, "server"), at(board, "api")));
    assert.isTrue(inside(at(board, "server"), at(board, "db")));
    assert.isAbove(at(board, "api").x, at(board, "client").x);
    assert.deepEqual(
      board.edges.map((edge) => [edge.fromNode, edge.toNode, edge.label]),
      [
        ["client", "api", "request"],
        ["api", "db", undefined],
        ["api", "cache", undefined],
      ],
    );
  }),
);

it.effect("packs a map's areas side by side, none over another", () =>
  Effect.gen(function* () {
    const drawing: CanvasDrawing = {
      cards: [
        { id: "web", text: "Web app", group: "clients" },
        { id: "phone", text: "Phone app", group: "clients" },
        { id: "server", text: "Server", group: "backend" },
        { id: "queue", text: "Queue", group: "backend" },
        { id: "docs", text: "Docs" },
      ],
      groups: [
        { id: "clients", label: "Clients" },
        { id: "backend", label: "Backend" },
      ],
      arrows: [
        { from: "web", to: "server" },
        { from: "server", to: "queue" },
      ],
    };
    const board = yield* layoutCanvas(drawing);
    assertApart(board);
    assert.isTrue(inside(at(board, "clients"), at(board, "web")));
    assert.isTrue(inside(at(board, "clients"), at(board, "phone")));
    assert.isTrue(inside(at(board, "backend"), at(board, "queue")));
    assert.isFalse(overlap(at(board, "clients"), at(board, "backend")));
  }),
);

it.effect("hangs a tree's children below their parent", () =>
  Effect.gen(function* () {
    const board = yield* layoutCanvas({
      cards: cards("root", "left", "right", "leaf"),
      arrows: [
        { from: "root", to: "left" },
        { from: "root", to: "right" },
        { from: "left", to: "leaf" },
        // A second way down keeps its arrow, but not its say in the tree's shape.
        { from: "right", to: "leaf" },
      ],
      layout: { kind: "tree" },
    });
    assertApart(board);
    assert.isAbove(at(board, "left").y, at(board, "root").y);
    assert.isAbove(at(board, "leaf").y, at(board, "left").y);
    assert.strictEqual(board.edges.length, 4);
  }),
);

it.effect("circles a radial board around the card it names", () =>
  Effect.gen(function* () {
    const board = yield* layoutCanvas({
      cards: cards("a", "b", "hub", "c", "d", "loose"),
      arrows: [
        { from: "a", to: "hub" },
        { from: "hub", to: "b" },
        { from: "hub", to: "c" },
        { from: "d", to: "hub" },
      ],
      layout: { kind: "radial", center: "hub" },
    });
    assertApart(board);
    const whole = canvasBounds(board);
    const middle = { x: whole.x + whole.width / 2, y: whole.y + whole.height / 2 };
    const distance = (id: string) => {
      const node = at(board, id);
      return Math.hypot(node.x + node.width / 2 - middle.x, node.y + node.height / 2 - middle.y);
    };
    for (const id of ["a", "b", "c", "d", "loose"]) assert.isBelow(distance("hub"), distance(id));
  }),
);

it.effect("leaves lanes and a story's own layout to the board's placer", () =>
  Effect.gen(function* () {
    const lanes: CanvasDrawing = {
      cards: [
        { id: "a", text: "A", group: "one" },
        { id: "b", text: "B", group: "two" },
      ],
      groups: [{ id: "one" }, { id: "two" }],
      stories: [{ title: "S", steps: [{ note: "N", cards: ["a", "b"] }] }],
    };
    const story: CanvasDrawing = {
      cards: cards("a", "b"),
      stories: [{ title: "S", steps: [{ note: "N", cards: ["a"] }] }],
    };
    for (const drawing of [lanes, story]) {
      assert.deepEqual(yield* layoutCanvas(drawing), placeCanvas(drawing));
    }
  }),
);

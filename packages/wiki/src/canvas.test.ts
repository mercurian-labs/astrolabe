import { describe, expect, it } from "vitest";

import {
  canvasBounds,
  canvasDrawingProblems,
  placeCanvas,
  type CanvasBounds,
  type CanvasDrawing,
} from "./canvas.ts";

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

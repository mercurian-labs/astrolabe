// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { serializeCanvas } from "./canvas.ts";
import { canvasMerge, canvasMergeMessages, type CanvasMergeNote } from "./canvasMerge.ts";

const fixture = (name: string) =>
  NodeFS.readFileSync(new URL(`./fixtures/obsidian-canvas/${name}`, import.meta.url), "utf8");

const card = (id: string, text: string, rest: Record<string, unknown> = {}) => ({
  id,
  type: "text",
  text,
  x: 0,
  y: 0,
  width: 250,
  height: 60,
  ...rest,
});
const arrow = (id: string, fromNode: string, toNode: string, rest = {}) => ({
  id,
  fromNode,
  toNode,
  ...rest,
});
const board = (nodes: ReadonlyArray<unknown>, edges: ReadonlyArray<unknown> = []) =>
  serializeCanvas({ nodes, edges });

const a = card("a", "First sentence. Middle sentence. Last sentence.");
const b = card("b", "Beta");
const c = card("c", "Gamma");
const base = board([a, b, c], [arrow("ab", "a", "b"), arrow("bc", "b", "c")]);

function merged(baseText: string, ours: string, theirs: string) {
  const outcome = canvasMerge(baseText, ours, theirs);
  if (outcome.status !== "merged") throw new Error(JSON.stringify(outcome.conflicts));
  return { document: JSON.parse(outcome.text), text: outcome.text, resolved: outcome.resolved };
}

const kinds = (notes: ReadonlyArray<CanvasMergeNote>) => notes.map((note) => note.kind);

describe("canvasMerge", () => {
  it("merges edits to different cards and different sentences of one card", () => {
    const { document, resolved } = merged(
      base,
      board([{ ...a, text: "First, sharper. Middle sentence. Last sentence." }, b, c]),
      board([
        { ...a, text: "First sentence. Middle sentence. Last, sharper." },
        b,
        c,
        card("d", "D"),
      ]),
    );
    expect(document.nodes[0].text).toBe("First, sharper. Middle sentence. Last, sharper.");
    expect(document.nodes.map((node: { id: string }) => node.id)).toEqual(["a", "b", "c", "d"]);
    expect(resolved).toEqual([]);
  });

  it("calls the same sentence changed both ways a conflict", () => {
    const outcome = canvasMerge(
      base,
      board([{ ...a, text: "First sentence. Mine. Last sentence." }, b, c]),
      board([{ ...a, text: "First sentence. Yours. Last sentence." }, b, c]),
    );
    expect(outcome).toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "same-text", id: "a" }],
    });
  });

  it.each([
    ["position", { x: 40, y: 0 }, { x: 0, y: 80 }, "x", 0],
    ["size", { width: 300 }, { width: 500 }, "width", 500],
    ["colour", { color: "1" }, { color: "#ff0000" }, "color", "#ff0000"],
  ])("gives the change being merged a %s both sides changed", (name, mine, yours, key, kept) => {
    const { document, resolved } = merged(
      base,
      board([{ ...a, ...mine }, b, c]),
      board([{ ...a, ...yours }, b, c]),
    );
    expect(document.nodes[0][key]).toBe(kept);
    expect(resolved).toMatchObject([{ kind: "both-changed", id: "a" }]);
    expect(resolved[0]?.message).toContain(name);
  });

  it("takes both sides' changes to different looks, with nothing to say", () => {
    const { document, resolved } = merged(
      base,
      board([{ ...a, x: 40 }, b, c]),
      board([{ ...a, color: "2", width: 400 }, b, c]),
    );
    expect(document.nodes[0]).toMatchObject({ x: 40, color: "2", width: 400 });
    expect(resolved).toEqual([]);
  });

  it("merges an order on one side with a style or shape on the other, and keeps this change's order when both moved it", () => {
    const shaped = { ...a, astrolabe: { shape: "ellipse" } };
    const { document, resolved } = merged(
      board([shaped, b, c]),
      board([{ ...a, astrolabe: { shape: "ellipse", z: "a3" } }, b, c]),
      board([{ ...a, astrolabe: { shape: "diamond", style: { width: 4 } } }, b, c]),
    );
    expect(document.nodes[0].astrolabe).toEqual({
      shape: "diamond",
      style: { width: 4 },
      z: "a3",
    });
    expect(resolved).toEqual([]);
    const both = merged(
      base,
      board([{ ...a, astrolabe: { z: "a1" } }, b, c]),
      board([{ ...a, astrolabe: { z: "a5" } }, b, c]),
    );
    expect(both.document.nodes[0].astrolabe).toEqual({ z: "a5" });
    expect(both.resolved).toMatchObject([
      { kind: "both-changed", message: expect.stringContaining("order") },
    ]);
  });

  it("drops an arrow into a card the merge deletes, and says so", () => {
    const { document, resolved } = merged(
      base,
      board([a, b], [arrow("ab", "a", "b")]),
      board([a, b, c, card("d", "New")], [...JSON.parse(base).edges, arrow("dc", "d", "c")]),
    );
    expect(document.edges.map((edge: { id: string }) => edge.id)).toEqual(["ab"]);
    expect(kinds(resolved)).toEqual(["arrow-dropped"]);
    expect(resolved[0]?.message).toContain("“Gamma”");
    expect(resolved[0]?.message).toContain("deleted");
  });

  it("keeps an arrow neither side could draw", () => {
    const dangling = board([a], [arrow("gone", "a", "never-there")]);
    const { document, resolved } = merged(
      dangling,
      board([{ ...a, x: 10 }], [arrow("gone", "a", "never-there")]),
      board([{ ...a, y: 10 }], [arrow("gone", "a", "never-there")]),
    );
    expect(document.edges).toHaveLength(1);
    expect(resolved).toMatchObject([{ kind: "both-changed" }]);
  });

  it.each([
    ["deleted here", board([{ ...a, text: "Edited." }, b, c]), board([b, c])],
    ["deleted there", board([b, c]), board([{ ...a, text: "Edited." }, b, c])],
  ])("calls a text edit against a card %s a conflict", (_, ours, theirs) => {
    expect(canvasMerge(base, ours, theirs)).toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "edited-against-deleted", id: "a" }],
    });
  });

  it("lets a delete beat a layout edit, and says so", () => {
    const { document, resolved } = merged(
      board([a, b]),
      board([{ ...a, x: 90, color: "3" }, b]),
      board([b]),
    );
    expect(document.nodes.map((node: { id: string }) => node.id)).toEqual(["b"]);
    expect(resolved).toMatchObject([{ kind: "delete-won", id: "a" }]);
  });

  it("drops an edited arrow with its card, but an edited arrow deleted alone is a conflict", () => {
    const labelled = arrow("ab", "a", "b", { label: "because" });
    const dropped = merged(
      board([a, b], [arrow("ab", "a", "b")]),
      board([b]),
      board([a, b], [labelled]),
    );
    expect(dropped.document.edges).toEqual([]);
    expect(kinds(dropped.resolved)).toEqual(["arrow-dropped"]);
    expect(
      canvasMerge(board([a, b], [arrow("ab", "a", "b")]), board([a, b]), board([a, b], [labelled])),
    ).toMatchObject({ status: "conflict", conflicts: [{ kind: "edited-against-deleted" }] });
  });

  it("calls a value only one person can have a conflict, and agrees when both match", () => {
    const edge = (label: string) => board([a, b], [arrow("ab", "a", "b", { label })]);
    expect(canvasMerge(edge("old"), edge("mine"), edge("yours"))).toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "same-value", id: "ab" }],
    });
    expect(merged(edge("old"), edge("same"), edge("same")).resolved).toEqual([]);
  });

  it("keeps everything neither side removed, in the serializer's bytes", () => {
    const survivor = fixture("survive-input.canvas");
    const document = JSON.parse(survivor);
    const mover = document.nodes.find((node: { id: string }) => node.id === "mover");
    const moved = serializeCanvas({
      ...document,
      nodes: document.nodes.map((node: { id: string }) =>
        node === mover ? { ...node, x: 500 } : node,
      ),
    });
    const added = serializeCanvas({
      ...document,
      zzz: document.zzz,
      nodes: [...document.nodes, card("new", "Added")],
    });
    const result = merged(survivor, moved, added);
    expect(result.text).toBe(serializeCanvas(result.document));
    expect(result.document).toEqual({
      ...JSON.parse(moved),
      nodes: [...JSON.parse(moved).nodes, card("new", "Added")],
    });
  });

  it("keeps entries with no id, repeated ids, and a key each side added at the top", () => {
    const start = { nodes: [a, { type: "text", text: "no id" }, a], edges: [], viewport: 1 };
    const { document } = merged(
      serializeCanvas(start),
      serializeCanvas({ ...start, mine: true }),
      serializeCanvas({ ...start, yours: true, nodes: [...start.nodes, b] }),
    );
    expect(document.nodes).toEqual([a, { type: "text", text: "no id" }, a, b]);
    expect(Object.keys(document)).toEqual(["nodes", "edges", "viewport", "mine", "yours"]);
  });

  it("calls an unknown key both sides changed a conflict", () => {
    const top = (viewport: number) => serializeCanvas({ nodes: [], viewport });
    expect(canvasMerge(top(1), top(2), top(3))).toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "same-value" }],
    });
  });

  it("leaves a missing key missing, and removes one only a side removed", () => {
    const noEdges = serializeCanvas({ nodes: [a] });
    expect(merged(noEdges, serializeCanvas({ nodes: [a, b] }), noEdges).document).toEqual({
      nodes: [a, b],
    });
    expect(merged(board([a]), serializeCanvas({ nodes: [a] }), board([a, b])).document).toEqual({
      nodes: [a, b],
    });
  });

  it("stacks what each side added after what it followed, and follows a reorder", () => {
    const ids = (document: { nodes: ReadonlyArray<{ id: string }> }) =>
      document.nodes.map((node) => node.id);
    expect(
      ids(
        merged(
          base,
          board([card("first", "x"), a, card("mine", "x"), b, c]),
          board([a, b, card("yours", "x"), c]),
        ).document,
      ),
    ).toEqual(["first", "a", "mine", "b", "yours", "c"]);
    expect(ids(merged(base, board([c, b, a]), board([a, b, c, card("d", "x")])).document)).toEqual([
      "c",
      "d",
      "b",
      "a",
    ]);
    const both = merged(base, board([c, a, b]), board([b, a, c]));
    expect(ids(both.document)).toEqual(["b", "a", "c"]);
    expect(kinds(both.resolved)).toEqual(["order"]);
  });

  it.each([
    ["the base", "{ not json", base, base],
    ["our side", base, "{ not json", base],
    ["their side", base, base, "{ not json"],
    ["an array", base, "[1,2,3]", base],
    ["nodes that aren't a list", base, '{"nodes":3}', base],
  ])("never rewrites %s it can't read", (_, baseText, ours, theirs) => {
    expect(canvasMerge(baseText, ours, theirs)).toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "invalid" }],
    });
  });

  it("merges drawings by id, each on its own, and stories apart from them", () => {
    const drawn = (drawings: ReadonlyArray<unknown>, rest: Record<string, unknown> = {}) =>
      serializeCanvas({ nodes: [a, b, c], edges: [], astrolabe: { drawings, ...rest } });
    const stroke = (id: string, rest = {}) => ({
      id,
      type: "stroke",
      x: 0,
      y: 0,
      points: [0, 0, 10, 10],
      ...rest,
    });
    const free = (id: string, node: string, rest = {}) => ({
      id,
      type: "arrow",
      from: { node, side: "right" },
      to: { x: 500, y: 500 },
      ...rest,
    });
    const story = { title: "Tour", steps: [{ note: "Start", cards: ["a"] }] };
    const start = drawn([stroke("s"), free("fc", "c")], { stories: [story] });
    const { document, resolved } = merged(
      start,
      drawn(
        [
          stroke("s", { x: 40 }),
          free("fc", "c", { bends: [300, 100] }),
          stroke("mine", { pressure: [0.3, 0.7] }),
        ],
        { stories: [story] },
      ),
      drawn(
        [
          stroke("s", { color: "2" }),
          free("fc", "c", {
            from: { node: "c", side: "bottom", at: [0.2, 1] },
            toEnd: "none",
            astrolabe: { style: { route: "elbow" } },
          }),
          stroke("yours"),
        ],
        { stories: [{ ...story, title: "Walk" }] },
      ),
    );
    expect(document.astrolabe.drawings.map((ink: { id: string }) => ink.id)).toEqual([
      "s",
      "fc",
      "yours",
      "mine",
    ]);
    expect(document.astrolabe.drawings[0]).toMatchObject({ x: 40, color: "2" });
    // Bends, ends, heads and route are each their own look.
    expect(document.astrolabe.drawings[1]).toEqual(
      free("fc", "c", {
        from: { node: "c", side: "bottom", at: [0.2, 1] },
        bends: [300, 100],
        toEnd: "none",
        astrolabe: { style: { route: "elbow" } },
      }),
    );
    expect(document.astrolabe.drawings[3]).toMatchObject({ id: "mine", pressure: [0.3, 0.7] });
    expect(document.astrolabe.stories[0].title).toBe("Walk");
    expect(resolved).toEqual([]);

    const clash = canvasMerge(
      start,
      drawn([stroke("s", { points: [0, 0, 5, 5] }), free("fc", "c")]),
      drawn([stroke("s", { points: [0, 0, 9, 9] }), free("fc", "c")]),
    );
    expect(clash).toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "same-value", id: "s" }],
    });
    // Pressure is part of what a stroke says, as its points are.
    const pressed = canvasMerge(
      start,
      drawn([stroke("s", { pressure: [0.1, 0.2] }), free("fc", "c")]),
      drawn([stroke("s", { pressure: [0.9, 0.8] }), free("fc", "c")]),
    );
    expect(pressed).toMatchObject({
      status: "conflict",
      conflicts: [{ kind: "same-value", id: "s" }],
    });

    const dropped = merged(
      start,
      serializeCanvas({ nodes: [a, b], edges: [], astrolabe: { drawings: [stroke("s")] } }),
      drawn([stroke("s"), free("fc", "c"), free("new", "c")], { stories: [story] }),
    );
    expect(dropped.document.astrolabe.drawings.map((ink: { id: string }) => ink.id)).toEqual(["s"]);
    expect(kinds(dropped.resolved)).toEqual(["arrow-dropped"]);
    expect(dropped.resolved[0]?.message).toContain("“Gamma”");
  });

  it("reads an empty side as an empty board", () => {
    expect(merged(base, "", base).document).toEqual({});
  });
});

describe("canvasMergeMessages", () => {
  it("says a long list in a line short enough to send", () => {
    const notes = Array.from({ length: 25 }, (_, position) => ({
      kind: "both-changed" as const,
      message: `Note ${position}`,
    }));
    const messages = canvasMergeMessages(notes);
    expect(messages).toHaveLength(21);
    expect(messages.at(-1)).toBe("…and 5 more.");
  });
});

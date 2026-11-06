import { applyCanvasEdits, type CanvasHandEdit } from "@mercurian/wiki/canvas-edits";
import { canvasCardName, serializeCanvas } from "@mercurian/wiki/canvas";
import { describe, expect, it, vi } from "vite-plus/test";

import { CanvasDocument } from "./canvasDocument";

const card = (id: string, extra: object = {}) => ({
  id,
  type: "text",
  text: id,
  x: 0,
  y: 0,
  width: 250,
  height: 60,
  ...extra,
});
const board = (...nodes: ReadonlyArray<object>) => ({ nodes, edges: [] });

function setup(document: object = board(card("a"), card("b", { x: 300 }))) {
  const onEdited = vi.fn();
  let clock = 0;
  let minted = 0;
  const canvas = new CanvasDocument({
    document,
    revision: "r0",
    onEdited,
    mint: () => `minted${++minted}`,
    now: () => clock,
  });
  return {
    canvas,
    onEdited,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

const nodeOf = (canvas: CanvasDocument, id: string) =>
  canvas.getState().data.nodes.find((node) => node.id === id);
const move = (card: string, x: number): CanvasHandEdit => ({ op: "move", card, x, y: 0 });

describe("undo", () => {
  it("undoes and redoes one gesture at a time", () => {
    const { canvas } = setup();
    canvas.commit([move("a", 20), { op: "reorder", cards: ["a"] }]);
    canvas.commit([move("a", 40)]);
    canvas.undo();
    expect(nodeOf(canvas, "a")?.x).toBe(20);
    canvas.undo();
    expect(nodeOf(canvas, "a")?.x).toBe(0);
    expect(canvas.getState().data.nodes[0]?.id).toBe("a");
    expect(canvas.getState().canUndo).toBe(false);
    canvas.redo();
    canvas.redo();
    expect(nodeOf(canvas, "a")?.x).toBe(40);
    expect(canvas.getState().canRedo).toBe(false);
  });

  it("merges nudges in a row, and not after a pause or another gesture", () => {
    const { canvas, tick } = setup();
    const nudge = (x: number) => canvas.commit([move("a", x)], { merge: "nudge:a" });
    nudge(20);
    tick(200);
    nudge(40);
    tick(200);
    nudge(60);
    canvas.undo();
    expect(nodeOf(canvas, "a")?.x).toBe(0);
    canvas.redo();
    expect(nodeOf(canvas, "a")?.x).toBe(60);

    tick(5000);
    nudge(80);
    canvas.undo();
    expect(nodeOf(canvas, "a")?.x).toBe(60);
    canvas.redo();

    tick(5000);
    nudge(100);
    canvas.commit([{ op: "set-card", card: "a", keys: { color: "1" } }]);
    tick(100);
    nudge(120);
    canvas.undo();
    expect(nodeOf(canvas, "a")?.x).toBe(100);
  });

  it("clears redo on a new edit", () => {
    const { canvas } = setup();
    canvas.commit([move("a", 20)]);
    canvas.undo();
    canvas.commit([move("a", 40)]);
    expect(canvas.getState().canRedo).toBe(false);
  });

  it("works across autosave: what's landed undoes as a new edit", () => {
    const { canvas } = setup();
    canvas.commit([move("a", 20)]);
    const taken = canvas.take()!;
    canvas.landed(taken.through, "c1");
    expect(canvas.take()).toBeNull();
    canvas.undo();
    expect(canvas.take()?.edits).toEqual([{ op: "set-card", card: "a", keys: { x: 0, y: 0 } }]);
  });

  it("puts a removed card back with its unknown keys and arrows", () => {
    const document = {
      nodes: [card("a", { future: 1 }), card("b")],
      edges: [{ id: "e", fromNode: "a", toNode: "b", style: "dashed" }],
    };
    const { canvas } = setup(document);
    canvas.commit([{ op: "remove-card", card: "a" }]);
    expect(canvas.getState().data.edges).toEqual([]);
    canvas.undo();
    expect(canvas.document).toEqual(document);
  });

  it("keeps the camera out of it: only edits make steps", () => {
    const { canvas } = setup();
    canvas.undo();
    expect(canvas.take()).toBeNull();
  });
});

describe("saving", () => {
  it("tells the host at each edit, and hands over everything unlanded", () => {
    const { canvas, onEdited } = setup();
    canvas.commit([move("a", 20)]);
    canvas.commit([move("b", 40)]);
    expect(onEdited).toHaveBeenCalledTimes(2);
    const taken = canvas.take()!;
    expect(taken.edits).toEqual([move("a", 20), move("b", 40)]);
    // Failed: the next take carries it again.
    expect(canvas.take()?.edits).toEqual(taken.edits);
    canvas.landed(taken.through, "c1");
    expect(canvas.take()).toBeNull();
  });

  it("keeps an edit made while a save was in flight", () => {
    const { canvas } = setup();
    canvas.commit([move("a", 20)]);
    const taken = canvas.take()!;
    canvas.commit([move("b", 40)]);
    canvas.landed(taken.through, "c1");
    expect(canvas.take()?.edits).toEqual([move("b", 40)]);
  });

  it("lands the same file whichever side replays it", () => {
    const document = board(card("a", { future: 1 }), { id: "x", type: "hologram" });
    const { canvas } = setup(document);
    canvas.commit([move("a", 20), { op: "put-card", node: card("c") }]);
    const { source } = applyCanvasEdits(
      "Board.canvas",
      serializeCanvas(document),
      canvas.take()!.edits,
      "seed",
    );
    expect(source).toBe(serializeCanvas(canvas.document));
  });
});

describe("a typed card", () => {
  it("saves as it goes, renders nothing, and is one step when it closes", () => {
    const { canvas, onEdited } = setup();
    const listener = vi.fn();
    canvas.subscribe(listener);
    canvas.startTyping("a");
    canvas.type("h");
    canvas.type("hi");
    expect(listener).not.toHaveBeenCalled();
    expect(onEdited).toHaveBeenCalledTimes(2);
    expect(canvas.take()?.edits).toEqual([{ op: "set-card", card: "a", keys: { text: "hi" } }]);
    canvas.finishTyping();
    expect(nodeOf(canvas, "a")).toMatchObject({ text: "hi" });
    canvas.undo();
    expect(nodeOf(canvas, "a")).toMatchObject({ text: "a" });
  });

  it("leaves no step when nothing changed", () => {
    const { canvas } = setup();
    canvas.startTyping("a");
    canvas.finishTyping();
    expect(canvas.getState().canUndo).toBe(false);
  });

  it("keeps an empty card", () => {
    const { canvas } = setup();
    canvas.startTyping("a");
    canvas.type("");
    canvas.finishTyping();
    expect(nodeOf(canvas, "a")).toMatchObject({ text: "" });
  });
});

describe("a commit from elsewhere", () => {
  it("enters beneath this person's unlanded edits, keeping their selection's card", () => {
    const { canvas } = setup();
    canvas.commit([move("a", 20)]);
    canvas.receive(board(card("a", { color: "2" }), card("b"), card("c")), "r1");
    expect(nodeOf(canvas, "a")).toMatchObject({ x: 20, color: "2" });
    expect(nodeOf(canvas, "c")).toBeDefined();
    expect(canvas.getState().flash?.cards.has("c")).toBe(true);
    expect(canvas.getState().notice).toBeNull();
  });

  it("flashes nothing for a person's own edits coming back", () => {
    const { canvas } = setup();
    canvas.commit([move("a", 20)]);
    const taken = canvas.take()!;
    canvas.landed(taken.through, "c1");
    const { document } = canvas;
    canvas.receive(document, "c1");
    expect(canvas.getState().flash).toBeNull();
  });

  it("ignores a read of a commit this person's own later save replaced", () => {
    const { canvas } = setup();
    canvas.commit([move("a", 20)]);
    const first = canvas.take()!;
    canvas.landed(first.through, "c1");
    const old = canvas.document;
    canvas.commit([move("a", 40)]);
    const second = canvas.take()!;
    canvas.landed(second.through, "c2");
    canvas.receive(old, "c1");
    expect(nodeOf(canvas, "a")?.x).toBe(40);
  });

  it("keeps both versions of a card typed in and changed elsewhere, and says so", () => {
    const { canvas, onEdited } = setup();
    canvas.startTyping("a");
    canvas.type("mine");
    onEdited.mockClear();
    canvas.receive(board(card("a", { text: "theirs" }), card("b")), "r1");
    expect(canvas.getState().notice).toContain("Both versions are on the board");
    expect(nodeOf(canvas, "minted1")).toMatchObject({ text: "theirs", y: 80 });
    expect(onEdited).toHaveBeenCalled();
    canvas.finishTyping();
    expect(nodeOf(canvas, "a")).toMatchObject({ text: "mine" });
  });

  it("keeps an unlanded edit's text on a card deleted elsewhere", () => {
    const { canvas } = setup();
    canvas.commit([{ op: "set-card", card: "a", keys: { text: "mine" } }]);
    canvas.receive(board(card("b")), "r1");
    expect(nodeOf(canvas, "a")).toMatchObject({ text: "mine" });
    expect(canvas.getState().notice).toContain(canvasCardName({ type: "text", text: "mine" }));
  });

  it("doesn't take typed text saved mid-edit for a conflict", () => {
    const { canvas } = setup();
    canvas.startTyping("a");
    canvas.type("half");
    const taken = canvas.take()!;
    canvas.landed(taken.through, "c1");
    canvas.type("half done");
    canvas.receive(board(card("a", { text: "half" }), card("b")), "c1");
    expect(canvas.getState().notice).toBeNull();
    expect(canvas.getState().data.nodes).toHaveLength(2);
  });

  it("isn't undone by this person's undo", () => {
    const { canvas } = setup();
    canvas.commit([move("a", 20)]);
    canvas.receive(board(card("a"), card("b"), card("c")), "r1");
    canvas.undo();
    expect(nodeOf(canvas, "c")).toBeDefined();
    expect(nodeOf(canvas, "a")?.x).toBe(0);
  });
});

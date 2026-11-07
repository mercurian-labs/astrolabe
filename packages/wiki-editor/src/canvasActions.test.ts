import { applyCanvasHandEdits } from "@mercurian/wiki/canvas-edits";
import { canvasData, serializeCanvas } from "@mercurian/wiki/canvas";
import { describe, expect, it } from "vite-plus/test";

import {
  arrangeEdits,
  canvasClip,
  clipText,
  filesOfDrop,
  parseClip,
  pasteClip,
  pastedCard,
  placeClip,
  replaceCard,
  serializeClip,
} from "./canvasActions";

const mintFrom = () => {
  let count = 0;
  return () => `new${++count}`;
};

const DOCUMENT = {
  meta: "kept",
  nodes: [
    { id: "g", type: "group", label: "G", x: 0, y: 0, width: 500, height: 300, future: 1 },
    { id: "a", type: "text", text: "Alpha", x: 20, y: 20, width: 100, height: 100, color: "2" },
    { id: "b", type: "file", file: "B.md", x: 200, y: 20, width: 100, height: 100 },
    { id: "out", type: "link", url: "https://x.test", x: 800, y: 0, width: 100, height: 100 },
  ],
  edges: [
    { id: "ab", fromNode: "a", toNode: "b", label: "joins", color: "1", style: "dashed" },
    { id: "ao", fromNode: "a", toNode: "out" },
  ],
};
const { nodes } = canvasData(DOCUMENT);

describe("the clipboard", () => {
  it("takes a group's contents and only the arrows inside what it took", () => {
    const clip = canvasClip(DOCUMENT, nodes, ["g"]);
    expect(clip.nodes.map((node) => node.id)).toEqual(["g", "a", "b"]);
    expect(clip.edges.map((edge) => edge.id)).toEqual(["ab"]);
  });

  it("survives text, unknown keys and all", () => {
    const clip = canvasClip(DOCUMENT, nodes, ["g"]);
    expect(parseClip(serializeClip(clip))).toEqual(clip);
  });

  it("reads a JSON Canvas from anywhere, and leaves ordinary text alone", () => {
    expect(parseClip(serializeCanvas(DOCUMENT))?.nodes).toHaveLength(4);
    expect(parseClip("hello")).toBeNull();
    expect(parseClip('{"not":"a board"}')).toBeNull();
    expect(parseClip("{broken")).toBeNull();
  });

  it("pastes with new ids, its arrows rejoined, and everything else as it was", () => {
    const clip = canvasClip(DOCUMENT, nodes, ["g"]);
    const { edits, cards } = placeClip(clip, 1000, 0, mintFrom());
    const { document } = applyCanvasHandEdits(DOCUMENT, edits);
    const pasted = canvasData(document);
    expect(cards).toEqual(["new1", "new2", "new3"]);
    expect(pasted.nodes.find((node) => node.id === "new1")).toMatchObject({ x: 1000, label: "G" });
    const raw = (document.nodes as ReadonlyArray<Record<string, unknown>>).at(4);
    expect(raw).toMatchObject({ future: 1 });
    expect(document.edges).toContainEqual({
      id: "new4",
      fromNode: "new2",
      toNode: "new3",
      label: "joins",
      color: "1",
      style: "dashed",
    });
    expect(document.meta).toBe("kept");
  });

  it("round-trips across boards: an arrow without both ends stays behind", () => {
    const clip = parseClip(serializeClip(canvasClip(DOCUMENT, nodes, ["a"])))!;
    const other = { nodes: [], edges: [] };
    const { edits } = pasteClip(clip, { x: 300, y: 300 }, mintFrom());
    const { document } = applyCanvasHandEdits(other, edits);
    expect(document.edges).toEqual([]);
    expect(canvasData(document).nodes[0]).toMatchObject({ x: 260, y: 260, text: "Alpha" });
  });

  it("reads as text outside a board", () => {
    expect(clipText(canvasClip(DOCUMENT, nodes, ["g"]))).toBe("G\n\nAlpha\n\nB.md");
  });
});

describe("pasting text", () => {
  it("makes a 400x400 link card centred on the mouse from an address", () => {
    expect(pastedCard("c", { x: 500, y: 500 }, " https://example.test/a ")).toMatchObject({
      type: "link",
      url: "https://example.test/a",
      x: 300,
      y: 300,
      width: 400,
      height: 400,
    });
  });

  it("makes a 250x60 text card centred on the mouse from anything else", () => {
    expect(pastedCard("c", { x: 500, y: 500 }, "two words")).toMatchObject({
      type: "text",
      text: "two words",
      x: 375,
      y: 470,
      width: 250,
      height: 60,
    });
  });
});

describe("arranging", () => {
  it("writes only the cards that move", () => {
    expect(arrangeEdits("align-left", nodes.slice(1, 3))).toEqual([
      { op: "resize", card: "b", x: 20, y: 20, width: 100, height: 100 },
    ]);
  });
});

describe("converting a card", () => {
  it("keeps its arrows, on the new id", () => {
    const raw = DOCUMENT.nodes[1]!;
    const next = { ...raw, id: "file", type: "file", file: "Alpha.md" };
    const { edges } = canvasData(DOCUMENT);
    const { document } = applyCanvasHandEdits(DOCUMENT, replaceCard(raw, next, edges));
    const data = canvasData(document);
    expect(data.nodes.map((node) => node.id)).toEqual(["g", "b", "out", "file"]);
    expect(data.edges.map(({ fromNode, toNode }) => [fromNode, toNode])).toEqual([
      ["file", "b"],
      ["file", "out"],
    ]);
  });
});

describe("filesOfDrop", () => {
  const listed = ["ops/Runbook.md", "ops/deep/queue.png", "opsy/Other.md", "Top.md"];

  it("takes a folder for every file under it, and a file for itself", () => {
    expect(filesOfDrop(["ops/", "Top.md"], listed)).toEqual({
      files: ["ops/Runbook.md", "ops/deep/queue.png", "Top.md"],
      left: 0,
    });
  });

  it("stops at a limit a board can hold, and says how many it left", () => {
    const many = Array.from({ length: 205 }, (_, at) => `src/${at}.md`);
    const { files, left } = filesOfDrop(["src/"], many);
    expect(files).toHaveLength(200);
    expect(left).toBe(5);
  });
});

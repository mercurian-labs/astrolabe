import { describe, expect, it } from "vite-plus/test";

import {
  cardFile,
  embeddedBase,
  filesReadMessages,
  parseWikiEditorCommand,
  parseWikiEditorEvent,
  WIKI_EDITOR_MESSAGE_CHARS,
} from "./protocol";

describe("embeddedBase", () => {
  it("reads an embed's base and view, and leaves a block's YAML alone", () => {
    expect(embeddedBase("![[Open.base#Board]]")).toEqual({ base: "Open.base", view: "Board" });
    expect(embeddedBase("![[Open.base|wide]]")).toEqual({ base: "Open.base", view: undefined });
    expect(embeddedBase('filters: file.ext == "md"')).toBeNull();
  });
});

describe("filesReadMessages", () => {
  const file = (size: number) => ({ exists: true, text: "x".repeat(size) });

  it("splits a batch so no message is larger than one script should be, and keeps order", () => {
    const small = Math.floor(WIKI_EDITOR_MESSAGE_CHARS * 0.6);
    const files = [file(small), file(small), { exists: false, text: null }, file(small)];
    const messages = filesReadMessages(9, files);
    expect(messages.map(({ start, total, files: part }) => [start, total, part.length])).toEqual([
      [0, 4, 1],
      [1, 4, 2],
      [3, 4, 1],
    ]);
    expect(messages.flatMap((message) => message.files)).toEqual(files);
  });

  it("sends a file larger than a message alone, and answers an empty read", () => {
    const large = file(WIKI_EDITOR_MESSAGE_CHARS * 2);
    expect(filesReadMessages(1, [large, file(1)]).map((each) => each.files.length)).toEqual([1, 1]);
    expect(filesReadMessages(2, [])).toEqual([
      { type: "filesRead", requestId: 2, start: 0, total: 0, files: [] },
    ]);
  });
});

describe("cardFile", () => {
  it("cuts a huge note, marks the cut, and leaves a canvas whole", () => {
    const huge = { exists: true, text: "x".repeat(WIKI_EDITOR_MESSAGE_CHARS * 3) };
    const cut = cardFile("Long.md", huge);
    expect(cut.text?.length).toBeLessThan(huge.text.length);
    expect(cut.text?.endsWith("…")).toBe(true);
    expect(cardFile("Nested.canvas", huge)).toBe(huge);
  });
});

describe("the page's messages", () => {
  it("keeps a board's commit and camera, and a thread's board has neither", () => {
    const data = { nodes: [], edges: [] };
    const camera = { x: 1, y: 2, zoom: 0.5 };
    expect(
      parseWikiEditorCommand({ type: "showCanvas", data, revision: "abc", camera }),
    ).toMatchObject({ revision: "abc", camera });
    expect(parseWikiEditorCommand({ type: "showCanvas", data })).toEqual({
      type: "showCanvas",
      data,
    });
  });

  it("keeps a review's marks, and takes a board with broken marks without them", () => {
    const data = { nodes: [], edges: [] };
    const marks = { cards: { a: "added" }, arrows: {} };
    expect(parseWikiEditorCommand({ type: "showCanvas", data, marks })).toMatchObject({ marks });
    expect(parseWikiEditorCommand({ type: "showCanvas", data, marks: { cards: 1 } })).toEqual({
      type: "showCanvas",
      data,
    });
  });

  it("reads a board's camera, null while it fits, and refuses a malformed read", () => {
    const event = (value: unknown) => parseWikiEditorEvent(JSON.stringify(value));
    expect(event({ type: "camera", camera: { x: 1, y: 2, zoom: 1 } })).toEqual({
      type: "camera",
      camera: { x: 1, y: 2, zoom: 1 },
    });
    expect(event({ type: "camera", camera: null })).toEqual({ type: "camera", camera: null });
    expect(event({ type: "readFiles", requestId: 1, paths: ["a.md", 2] })).toBeNull();
    expect(event({ type: "readCodeStatus", requestId: 1, references: [{ path: "a" }] })).toBeNull();
  });
});

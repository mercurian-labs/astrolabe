import { resolveLink } from "@mercurian/wiki/resolve-link";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createWikiEditorPage, type WikiEditorPage } from "./mobilePageController";
import {
  parseWikiEditorCommand,
  parseWikiEditorEvent,
  wikiEditorCommandScript,
  type WikiEditorEvent,
} from "./protocol";

const pages: WikiEditorPage[] = [];
function page() {
  const events: WikiEditorEvent[] = [];
  const created = createWikiEditorPage((event) => events.push(event));
  pages.push(created);
  return { page: created, events };
}

afterEach(() => {
  for (const created of pages.splice(0)) created.dispose();
});

const author = { name: "claude", color: "#d97706", turnId: "run:1" };

describe("the wiki editor page", () => {
  it("loads the first read, reports edits once, and answers for its text", () => {
    const { page: editor, events } = page();
    editor.handle({ type: "receive", source: "# A\n", author: null, turnRunning: false });
    const session = editor.buffer.getSnapshot().session!;
    session.text.insert(session.text.length, "more");
    session.text.insert(session.text.length, "!");
    editor.handle({ type: "requestText", requestId: 7 });
    expect(events).toEqual([
      { type: "state", dirty: false, changedUnderneath: false },
      { type: "state", dirty: true, changedUnderneath: false },
      { type: "edited" },
      { type: "text", requestId: 7, text: "# A\nmore!" },
    ]);
  });

  it("says the person is typing at a walking pace, and when they stop", () => {
    vi.useFakeTimers();
    using _clock = { [Symbol.dispose]: () => vi.useRealTimers() };
    const { page: editor, events } = page();
    editor.handle({ type: "receive", source: "a", author: null, turnRunning: false });
    const { text } = editor.buffer.getSnapshot().session!;
    for (let keystroke = 0; keystroke < 10; keystroke += 1) text.insert(0, "b");
    const edits = () => events.filter((event) => event.type === "edited").length;
    expect(edits()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(edits()).toBe(2);
    vi.advanceTimersByTime(1_000);
    expect(edits()).toBe(2);
  });

  it("lands an author's version live beside the person's edits, then settles on save", () => {
    const { page: editor, events } = page();
    editor.handle({ type: "receive", source: "one\n", author: null, turnRunning: false });
    const session = editor.buffer.getSnapshot().session!;
    session.text.insert(0, "zero\n");
    const before = events.length;
    editor.handle({ type: "receive", source: "one\ntwo\n", author, turnRunning: true });
    expect(editor.buffer.current()).toBe("zero\none\ntwo\n");
    // The landing is reported once, as it ends: still the person's edit, nothing else.
    expect(events.slice(before)).toEqual([]);
    editor.handle({ type: "markSaved", text: "zero\none\ntwo\n" });
    expect(events.at(-1)).toEqual({ type: "state", dirty: false, changedUnderneath: false });
  });

  it("keeps edits when the note changes underneath, until told which to keep", () => {
    const { page: editor, events } = page();
    editor.handle({ type: "receive", source: "a\n", author: null, turnRunning: false });
    const session = editor.buffer.getSnapshot().session!;
    session.text.insert(0, "mine ");
    editor.handle({ type: "receive", source: "theirs\n", author: null, turnRunning: false });
    expect(events.at(-1)).toEqual({ type: "state", dirty: true, changedUnderneath: true });
    editor.handle({ type: "loadChanged" });
    expect(editor.buffer.current()).toBe("theirs\n");
  });

  it("asks the app for each base block once, and keeps every view of it current", () => {
    const { page: editor, events } = page();
    let heard = 0;
    const source = 'filters: file.hasTag("area")';
    editor.watchBase(source, () => heard++);
    editor.watchBase(source, () => heard++);
    expect(events).toEqual([{ type: "queryBase", source }]);
    const result = {
      view: { name: "Table", type: "table" as const },
      columns: [{ id: "file.name", label: "Name" }],
      groupBy: null,
      rows: [{ name: "Alpha", file: "Alpha.md", values: { "file.name": "Alpha.md" } }],
      total: 1,
      truncated: false,
    };
    editor.handle({ type: "baseResult", source, result, error: null });
    expect(editor.getBase(source)).toEqual({ result, error: null });
    expect(heard).toBe(2);
    expect(
      parseWikiEditorCommand({ type: "baseResult", source, result: { rows: "no" }, error: null }),
    ).toEqual({ type: "baseResult", source, result: null, error: "The base sent no view." });
  });

  it("asks the app for a previewed note once, and follows each read of it", () => {
    const { page: editor, events } = page();
    const seen: Array<string | null | undefined> = [];
    const listen = () => seen.push(editor.getNote("Auth"));
    const stop = editor.watchNote("Auth", listen);
    const again = editor.watchNote("Auth", listen);
    expect(events.filter((event) => event.type === "readNote")).toEqual([
      { type: "readNote", name: "Auth" },
    ]);
    expect(editor.getNote("Auth")).toBeUndefined();
    editor.handle({ type: "noteRead", name: "Auth", source: "# Auth\n" });
    editor.handle({ type: "noteRead", name: "Auth", source: null });
    expect(seen).toEqual(["# Auth\n", null]);
    stop();
    again();
  });

  it("holds the wiki's link types for the editor to suggest", () => {
    const { page: editor } = page();
    editor.handle({ type: "linkTypes", types: ["blocks"] });
    expect(editor.getState().linkTypes).toEqual(["blocks"]);
  });

  it("shows a base file alone once told to, and drops a malformed show", () => {
    const { page: editor } = page();
    expect(editor.getState().base).toBeNull();
    const data = { nodes: [], edges: [] };
    expect(parseWikiEditorCommand({ type: "showCanvas", data })).toEqual({
      type: "showCanvas",
      data,
    });
    const code = { path: "src/a.ts", lines: [1, 2] };
    expect(parseWikiEditorEvent(JSON.stringify({ type: "openCode", code, url: "u" }))).toEqual({
      type: "openCode",
      code,
      url: "u",
    });
    const command = parseWikiEditorCommand({ type: "showBase", source: "Projects.base" });
    expect(command).toEqual({ type: "showBase", source: "Projects.base", editable: false });
    editor.handle(command!);
    expect(editor.getState().base).toBe("Projects.base");
    expect(editor.getState().baseEditable).toBe(false);
    editor.handle({ type: "showBase", source: "Projects.base", editable: true });
    expect(editor.getState().baseEditable).toBe(true);
    expect(parseWikiEditorCommand({ type: "showBase" })).toBeNull();
    expect(parseWikiEditorCommand({ type: "showCanvas", data: { nodes: [] } })).toBeNull();
    expect(parseWikiEditorEvent(JSON.stringify({ type: "openCode", code: {} }))).toBeNull();
  });

  it("reads a base edit the page sends, dropping one with a value no cell holds", () => {
    expect(
      parseWikiEditorEvent(
        JSON.stringify({ type: "editBase", file: "Alpha.md", property: "tags", value: ["a"] }),
      ),
    ).toEqual({ type: "editBase", file: "Alpha.md", property: "tags", value: ["a"] });
    expect(
      parseWikiEditorEvent(
        JSON.stringify({ type: "editBase", file: "Alpha.md", property: "x", value: { a: 1 } }),
      ),
    ).toBeNull();
  });

  it("switches between reading and editing", () => {
    const { page: editor } = page();
    expect(editor.getState().mode).toBe("read");
    editor.handle({ type: "mode", mode: "edit" });
    expect(editor.getState().mode).toBe("edit");
  });
});

describe("the wiki editor protocol", () => {
  it("reads what a link preview sends each way, dropping malformed ones", () => {
    expect(parseWikiEditorEvent('{"type":"readNote","name":"Auth"}')).toEqual({
      type: "readNote",
      name: "Auth",
    });
    expect(parseWikiEditorEvent('{"type":"readNote","name":""}')).toBeNull();
    expect(parseWikiEditorCommand({ type: "noteRead", name: "Auth", source: null })).toEqual({
      type: "noteRead",
      name: "Auth",
      source: null,
    });
    expect(parseWikiEditorCommand({ type: "noteRead", name: "Auth" })).toBeNull();
    expect(parseWikiEditorCommand({ type: "linkTypes", types: ["a", 1] })).toEqual({
      type: "linkTypes",
      types: ["a"],
    });
  });

  it("reads commands the app sends, dropping malformed ones and theme entries", () => {
    expect(
      parseWikiEditorCommand({
        type: "theme",
        theme: { appearance: "dark", variables: { "--background": "#000", color: "red" } },
      }),
    ).toEqual({
      type: "theme",
      theme: { appearance: "dark", variables: { "--background": "#000" } },
    });
    expect(parseWikiEditorCommand({ type: "receive", source: 1 })).toBeNull();
    expect(parseWikiEditorCommand({ type: "mode", mode: "write" })).toBeNull();
  });

  it("reads events the page posts, and scripts commands for it", () => {
    expect(parseWikiEditorEvent('{"type":"openNote","name":"Atlas"}')).toEqual({
      type: "openNote",
      name: "Atlas",
    });
    expect(parseWikiEditorEvent('{"type":"error","message":"boom"}')).toEqual({
      type: "error",
      message: "boom",
    });
    expect(parseWikiEditorEvent("not json")).toBeNull();
    expect(parseWikiEditorEvent('{"type":"openNote","name":""}')).toBeNull();
    expect(wikiEditorCommandScript({ type: "discard" })).toBe(
      'window.__wikiEditorReceive&&window.__wikiEditorReceive({"type":"discard"});true;',
    );
  });

  describe("a wiki's board", () => {
    const board = { nodes: [], edges: [] };
    const file = (text: string) => ({ exists: true, text });

    it("puts a read answered in parts back in order, and resolves only when it's whole", async () => {
      const { page: editor, events } = page();
      const read = editor.readFiles(["a.md", "b.md", "c.md"]);
      const asked = events[0] as Extract<WikiEditorEvent, { type: "readFiles" }>;
      expect(asked.paths).toEqual(["a.md", "b.md", "c.md"]);
      const settled = vi.fn();
      void read.then(settled);
      editor.handle({
        type: "filesRead",
        requestId: asked.requestId,
        start: 1,
        total: 3,
        files: [file("b"), file("c")],
      });
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      editor.handle({
        type: "filesRead",
        requestId: asked.requestId,
        start: 0,
        total: 3,
        files: [file("a")],
      });
      await expect(read).resolves.toEqual([file("a"), file("b"), file("c")]);
    });

    it("keeps an image's address through a commit until the new one lands", () => {
      const { page: editor, events } = page();
      const asks = () => events.filter((event) => event.type === "readAsset").length;
      const listener = vi.fn();
      const unmounted = () => undefined;
      editor.handle({ type: "showCanvas", data: board, revision: "one" });
      editor.watchAsset("a.png", unmounted)();
      editor.watchAsset("a.png", unmounted)();
      expect(asks()).toBe(1);
      const expiresAt = Number.MAX_SAFE_INTEGER;
      const landed = { type: "assetRead", path: "a.png", expiresAt } as const;
      editor.handle({ ...landed, revision: "one", url: "http://host/one" });
      const stop = editor.watchAsset("a.png", listener);
      expect(asks()).toBe(1);

      editor.handle({ type: "canvasRevision", revision: "two" });
      editor.watchAsset("a.png", unmounted)();
      expect(asks()).toBe(2);
      expect(editor.getAsset("a.png")).toBe("http://host/one");
      editor.handle({ ...landed, revision: "two", url: "http://host/two" });
      expect(editor.getAsset("a.png")).toBe("http://host/two");
      expect(listener).toHaveBeenCalledOnce();
      stop();
    });

    it("gives a note's embed its address, once the app has said where it is", async () => {
      const { page: editor, events } = page();
      editor.handle({
        type: "receive",
        source: "![[a.png]]",
        author: null,
        turnRunning: false,
        commit: "one",
      });
      const address = editor.assetAddress("a.png");
      expect(events.filter((event) => event.type === "readAsset")).toHaveLength(1);
      const expiresAt = Number.MAX_SAFE_INTEGER;
      editor.handle({
        type: "assetRead",
        path: "a.png",
        revision: "one",
        url: "http://host/a",
        expiresAt,
      });
      expect(await address).toMatchObject({ url: "http://host/a", expiresAt });
      await editor.assetAddress("a.png");
      expect(events.filter((event) => event.type === "readAsset")).toHaveLength(1);
    });

    it("asks again for an address that has stopped working", () => {
      const { page: editor, events } = page();
      editor.handle({ type: "showCanvas", data: board, revision: "one" });
      editor.watchAsset("a.png", () => undefined)();
      editor.handle({
        type: "assetRead",
        path: "a.png",
        revision: "one",
        url: "http://host/old",
        expiresAt: 0,
      });
      editor.watchAsset("a.png", () => undefined)();
      expect(events.filter((event) => event.type === "readAsset")).toHaveLength(2);
    });

    it("reports a camera once it rests, and not again unless it moved", () => {
      vi.useFakeTimers();
      try {
        const { page: editor, events } = page();
        const cameras = () => events.filter((event) => event.type === "camera");
        editor.reportCamera({ x: 1, y: 1, zoom: 1 });
        editor.reportCamera({ x: 2, y: 2, zoom: 1 });
        expect(cameras()).toEqual([]);
        vi.runAllTimers();
        expect(cameras()).toEqual([{ type: "camera", camera: { x: 2, y: 2, zoom: 1 } }]);
        editor.reportCamera({ x: 2, y: 2, zoom: 1 });
        vi.runAllTimers();
        expect(cameras()).toHaveLength(1);
        editor.reportCamera(null);
        vi.runAllTimers();
        expect(cameras().at(-1)).toEqual({ type: "camera", camera: null });
      } finally {
        vi.useRealTimers();
      }
    });

    it("crosses a board's edits to the app, whole, and hears what landed", () => {
      vi.useFakeTimers();
      try {
        const { page: editor, events } = page();
        const document = { nodes: [{ id: "a", type: "text", text: "A" }], edges: [] };
        const data = { nodes: [], edges: [] };
        editor.handle({ type: "showCanvas", data, document, revision: "r0" });
        const board = editor.getState().editing!;
        expect(board.getState().data.nodes).toHaveLength(1);
        const edited = () => events.filter((event) => event.type === "canvasEdited");

        board.commit([{ op: "move", card: "a", x: 20, y: 0 }]);
        expect(edited()).toHaveLength(1);
        board.commit([{ op: "move", card: "a", x: 40, y: 0 }]);
        expect(edited()).toHaveLength(1);
        vi.advanceTimersByTime(500);
        const [, latest] = edited();
        expect(latest).toMatchObject({ through: 2 });
        expect(latest?.type === "canvasEdited" ? latest.edits : []).toHaveLength(2);

        editor.handle({ type: "canvasLanded", through: 2, commit: "c1" });
        expect(board.take()).toBeNull();

        // The same board stays: a new read enters it, under what's unlanded.
        board.commit([{ op: "set-card", card: "a", keys: { color: "1" } }]);
        const moved = { nodes: [{ id: "a", type: "text", text: "B" }], edges: [] };
        editor.handle({ type: "showCanvas", data, document: moved, revision: "r1" });
        expect(editor.getState().editing).toBe(board);
        expect(board.getState().data.nodes[0]).toMatchObject({ text: "B", color: "1" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("asks the app what a board can't reach, each answer to its own question", async () => {
      const { page: editor, events } = page();
      const answer = editor.askApp({ kind: "list-files" });
      const asked = events.find((event) => event.type === "canvasAsk");
      expect(asked).toMatchObject({ ask: { kind: "list-files" } });
      editor.handle({
        type: "canvasAnswer",
        requestId: asked?.type === "canvasAsk" ? asked.requestId : -1,
        answer: { kind: "files", files: ["A.md"] },
      });
      await expect(answer).resolves.toEqual({ kind: "files", files: ["A.md"] });
    });

    it("hands Jump to group to the board on screen", () => {
      const { page: editor } = page();
      const focusCard = vi.fn();
      const selectCard = vi.fn();
      editor.handle({ type: "focusCard", id: "before" });
      editor.setBoard({ focusCard, selectCard, run: vi.fn() });
      editor.handle({ type: "focusCard", id: "group" });
      expect(focusCard.mock.calls).toEqual([["group"]]);
      editor.handle({ type: "focusCard", id: "changed", select: true });
      expect(selectCard.mock.calls).toEqual([["changed"]]);
    });

    it("searches known documents as the wiki does, from the file on the page", () => {
      const { page: editor } = page();
      editor.handle({
        type: "knownDocuments",
        files: ["Board.canvas", "Café.md", "a/Near.md", "b/Near.md"],
        from: "b/Page.canvas",
      });
      const known = editor.getState().knownDocuments!;
      const target = (name: string) => resolveLink(name, known.from, known.files).file;
      expect(target("board.CANVAS")).toBe("Board.canvas");
      expect(target("Cafe\u0301")).toBe("Café.md");
      expect(target("Near")).toBe("b/Near.md");
      expect(target("Missing")).toBeNull();
    });
  });
});

import { afterEach, describe, expect, it } from "vite-plus/test";

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
      { type: "text", requestId: 7, text: "# A\nmore!" },
    ]);
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
    expect(parseWikiEditorEvent(JSON.stringify({ type: "openCode", code }))).toEqual({
      type: "openCode",
      code,
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
});

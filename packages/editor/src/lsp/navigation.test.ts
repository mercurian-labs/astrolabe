import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";

import { vimMode, type VimHistory } from "../vim.ts";
import {
  environmentNavigation,
  findReferences,
  goToDefinition,
  type NavigationLocation,
  showIncomingCalls,
  showOutgoingCalls,
} from "./navigation.ts";
import { setup, URI } from "./testing.ts";

const noHistory: VimHistory = { undo() {}, redo() {}, stopCapturing() {}, groupExplicitly() {} };

const TEXT = [
  "function makePoint() {}",
  "const a = makePoint();",
  "",
  "",
  "",
  "",
  "",
  "",
  "const b = makePoint();",
  "",
].join("\n");

const OTHER = "file:///repo/src/point.ts";

function locationOf(text: string, needle: string, nth = 0) {
  let at = -1;
  for (let index = 0; index <= nth; index++) at = text.indexOf(needle, at + 1);
  const before = text.slice(0, at).split("\n");
  const start = { line: before.length - 1, character: before.at(-1)!.length };
  return {
    uri: URI,
    range: { start, end: { ...start, character: start.character + needle.length } },
  };
}

async function open(
  answers: Partial<Record<string, unknown>>,
  extra: { vim?: boolean; hold?: boolean } = {},
) {
  const opened: NavigationLocation[] = [];
  const nothing: string[] = [];
  const picked: Array<{
    title: string;
    locations: readonly NavigationLocation[];
    kind: string;
  }> = [];
  const editor = setup(TEXT, {
    capabilities: {
      definitionProvider: true,
      referencesProvider: true,
      callHierarchyProvider: true,
    },
    answer: (method) => (extra.hold ? undefined : (answers[method] ?? null)),
    extensions: [
      // As a code file's editing allows.
      EditorState.allowMultipleSelections.of(true),
      environmentNavigation({
        keys: {
          definition: [],
          declaration: [],
          typeDefinition: [],
          implementation: [],
          references: [],
          incomingCalls: [],
          outgoingCalls: [],
        },
        host: {
          open: (location) => opened.push(location),
          pick: (_view, title, locations, kind) => picked.push({ title, locations, kind }),
          nothing: (title) => nothing.push(title),
        },
      }),
      extra.vim ? vimMode(noHistory) : [],
    ],
  });
  await editor.initialize();
  return { ...editor, opened, picked, nothing };
}

const selected = (view: EditorView) =>
  view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to));

describe("environmentNavigation", () => {
  it("selects a definition in this file where it is now, after edits made while asking", async () => {
    const editor = await open({}, { hold: true });
    try {
      editor.view.dispatch({ selection: { anchor: TEXT.indexOf("makePoint();") } });
      goToDefinition(editor.view);
      const asked = () =>
        editor.sent.find((entry) => entry.message.method === "textDocument/definition");
      await vi.waitFor(() => expect(asked()).toBeDefined());
      const request = asked()!;
      // You type a line at the top before the answer comes.
      editor.type(0, "// mine\n");
      editor.lsp.receive(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.message.id,
          result: locationOf(TEXT, "makePoint"),
        }),
      );
      await vi.waitFor(() => expect(editor.view.state.selection.main.from).toBe(17));
      expect(selected(editor.view)).toEqual(["makePoint"]);
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("lists a symbol's calls under a heading, even one, and says when it has none", async () => {
    const editor = await open({
      "textDocument/prepareCallHierarchy": [{ name: "makePoint", data: { kept: true } }],
      "callHierarchy/incomingCalls": [locationOf(TEXT, "makePoint", 1)],
      "callHierarchy/outgoingCalls": [],
    });
    try {
      editor.view.dispatch({ selection: { anchor: TEXT.indexOf("makePoint") } });
      showIncomingCalls(editor.view);
      await vi.waitFor(() => expect(editor.picked).toHaveLength(1));
      expect(editor.picked[0]).toMatchObject({
        title: "Incoming calls of makePoint",
        kind: "incoming",
      });
      expect(editor.picked[0]!.locations.map((place) => place.line)).toEqual([2]);
      const asked = editor.sent.find(
        (entry) => entry.message.method === "callHierarchy/incomingCalls",
      );
      expect(asked?.message.params.item.data).toEqual({ kept: true });

      showOutgoingCalls(editor.view);
      await vi.waitFor(() => expect(editor.nothing).toEqual(["Outgoing calls of makePoint"]));
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("opens a definition in another file through the host", async () => {
    const editor = await open({
      "textDocument/definition": [
        {
          targetUri: OTHER,
          targetRange: { start: { line: 4, character: 0 }, end: { line: 4, character: 30 } },
          targetSelectionRange: {
            start: { line: 4, character: 16 },
            end: { line: 4, character: 25 },
          },
          "astrolabe/preview": "export function makePoint() {}",
        },
      ],
    });
    try {
      editor.view.dispatch({ selection: { anchor: TEXT.indexOf("makePoint();") } });
      goToDefinition(editor.view);
      await vi.waitFor(() => expect(editor.opened).toHaveLength(1));
      expect(editor.opened[0]).toEqual({
        uri: OTHER,
        line: 5,
        column: 17,
        endLine: 5,
        endColumn: 26,
        preview: "export function makePoint() {}",
        here: null,
      });
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("selects places close together, and lists places far apart", async () => {
    const close = [locationOf(TEXT, "makePoint", 0), locationOf(TEXT, "makePoint", 1)];
    const far = [locationOf(TEXT, "makePoint", 0), locationOf(TEXT, "makePoint", 2)];
    const editor = await open({ "textDocument/references": close });
    try {
      editor.view.dispatch({ selection: { anchor: 10 } });
      findReferences(editor.view);
      await vi.waitFor(() => expect(selected(editor.view)).toEqual(["makePoint", "makePoint"]));
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
    const listing = await open({ "textDocument/references": far });
    try {
      listing.view.dispatch({ selection: { anchor: 10 } });
      findReferences(listing.view);
      await vi.waitFor(() => expect(listing.picked).toHaveLength(1));
      expect(listing.picked[0]).toMatchObject({
        title: "References of makePoint",
        kind: "references",
      });
      expect(listing.picked[0]!.locations.map((place) => [place.line, place.preview])).toEqual([
        [1, "function makePoint() {}"],
        [9, "const b = makePoint();"],
      ]);
    } finally {
      listing.view.destroy();
      listing.lsp.destroy();
    }
  });

  it("lists the references when you ask for the definition of a definition", async () => {
    const editor = await open({
      "textDocument/definition": locationOf(TEXT, "makePoint", 0),
      "textDocument/references": [
        locationOf(TEXT, "makePoint", 0),
        locationOf(TEXT, "makePoint", 2),
      ],
    });
    try {
      editor.view.dispatch({ selection: { anchor: TEXT.indexOf("makePoint") + 2 } });
      goToDefinition(editor.view);
      await vi.waitFor(() => expect(editor.picked).toHaveLength(1));
      expect(editor.picked[0]).toMatchObject({
        title: "References of makePoint",
        kind: "references",
      });
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });

  it("goes to the definition from Vim's gd", async () => {
    const editor = await open(
      { "textDocument/definition": locationOf(TEXT, "makePoint", 0) },
      { vim: true },
    );
    try {
      editor.view.dispatch({ selection: { anchor: TEXT.lastIndexOf("makePoint") } });
      editor.view.focus();
      for (const key of "gd") {
        editor.view.contentDOM.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            code: `Key${key.toUpperCase()}`,
            keyCode: key.toUpperCase().charCodeAt(0),
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      await vi.waitFor(() => expect(editor.view.state.selection.main.from).toBe(9));
    } finally {
      editor.view.destroy();
      editor.lsp.destroy();
    }
  });
});

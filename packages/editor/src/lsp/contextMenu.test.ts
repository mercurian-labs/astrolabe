import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vite-plus/test";

import { codeContextMenu, type CodeContextMenuHost, type ContextMenuEntry } from "./contextMenu.ts";
import { environmentNavigation, type NavigationLocation } from "./navigation.ts";
import { setup } from "./testing.ts";

const TEXT = "function makePoint() {}\nconst a = makePoint();\n";

/** A host that picks `choose` (by label) from whatever the menu offers, and records it. */
function menuHost(choose: string | null, clipboard = { text: "" }) {
  const shown: Array<readonly ContextMenuEntry[]> = [];
  const host: CodeContextMenuHost = {
    show: async (entries) => {
      shown.push(entries);
      return entries.find((entry) => entry.label === choose)?.id ?? null;
    },
    readClipboard: async () => clipboard.text,
    writeClipboard: async (text) => {
      clipboard.text = text;
    },
    fileEntries: [{ label: "Copy Relative Path", run: () => undefined }],
  };
  return { host, shown, clipboard };
}

/** Right-clicks `view` where the text position `pos` is (happy-dom has no layout to ask). */
function rightClick(view: EditorView, pos: number | null) {
  using _at = vi.spyOn(view, "posAtCoords").mockReturnValue(pos as number);
  view.contentDOM.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
  );
}

const labels = (entries: readonly ContextMenuEntry[]) =>
  entries.map(
    (entry) =>
      `${entry.separatorBefore ? "| " : ""}${entry.label}${entry.disabled ? " (off)" : ""}`,
  );

describe("codeContextMenu", () => {
  it("goes to the definition of the name you right-clicked", async () => {
    const opened: NavigationLocation[] = [];
    const call = TEXT.lastIndexOf("makePoint");
    const { host } = menuHost("Go to Definition");
    const editor = setup(TEXT, {
      capabilities: { definitionProvider: true },
      answer: (method, params) =>
        method === "textDocument/definition" && params.position.line === 1
          ? {
              uri: "file:///repo/src/other.ts",
              range: { start: { line: 0, character: 9 }, end: { line: 0, character: 18 } },
            }
          : null,
      extensions: [
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
            pick: () => undefined,
            nothing: () => undefined,
          },
        }),
        codeContextMenu(host),
      ],
    });
    await editor.initialize();
    rightClick(editor.view, call + 2);
    expect(editor.view.state.selection.main.head).toBe(call + 2);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]!.uri).toBe("file:///repo/src/other.ts");
  });

  it("keeps a selection you right-click inside, and fades what the server can't do", async () => {
    const { host, shown } = menuHost(null);
    const editor = setup(TEXT, {
      capabilities: { definitionProvider: true, referencesProvider: true, renameProvider: true },
      extensions: [codeContextMenu(host)],
    });
    rightClick(editor.view, 3);
    // Before the server is ready nothing it answers can run.
    expect(
      labels(shown[0]!)
        .slice(0, 7)
        .every((label) => label.endsWith("(off)")),
    ).toBe(true);

    await editor.initialize();
    editor.view.dispatch({ selection: EditorSelection.range(0, 8) });
    rightClick(editor.view, 3);
    expect(editor.view.state.selection.main).toMatchObject({ from: 0, to: 8 });
    expect(labels(shown[1]!)).toEqual([
      "Go to Definition",
      "Go to Type Definition (off)",
      "Go to Implementation (off)",
      "Find All References",
      "Show Incoming Calls (off)",
      "Show Outgoing Calls (off)",
      "| Rename Symbol…",
      "Code Actions… (off)",
      "Format Document (off)",
      "| Cut",
      "Copy",
      "Paste",
      "| Copy Relative Path",
    ]);
  });

  it("cuts, copies and pastes through the clipboard, and offers no language items without a server", async () => {
    const clipboard = { text: "" };
    const cut = menuHost("Cut", clipboard);
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: TEXT,
        selection: EditorSelection.range(0, 9),
        extensions: [codeContextMenu(cut.host)],
      }),
    });
    rightClick(view, 4);
    expect(labels(cut.shown[0]!)).toEqual(["Cut", "Copy", "Paste", "| Copy Relative Path"]);
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe(TEXT.slice(9)));
    expect(clipboard.text).toBe("function ");

    view.setState(
      EditorState.create({
        doc: "x",
        selection: { anchor: 1 },
        extensions: [codeContextMenu(menuHost("Paste", clipboard).host)],
      }),
    );
    rightClick(view, 1);
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("xfunction "));

    const readOnly = menuHost(null);
    view.setState(
      EditorState.create({
        doc: "x",
        extensions: [EditorState.readOnly.of(true), codeContextMenu(readOnly.host)],
      }),
    );
    rightClick(view, 0);
    expect(labels(readOnly.shown[0]!)).toEqual([
      "Cut (off)",
      "Copy (off)",
      "Paste (off)",
      "| Copy Relative Path",
    ]);
    view.destroy();
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { Vim, getCM, vim as packageVim, type CodeMirrorV } from "@replit/codemirror-vim";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { AtlasEditor } from "./editor.tsx";
import { caret, destroyViews, finishParse, mount } from "./markdown/testSupport.ts";
import {
  enterInsertMode,
  runVimEx,
  vimAtRest,
  vimConfiguration,
  vimExLine,
  vimHostKeys,
  vimInsertMode,
  vimMode,
  type VimHistory,
} from "./vim.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

// Browsers queue `selectionchange` as a task; happy-dom fires it synchronously, inside the
// update of a focused child (cell) editor. These tests drive selections through
// transactions, so the event is dropped here, as the table tests do.
const dispatchEvent = document.dispatchEvent.bind(document);
beforeAll(() => {
  document.dispatchEvent = (event) => event.type === "selectionchange" || dispatchEvent(event);
});
afterAll(() => {
  document.dispatchEvent = dispatchEvent;
});

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(async () => {
  destroyViews();
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
});

const mac = /Mac/.test(navigator.platform);

/**
 * Presses a key through the editor's real key handling (a keydown on its content), so Vim
 * sees it as it would a keyboard's. `binding` is a key name, optionally with `Ctrl-`,
 * `Shift-`, or `Mod-` (Cmd on macOS, else Ctrl).
 */
function press(view: EditorView, binding: string) {
  const parts = binding.split("-");
  const key = parts.length > 1 && parts.at(-1) === "" ? "-" : (parts.pop() ?? "");
  const mod = parts.includes("Mod");
  const event = new KeyboardEvent("keydown", {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : key === "Escape" ? 27 : 0,
    shiftKey: parts.includes("Shift"),
    ctrlKey: parts.includes("Ctrl") || (mod && !mac),
    metaKey: mod && mac,
    bubbles: true,
    cancelable: true,
  });
  view.contentDOM.dispatchEvent(event);
}

function keys(view: EditorView, sequence: string) {
  for (const key of sequence) press(view, key);
}

/** Types at the caret as the keyboard would in insert mode. */
function type(view: EditorView, text: string) {
  view.dispatch({ ...view.state.replaceSelection(text), userEvent: "input.type" });
}

/** Keys as a keyboard sends them in insert mode: each keydown, then its text input. */
function typeKeys(view: EditorView, text: string) {
  for (const character of text) {
    press(view, character);
    type(view, character);
  }
}

/** Two docs relayed both ways, as a provider would: the user's and an agent peer's. */
function peers(initial: string) {
  const REMOTE = Symbol("remote");
  const user = new Y.Doc();
  const agent = new Y.Doc();
  user.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(agent, update, REMOTE);
  });
  agent.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE) Y.applyUpdate(user, update, REMOTE);
  });
  const text = user.getText("note");
  text.insert(0, initial);
  return { text, agentText: agent.getText("note") };
}

/** The active cell's editor in `view`, if any. */
function cellEditor(view: EditorView) {
  const element = view.contentDOM.querySelector<HTMLElement>(".cm-md-cell-editor");
  return element ? EditorView.findFromDOM(element) : null;
}

/** Activates the `index`th body cell as a click would. */
function clickCell(view: EditorView, index: number) {
  const cells = view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-widget td");
  cells[index]?.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
  );
}

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function isVim(
  cm: NonNullable<ReturnType<typeof getCM>>,
): cm is NonNullable<ReturnType<typeof getCM>> & CodeMirrorV {
  return cm.state.vim !== undefined && cm.state.vim !== null;
}

const mode = (view: EditorView) => {
  const state = getCM(view)?.state.vim;
  if (!state) return null;
  return state.insertMode ? "insert" : state.visualMode ? "visual" : "normal";
};

const panel = (view: EditorView) =>
  view.dom.querySelector(".atlas-vim-mode")?.textContent?.trim() ?? null;

/** History for editors mounted without Yjs: these tests do not undo. */
const noHistory: VimHistory = { undo() {}, redo() {}, stopCapturing() {}, groupExplicitly() {} };

/** A live-preview editor with Vim mode, focused once so reveal works. */
function vimEditor(doc: string, caretAt = 0) {
  const view = mount(doc, {
    focused: true,
    selection: [caretAt],
    extensions: vimMode(noHistory),
  });
  return view;
}

/** `AtlasEditor` as a host mounts it, bound to `text`. */
async function atlas(text: Y.Text, vim: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  const awareness = new Awareness(text.doc ?? new Y.Doc());
  const render = (on: boolean) =>
    act(async () =>
      root.render(
        createElement(AtlasEditor, {
          text,
          awareness,
          vim: on,
        }),
      ),
    );
  await render(vim);
  const editor = host.querySelector<HTMLElement>(".cm-editor");
  const view = editor ? EditorView.findFromDOM(editor) : null;
  if (!view) throw new Error("AtlasEditor did not mount a view");
  return { view, render };
}

describe("Vim mode", () => {
  it("A116. starts in normal mode; i enters insert mode, typing lands, Escape returns; the panel shows the mode", async () => {
    const text = new Y.Doc().getText("note");
    text.insert(0, "hello\n");
    const { view } = await atlas(text, true);

    expect(mode(view)).toBe("normal");
    expect(panel(view)).toContain("--NORMAL--");

    press(view, "i");
    expect(mode(view)).toBe("insert");
    expect(panel(view)).toContain("--INSERT--");
    type(view, "say ");
    expect(text.toString()).toBe("say hello\n");

    press(view, "Escape");
    expect(mode(view)).toBe("normal");
    expect(panel(view)).toContain("--NORMAL--");
  });

  it("A117. dd is one Yjs undo step: u restores it, Ctrl-r removes it again, an agent's insertion stays", async () => {
    const REMOTE = Symbol("remote");
    const user = new Y.Doc();
    const agent = new Y.Doc();
    user.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(agent, update, REMOTE);
    });
    agent.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(user, update, REMOTE);
    });
    const text = user.getText("note");
    text.insert(0, "# List\n\n- one\n- two\n- three\n");
    const { view } = await atlas(text, true);
    view.dispatch({ selection: { anchor: "# List\n\n- one\n".length } });

    keys(view, "dd");
    expect(text.toString()).toBe("# List\n\n- one\n- three\n");

    // An agent writes elsewhere while the deletion stands.
    agent.getText("note").insert(agent.getText("note").length, "agent line\n");
    expect(text.toString()).toBe("# List\n\n- one\n- three\nagent line\n");

    press(view, "u");
    expect(text.toString()).toBe("# List\n\n- one\n- two\n- three\nagent line\n");
    press(view, "Ctrl-r");
    expect(text.toString()).toBe("# List\n\n- one\n- three\nagent line\n");
    press(view, "U");
    expect(text.toString()).toBe("# List\n\n- one\n- two\n- three\nagent line\n");
  });

  it("A118. w lands past hidden syntax on a visible character and reveals the span; l steps one character; $ lands on the last", () => {
    const view = vimEditor("L **bold** R\n");
    finishParse(view);

    press(view, "w");
    expect(caret(view)).toBe("L **".length);
    // The span is revealed: its markers are no longer stepped over.
    const hidden = view.state
      .facet(EditorView.atomicRanges)
      .some((source) => source(view).size > 0 && hasRangeAt(source(view), 2));
    expect(hidden).toBe(false);

    const steps: number[] = [];
    for (let i = 0; i < 4; i++) {
      press(view, "l");
      steps.push(caret(view));
    }
    expect(steps).toEqual([5, 6, 7, 8]);

    press(view, "$");
    expect(caret(view)).toBe("L **bold** ".length);
    expect(view.state.doc.sliceString(caret(view), caret(view) + 1)).toBe("R");
  });

  it("A118. l from the space before a hidden marker steps over it onto the text", () => {
    const view = vimEditor("L **bold** R\n");
    finishParse(view);

    press(view, "l");
    expect(caret(view)).toBe(1);
    press(view, "l");
    expect(caret(view)).toBe("L **".length);
  });

  it("A119. in insert mode Mod-b wraps the word, Enter continues a list, Tab indents an item", () => {
    const bold = vimEditor("say hello\n", "say hel".length);
    press(bold, "i");
    press(bold, "Mod-b");
    expect(bold.state.doc.toString()).toBe("say **hello**\n");

    const list = vimEditor("- one\n", "- one".length);
    press(list, "a");
    expect(mode(list)).toBe("insert");
    press(list, "Enter");
    expect(list.state.doc.toString()).toBe("- one\n- \n");

    const indent = vimEditor("- one\n- two\n", "- one\n- two".length);
    press(indent, "i");
    press(indent, "Tab");
    expect(indent.state.doc.toString()).toBe("- one\n  - two\n");
  });

  it("A120. in a table cell, Escape goes to normal mode in the cell, a second leaves it; j moves to the row below", async () => {
    const doc = "| Name | Note |\n| --- | --- |\n| one | x |\n| two | y |\n\nafter";
    const view = vimEditor(doc, doc.length);
    finishParse(view);
    // Activate the first body cell as a click would.
    view.contentDOM
      .querySelectorAll<HTMLElement>(".cm-md-table-widget td")[0]
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    const cell = () => {
      const element = view.contentDOM.querySelector<HTMLElement>(".cm-md-cell-editor");
      return element ? EditorView.findFromDOM(element) : null;
    };
    const first = cell();
    if (!first) throw new Error("no active cell");
    expect(first.state.doc.toString()).toBe("one");
    expect(mode(first)).toBe("normal");

    // j moves to the row below's cell.
    press(first, "j");
    await Promise.resolve();
    expect(cell()?.state.doc.toString()).toBe("two");

    const second = cell();
    if (!second) throw new Error("no active cell");
    press(second, "i");
    expect(mode(second)).toBe("insert");
    press(second, "Escape");
    await Promise.resolve();
    expect(mode(second)).toBe("normal");
    expect(cell()).toBe(second);

    press(second, "Escape");
    await Promise.resolve();
    expect(cell()).toBeNull();
    // 4.11: the outer caret goes to the line after the table.
    expect(caret(view)).toBe(doc.indexOf("\n\nafter") + 1);
  });

  it("A121. with Vim mode off nothing is installed: i types, no panel; switching it on and off reconfigures in place", async () => {
    const text = new Y.Doc().getText("note");
    text.insert(0, "hello\n");
    const { view, render } = await atlas(text, false);

    expect(getCM(view)).toBeNull();
    expect(panel(view)).toBeNull();
    press(view, "i");
    // No Vim: the key is not taken, so the editor would type it.
    expect(mode(view)).toBeNull();

    await render(true);
    expect(EditorView.findFromDOM(view.dom)).toBe(view);
    expect(mode(view)).toBe("normal");
    expect(panel(view)).toContain("--NORMAL--");

    await render(false);
    expect(EditorView.findFromDOM(view.dom)).toBe(view);
    expect(getCM(view)).toBeNull();
    expect(panel(view)).toBeNull();
  });
  it("A117. a whole change is one undo step: cwbar<Escape> undoes in one u, an agent's line untouched", async () => {
    const { text, agentText } = peers("hello world\n");
    const { view } = await atlas(text, true);

    keys(view, "cw");
    expect(mode(view)).toBe("insert");
    typeKeys(view, "ba");
    agentText.insert(agentText.length, "agent line\n");
    typeKeys(view, "r");
    press(view, "Escape");
    expect(text.toString()).toBe("bar world\nagent line\n");

    press(view, "u");
    expect(text.toString()).toBe("hello world\nagent line\n");
    press(view, "Ctrl-r");
    expect(text.toString()).toBe("bar world\nagent line\n");

    // An insert session is one step too.
    keys(view, "A");
    typeKeys(view, "!!");
    press(view, "Escape");
    expect(text.toString()).toBe("bar world!!\nagent line\n");
    press(view, "u");
    expect(text.toString()).toBe("bar world\nagent line\n");
  });

  it("visual mode leaves the selection to Vim: v l l d deletes exactly what is shown beside hidden markers", () => {
    const view = vimEditor("L **bold** R\n", 1);
    finishParse(view);

    // After each key the shown selection is the one Vim holds, one character wider each time.
    const shown = () => {
      const { from, to } = view.state.selection.main;
      return view.state.sliceDoc(from, to);
    };
    const seen: string[] = [];
    for (const key of "vll") {
      press(view, key);
      seen.push(shown());
    }
    expect(seen).toEqual([" ", " *", " **"]);
    expect(mode(view)).toBe("visual");

    press(view, "d");
    expect(view.state.doc.toString()).toBe("Lbold** R\n");
  });

  it("A120. a cell reached by Tab, Shift-Tab, or Enter while inserting starts in insert mode", async () => {
    const doc = "| Name | Note |\n| --- | --- |\n| one | x |\n| two | y |\n\nafter";
    const view = vimEditor(doc, doc.length);
    finishParse(view);
    clickCell(view, 0);
    const first = cellEditor(view);
    if (!first) throw new Error("no active cell");
    press(first, "i");

    for (const [binding, expected] of [
      ["Tab", "x"],
      ["Shift-Tab", "one"],
      ["Enter", "two"],
    ] as const) {
      const departing = cellEditor(view);
      if (!departing) throw new Error("no active cell");
      press(departing, binding);
      await settle();
      const arrived = cellEditor(view);
      expect(arrived?.state.doc.toString(), binding).toBe(expected);
      expect(arrived && mode(arrived), binding).toBe("insert");
    }
  });

  it("the panel follows the active cell's mode, and returns to the editor's when the cell closes", async () => {
    const doc = "| Name | Note |\n| --- | --- |\n| one | x |\n\nafter";
    const view = vimEditor(doc, doc.length);
    finishParse(view);
    clickCell(view, 0);
    await settle();
    const cell = cellEditor(view);
    if (!cell) throw new Error("no active cell");
    expect(panel(view)).toBe("--NORMAL--");

    press(cell, "i");
    expect(panel(view)).toBe("--INSERT--");
    press(cell, "Escape");
    expect(panel(view)).toBe("--NORMAL--");
    press(cell, "v");
    expect(panel(view)).toBe("--VISUAL--");
    press(cell, "Escape");
    press(cell, "Escape");
    await settle();
    expect(cellEditor(view)).toBeNull();
    expect(panel(view)).toBe("--NORMAL--");

    // The editor's own mode again.
    press(view, "i");
    expect(panel(view)).toBe("--INSERT--");
  });

  it("switching Vim with a cell open reconfigures the cell in place, both ways", async () => {
    const doc = "| Name | Note |\n| --- | --- |\n| one | x |\n\nafter";
    const text = new Y.Doc().getText("note");
    text.insert(0, doc);
    const { view, render } = await atlas(text, false);
    finishParse(view);
    clickCell(view, 0);
    await settle();
    const cell = cellEditor(view);
    if (!cell) throw new Error("no active cell");
    expect(getCM(cell)).toBeNull();

    await render(true);
    expect(EditorView.findFromDOM(view.dom)).toBe(view);
    expect(cellEditor(view)).toBe(cell);
    expect(mode(cell)).toBe("normal");
    press(cell, "i");
    expect(mode(cell)).toBe("insert");
    typeKeys(cell, "s");
    // The typed character reaches the outer document through the cell.
    expect(text.toString()).toContain("| ones |");
    press(cell, "Escape");
    expect(mode(cell)).toBe("normal");
    expect(cellEditor(view)).toBe(cell);

    await render(false);
    expect(EditorView.findFromDOM(view.dom)).toBe(view);
    expect(cellEditor(view)).toBe(cell);
    expect(getCM(cell)).toBeNull();
    // Plain cell keys again: Escape leaves the cell at once.
    press(cell, "Escape");
    await settle();
    expect(cellEditor(view)).toBeNull();
  });

  it("leaves another Vim editor's :w, :q, and U as the package defines them", async () => {
    const text = new Y.Doc().getText("note");
    text.insert(0, "hello\n");
    const atlasEditor = await atlas(text, true);
    const record = mounted.pop();
    if (!record) throw new Error("no mounted editor");
    await act(async () => record.root.unmount());
    record.host.remove();
    expect(atlasEditor.view.dom.isConnected).toBe(false);

    const plain = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "hello\n", extensions: [packageVim()] }),
    });
    const cm = getCM(plain);
    if (!cm || !isVim(cm)) throw new Error("no Vim on the plain editor");
    let saved = 0;
    Reflect.set(cm, "save", () => {
      saved += 1;
    });
    Vim.handleEx(cm, "w");
    expect(saved).toBe(1);

    Vim.handleEx(cm, "q");
    expect(plain.dom.textContent).toContain('Not an editor command ":q"');

    plain.dispatch({ changes: { from: 0, insert: "x" } });
    press(plain, "U");
    expect(plain.state.doc.toString()).toBe("xhello\n");
    plain.destroy();
  });
  it("switching Vim off hands the undo window back: edits 650 ms apart undo one at a time", async () => {
    const text = new Y.Doc().getText("note");
    text.insert(0, "one\n");
    const { view, render } = await atlas(text, true);
    await render(false);
    const typeAtEnd = (insert: string) =>
      view.dispatch({ changes: { from: view.state.doc.length, insert }, userEvent: "input.type" });

    // Yjs groups edits closer than 500 ms by its own clock, which a test cannot move.
    typeAtEnd("a");
    await new Promise((resolve) => setTimeout(resolve, 650));
    typeAtEnd("b");
    press(view, "Mod-z");

    expect(text.toString()).toBe("one\na");
  });

  describe("a rectangle of cells under Vim", () => {
    const FIXTURE = [
      "| Name | Note | Count |",
      "| --- | --- | --: |",
      "| alpha | **bold** note | 1 |",
      "| beta |  | 22 |",
      "| gamma | `x` | 3 |",
    ];
    const [HEADER, DELIMITER, , BETA, GAMMA] = FIXTURE;
    const DOC = `${FIXTURE.join("\n")}\n\nafter`;
    const table = (...lines: (string | undefined)[]) => `${lines.join("\n")}\n\nafter`;

    const tableCells = (view: EditorView) => [
      ...view.contentDOM.querySelectorAll<HTMLElement>(
        ".cm-md-table-widget th, .cm-md-table-widget td",
      ),
    ];
    const selected = (view: EditorView) =>
      view.contentDOM.querySelector<HTMLElement>(".cm-md-table-widget")?.dataset.selected;

    /** Presses in rendered cell `from`, crosses into cell `to`, and releases. */
    function drag(view: EditorView, from: number, to: number) {
      tableCells(view)[from]?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
      );
      tableCells(view)[to]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    }

    /** A key in the active cell, through its real key handling, and the outer update after. */
    async function pressInCell(view: EditorView, key: string) {
      const cell = cellEditor(view);
      if (!cell) throw new Error(`no active cell for ${key}`);
      press(cell, key);
      await settle();
    }

    it("A113 under Vim: Backspace deletes the rows of a full-width rectangle; Delete clears a narrow one", async () => {
      const rows = vimEditor(DOC, DOC.length);
      finishParse(rows);
      drag(rows, 3, 8);
      expect(selected(rows)).toBe("cells:1:0:2:2");
      const cell = cellEditor(rows);
      expect(cell && mode(cell)).toBe("normal");
      await pressInCell(rows, "Backspace");
      expect(rows.state.doc.toString()).toBe(table(HEADER, DELIMITER, GAMMA));
      rows.destroy();

      const column = vimEditor(DOC, DOC.length);
      finishParse(column);
      drag(column, 4, 7);
      expect(selected(column)).toBe("cells:1:1:2:1");
      await pressInCell(column, "Delete");
      expect(column.state.doc.toString()).toBe(
        table(HEADER, DELIMITER, "| alpha |  | 1 |", BETA, GAMMA),
      );
      expect(selected(column)).toBe("cells:1:1:2:1");
    });

    it("A113 under Vim switched on with the rectangle already selected", async () => {
      const text = new Y.Doc().getText("note");
      text.insert(0, DOC);
      const { view, render } = await atlas(text, false);
      finishParse(view);
      drag(view, 3, 8);
      expect(selected(view)).toBe("cells:1:0:2:2");

      await render(true);
      expect(selected(view)).toBe("cells:1:0:2:2");
      const cell = cellEditor(view);
      expect(cell && mode(cell)).toBe("normal");
      await pressInCell(view, "Backspace");
      expect(text.toString()).toBe(table(HEADER, DELIMITER, GAMMA));
    });

    it("Escape on a rectangle collapses it before Vim sees the key", async () => {
      const view = vimEditor(DOC, DOC.length);
      finishParse(view);
      drag(view, 3, 8);
      await pressInCell(view, "i");
      const cell = cellEditor(view);
      expect(cell && mode(cell)).toBe("insert");
      expect(selected(view)).toBe("cells:1:0:2:2");

      await pressInCell(view, "Escape");
      await settle();
      expect(selected(view)).toBeUndefined();
      const after = cellEditor(view);
      // Still in the cell, still inserting: Vim never saw that Escape.
      expect(after?.state.doc.toString()).toBe("alpha");
      expect(after && mode(after)).toBe("insert");

      await pressInCell(view, "Escape");
      expect(after && mode(after)).toBe("normal");
      expect(cellEditor(view)).toBe(after);
    });
  });
});

describe("Vim for other hosts", () => {
  const views: EditorView[] = [];
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
  });

  /** A plain (not live-preview) editor with Vim, as the composer and the :q gate mount it. */
  function plainVim(doc: string, extension: Extension = []) {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [vimMode(noHistory, { panel: false }), extension],
      }),
    });
    views.push(view);
    return view;
  }

  const attribute = (view: EditorView) => view.dom.getAttribute("data-vim-mode");

  it("without the panel the mode still shows as data-vim-mode, insert mode from the start included", async () => {
    const view = plainVim("hello");
    // Before Vim's own listeners are bound, as a host does right after creating the editor.
    enterInsertMode(view);
    await settle();
    expect(panel(view)).toBeNull();
    expect(vimInsertMode(view)).toBe(true);
    expect(attribute(view)).toBe("insert");

    press(view, "Escape");
    expect(vimInsertMode(view)).toBe(false);
    expect(vimAtRest(view)).toBe(true);
    expect(attribute(view)).toBe("normal");

    press(view, "v");
    expect(attribute(view)).toBe("visual");
    expect(vimAtRest(view)).toBe(false);
    enterInsertMode(view);
    expect(vimInsertMode(view)).toBe(true);
    expect(attribute(view)).toBe("insert");
  });

  it("reports nothing without Vim", () => {
    const view = new EditorView({ parent: document.body, state: EditorState.create({ doc: "x" }) });
    views.push(view);
    expect(vimInsertMode(view)).toBeNull();
    expect(vimAtRest(view)).toBe(false);
    expect(attribute(view)).toBeNull();
  });

  it("reports each ex command before Vim runs it, and never a search", () => {
    const submitted: string[] = [];
    const view = plainVim(
      "hello",
      vimExLine((input) => submitted.push(input)),
    );
    const enter = (keys: string, value: string) => {
      press(view, keys);
      const input = view.dom.querySelector<HTMLInputElement>(".cm-panels input");
      if (!input) throw new Error(`no prompt for ${keys}`);
      input.value = value;
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          keyCode: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    enter(":", "q");
    // Vim ran it, as this layer's `:q`: nothing, and no "Not an editor command".
    expect(view.dom.textContent).not.toContain("Not an editor command");
    enter("/", "hello");
    enter(":", "w");
    expect(submitted).toEqual(["q", "w"]);
  });

  /** An editor whose host takes Space and `:` while `taking` says so, recording each. */
  function hosted(doc: string, taking = { leader: true, exLine: true }) {
    const taken: string[] = [];
    const view = plainVim(
      doc,
      vimHostKeys({
        leader: () => (taken.push("leader"), taking.leader),
        exLine: () => (taken.push("exLine"), taking.exLine),
      }),
    );
    return { view, taken };
  }

  const prompt = (view: EditorView) => view.dom.querySelector(".cm-panels input");

  it("offers the host Space in normal and visual mode and : in normal mode, ahead of Vim", () => {
    const { view, taken } = hosted("hello world");
    press(view, " ");
    // Taken: Vim's Space (a step right) did not run.
    expect(view.state.selection.main.head).toBe(0);
    press(view, ":");
    expect(prompt(view)).toBeNull();
    press(view, "v");
    press(view, " ");
    press(view, ":");
    // Visual `:` stays Vim's: its ex line opens with the selection's range.
    expect(prompt(view)).not.toBeNull();
    expect(taken).toEqual(["leader", "exLine", "leader"]);
  });

  it("keeps both keys Vim's in insert mode, mid-command, and when the host declines", () => {
    const { view, taken } = hosted("hello world", { leader: false, exLine: false });
    press(view, " ");
    // Declined: Space is Vim's step right.
    expect(view.state.selection.main.head).toBe(1);
    press(view, ":");
    expect(prompt(view)).not.toBeNull();
    expect(taken).toEqual(["leader", "exLine"]);

    const other = hosted("hello world");
    enterInsertMode(other.view);
    press(other.view, " ");
    press(other.view, "Escape");
    // A count makes `:` a ranged ex line, which is Vim's.
    press(other.view, "3");
    press(other.view, ":");
    expect(prompt(other.view)).not.toBeNull();
    expect(other.taken).toEqual([]);
  });

  it("offers the host the leader key it names instead of Space, or none", () => {
    const taken: string[] = [];
    let leaderKey: string | null = ",";
    const view = plainVim(
      "hello world",
      vimHostKeys({ leader: () => (taken.push("leader"), true), leaderKey: () => leaderKey }),
    );
    press(view, " ");
    expect(view.state.selection.main.head).toBe(1);
    press(view, ",");
    expect(taken).toEqual(["leader"]);
    leaderKey = null;
    press(view, ",");
    press(view, " ");
    expect(taken).toEqual(["leader"]);
  });

  it("maps and sets options in every Vim editor, textwidth included, and undoes them", async () => {
    const view = plainVim("one\ntwo");
    vimConfiguration.noremap("Q", "gg", "normal");
    expect(vimConfiguration.setOption("pcre", false)).toBeUndefined();
    expect(Vim.getOption("pcre")).toBe(false);
    press(view, "j");
    press(view, "Q");
    expect(view.state.selection.main.head).toBe(0);
    vimConfiguration.unmap("Q", "normal");
    vimConfiguration.setOption("pcre", true);
    press(view, "j");
    press(view, "Q");
    expect(view.state.selection.main.head).not.toBe(0);

    // textwidth is each editor's own in the package: it reaches open and new editors alike.
    await Promise.resolve();
    vimConfiguration.setOption("textwidth", 40);
    const later = plainVim("two");
    await Promise.resolve();
    expect(vimConfiguration.getOption("tw")).toBe(40);
    expect(getCM(view)?.getOption("textwidth")).toBe(40);
    expect(getCM(later)?.getOption("textwidth")).toBe(40);
    vimConfiguration.setOption("textwidth", 80);
    expect(getCM(later)?.getOption("textwidth")).toBe(80);
  });

  /** An editor whose host takes Vim's window keys, recording each direction. */
  function windowed(doc: string) {
    const moves: string[] = [];
    const view = plainVim(
      doc,
      vimHostKeys({ window: (_view, direction) => void moves.push(direction) }),
    );
    return { view, moves };
  }

  it("sends <C-w>h, j, k, l and the arrows to the host from normal mode", async () => {
    const { view, moves } = windowed("one\ntwo");
    for (const key of ["h", "j", "k", "l"]) {
      press(view, "Ctrl-w");
      press(view, key);
    }
    press(view, "Ctrl-w");
    press(view, "ArrowRight");
    press(view, "Ctrl-w");
    press(view, "Ctrl-h");
    await settle();
    expect(moves).toEqual(["left", "down", "up", "right", "right", "left"]);
    // Nothing moved in the editor itself.
    expect(view.state.selection.main.head).toBe(0);
    expect(vimAtRest(view)).toBe(true);
  });

  it("leaves plain Ctrl-h, insert mode's <C-w>, and an editor without a host as they were", async () => {
    const { view, moves } = windowed("one two");
    press(view, "Ctrl-h");
    await settle();
    expect(moves).toEqual([]);
    view.dispatch({ selection: { anchor: 7 } });
    enterInsertMode(view);
    press(view, "Ctrl-w");
    // Insert mode's `<C-w>` deletes the word before the caret.
    expect(view.state.doc.toString()).toBe("one ");
    press(view, "h");
    await settle();
    expect(moves).toEqual([]);

    const plain = plainVim("one");
    press(plain, "Ctrl-w");
    press(plain, "l");
    expect(vimAtRest(plain)).toBe(true);
    expect(plain.state.selection.main.head).toBe(0);
  });

  it("lets a vimrc map onto the window keys and over them, and undoing it keeps them", async () => {
    const { view, moves } = windowed("one\ntwo");
    vimConfiguration.noremap("<C-h>", "<C-w>h", "normal");
    press(view, "Ctrl-h");
    vimConfiguration.noremap("<C-w>l", "j", "normal");
    press(view, "Ctrl-w");
    press(view, "l");
    await settle();
    expect(moves).toEqual(["left"]);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);

    vimConfiguration.unmap("<C-w>l", "normal");
    vimConfiguration.unmap("<C-h>", "normal");
    press(view, "Ctrl-w");
    press(view, "l");
    press(view, "Ctrl-h");
    await settle();
    expect(moves).toEqual(["left", "right"]);
  });

  it("runs an ex command routed back from the host, as Vim's ex line would", () => {
    const { view } = hosted("one two one");
    runVimEx(view, "s/one/three/g");
    expect(view.state.doc.toString()).toBe("three two three");
    runVimEx(view, "noh");
    expect(view.dom.textContent).not.toContain("Not an editor command");
  });

  it("still offers Space once a routed ex command leaves its status, and closes the status", () => {
    const { view, taken } = hosted("one two");
    runVimEx(view, "s/one/uno/");
    // The substitute's "Found 1 matches" notification is up, waiting for nothing.
    expect(view.dom.textContent).toContain("Found 1 matches");
    press(view, " ");
    expect(taken).toEqual(["leader"]);
    expect(view.dom.textContent).not.toContain("Found 1 matches");
  });
});

function hasRangeAt(
  set: ReturnType<Parameters<typeof EditorView.atomicRanges.of>[0]>,
  pos: number,
) {
  let found = false;
  set.between(pos, pos + 1, (from, to) => {
    if (from <= pos && pos < to) found = true;
  });
  return found;
}

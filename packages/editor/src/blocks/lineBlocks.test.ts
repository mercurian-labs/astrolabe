import { afterEach, describe, expect, it } from "vite-plus/test";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  lineBlocks,
  ownedLineBlocks,
  removeLineBlocks,
  setLineBlocks,
  type LineBlock,
} from "./lineBlocks.ts";

class Label extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  override eq(other: Label) {
    return other.label === this.label;
  }
  override toDOM() {
    const dom = document.createElement("div");
    dom.textContent = this.label;
    return dom;
  }
}

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string, extensions: Extension = []) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: [lineBlocks, extensions] }),
  });
  return view;
}

/** The editor top to bottom: each line's text, and each block as `[its label]`. */
function rows(editor: EditorView) {
  return [...editor.contentDOM.children].map((element) =>
    element.classList.contains("atlas-line-block")
      ? `[${element.textContent}]`
      : (element.textContent ?? ""),
  );
}

function block(
  id: string,
  placement: LineBlock["placement"],
  from: number,
  extra: Partial<LineBlock> = {},
): LineBlock {
  return { id, placement, from, widget: new Label(extra.id ?? id), ...extra };
}

function set(editor: EditorView, owner: string, blocks: LineBlock[]) {
  editor.dispatch({ effects: setLineBlocks(owner, blocks) });
}

/** Where `text` starts in the editor's document. */
function at(editor: EditorView, text: string) {
  const index = editor.state.doc.toString().indexOf(text);
  if (index < 0) throw new Error(`no ${text}`);
  return index;
}

describe("blocks between lines", () => {
  it("draws a block above or below the line holding its position", () => {
    const editor = mount("one\ntwo\nthree");
    set(editor, "test", [
      block("above two", "above", at(editor, "wo")),
      block("below two", "below", at(editor, "two")),
    ]);
    expect(rows(editor)).toEqual(["one", "[above two]", "two", "[below two]", "three"]);
  });

  it("orders blocks at one spot by priority, then newest first", () => {
    const editor = mount("one\ntwo");
    set(editor, "a", [block("old", "above", at(editor, "two"))]);
    set(editor, "b", [block("new", "above", at(editor, "two"))]);
    set(editor, "c", [block("urgent", "above", at(editor, "two"), { priority: 1 })]);
    expect(rows(editor)).toEqual(["one", "[urgent]", "[new]", "[old]", "two"]);

    // Set again, a block keeps its place among equal priorities.
    set(editor, "a", [block("old", "above", at(editor, "two"))]);
    expect(rows(editor)).toEqual(["one", "[urgent]", "[new]", "[old]", "two"]);
  });

  it("follows its line as text is typed and lines are added around it", () => {
    const editor = mount("one\ntwo\nthree");
    // One anchored at the line's start, one at its end, each staying with the line's text.
    set(editor, "test", [
      block("above", "above", at(editor, "two")),
      block("below", "below", at(editor, "two") + 3),
    ]);
    editor.dispatch({ changes: { from: 0, insert: "zero\n" } });
    editor.dispatch({ changes: { from: at(editor, "two"), insert: "\n" } });
    editor.dispatch({ changes: { from: at(editor, "two") + 3, insert: "!\nnew" } });
    expect(rows(editor)).toEqual(["zero", "one", "", "[above]", "two!", "[below]", "new", "three"]);
  });

  it("separates two blocks onto their lines when a line break lands between their anchors", () => {
    const editor = mount("one two");
    set(editor, "test", [
      block("first", "below", at(editor, "one")),
      block("second", "below", at(editor, "two")),
    ]);
    expect(rows(editor)).toEqual(["one two", "[second]", "[first]"]);
    editor.dispatch({ changes: { from: at(editor, " two"), to: at(editor, "two"), insert: "\n" } });
    expect(rows(editor)).toEqual(["one", "[first]", "two", "[second]"]);
  });

  it("hides the lines a replace block covers, and the blocks on them, until it goes", () => {
    const editor = mount("one\ntwo\nthree\nfour\nfive");
    set(editor, "notes", [
      block("on one", "below", at(editor, "one")),
      block("above two", "above", at(editor, "two")),
      block("in three", "below", at(editor, "three")),
      block("below four", "below", at(editor, "four")),
      block("above five", "above", at(editor, "five")),
    ]);
    set(editor, "fold", [block("folded", "replace", at(editor, "wo"), { to: at(editor, "fo") })]);
    expect(rows(editor)).toEqual(["one", "[on one]", "[folded]", "[above five]", "five"]);

    editor.dispatch({ effects: removeLineBlocks("fold") });
    expect(rows(editor)).toEqual([
      "one",
      "[on one]",
      "[above two]",
      "two",
      "three",
      "[in three]",
      "four",
      "[below four]",
      "[above five]",
      "five",
    ]);
  });

  it("shows the higher ranked of two replace blocks that overlap, and the other once it goes", () => {
    const editor = mount("one\ntwo\nthree\nfour");
    set(editor, "outer", [
      block("outer", "replace", at(editor, "two"), { to: at(editor, "four"), priority: 1 }),
    ]);
    set(editor, "inner", [
      block("inner", "replace", at(editor, "three"), { to: at(editor, "four") }),
    ]);
    expect(rows(editor)).toEqual(["one", "[outer]"]);
    editor.dispatch({ effects: removeLineBlocks("outer") });
    expect(rows(editor)).toEqual(["one", "two", "[inner]"]);
  });

  it("drops a replace block whose text is deleted whole, and only that", () => {
    const editor = mount("one\ntwo\nthree");
    set(editor, "test", [
      block("fold", "replace", at(editor, "two"), { to: at(editor, "two") + 3 }),
      block("note", "below", at(editor, "three")),
    ]);
    editor.dispatch({ changes: { from: at(editor, "one") + 3, to: at(editor, "two") + 3 } });
    expect(rows(editor)).toEqual(["one", "three", "[note]"]);
    expect(ownedLineBlocks(editor.state, "test").map((kept) => kept.id)).toEqual(["note"]);
  });

  it("removes blocks by id, by owner, or by setting fewer, leaving other owners' alone", () => {
    const editor = mount("one\ntwo");
    const line = at(editor, "two");
    set(editor, "a", [block("a1", "above", line), block("a2", "above", line)]);
    set(editor, "b", [block("b1", "below", line)]);

    editor.dispatch({ effects: removeLineBlocks("a", ["a1"]) });
    expect(rows(editor)).toEqual(["one", "[a2]", "two", "[b1]"]);
    set(editor, "a", []);
    expect(rows(editor)).toEqual(["one", "two", "[b1]"]);
    set(editor, "a", [block("a3", "above", line)]);
    editor.dispatch({ effects: removeLineBlocks("b") });
    expect(rows(editor)).toEqual(["one", "[a3]", "two"]);
  });

  it("keeps a block's drawn element through edits and through being set again unchanged", () => {
    const editor = mount("one\ntwo\nthree");
    set(editor, "test", [block("note", "below", at(editor, "two"))]);
    const drawn = editor.contentDOM.querySelector(".atlas-line-block");
    editor.dispatch({ changes: { from: 0, insert: "zero\n" } });
    editor.dispatch({ changes: { from: at(editor, "two"), insert: "2 " } });
    set(editor, "test", [block("note", "below", at(editor, "two"))]);
    expect(editor.contentDOM.querySelector(".atlas-line-block")).toBe(drawn);

    set(editor, "test", [block("note", "below", at(editor, "two"), { widget: new Label("new") })]);
    expect(editor.contentDOM.querySelector(".atlas-line-block")?.textContent).toBe("new");
  });

  it("estimates an undrawn block's height from its rows and the editor's line height", () => {
    const editor = mount("one\ntwo");
    set(editor, "test", [
      block("tall", "below", 0, { rows: 3 }),
      block("short", "above", at(editor, "two")),
    ]);
    const estimates = new Map<string, number>();
    for (const source of editor.state.facet(EditorView.decorations)) {
      if (typeof source === "function") continue;
      for (let iter = (source as DecorationSet).iter(); iter.value; iter.next()) {
        const widget = iter.value.spec.widget as WidgetType & { id?: string };
        if (widget?.id) estimates.set(widget.id, widget.estimatedHeight);
      }
    }
    expect(estimates.get("tall")).toBe(3 * editor.defaultLineHeight);
    // One row is the editor's own line height, which it knows best.
    expect(estimates.get("short")).toBe(-1);
  });
});

describe("blocks in a shared document", () => {
  const REMOTE = Symbol("remote");

  function peers() {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    local.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(remote, update, REMOTE);
    });
    remote.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(local, update, REMOTE);
    });
    return { local: local.getText("note"), remote: remote.getText("note") };
  }

  it("keeps each block with its line and its drawn element through remote edits", () => {
    const { local, remote } = peers();
    local.insert(0, "one\ntwo\nthree");
    const awareness = new Awareness(local.doc!);
    const editor = mount(local.toString(), yCollab(local, awareness));
    set(editor, "test", [block("note", "below", at(editor, "two"))]);
    const drawn = editor.contentDOM.querySelector(".atlas-line-block");

    remote.insert(0, "zero\n");
    remote.insert(remote.toString().indexOf("three"), "two and a half\n");
    remote.insert(remote.toString().indexOf("two") + 3, " (edited)");

    expect(rows(editor)).toEqual([
      "zero",
      "one",
      "two (edited)",
      "[note]",
      "two and a half",
      "three",
    ]);
    expect(editor.contentDOM.querySelector(".atlas-line-block")).toBe(drawn);
    const [note] = ownedLineBlocks(editor.state, "test");
    expect(editor.state.doc.lineAt(note!.from).text).toBe("two (edited)");
    awareness.destroy();
  });

  it("drops a replace block when a collaborator deletes its lines", () => {
    const { local, remote } = peers();
    local.insert(0, "one\ntwo\nthree\nfour");
    const awareness = new Awareness(local.doc!);
    const editor = mount(local.toString(), yCollab(local, awareness));
    set(editor, "test", [
      block("fold", "replace", at(editor, "two"), { to: at(editor, "three") + 5 }),
    ]);
    expect(rows(editor)).toEqual(["one", "[fold]", "four"]);

    remote.delete(remote.toString().indexOf("two"), "two\nthree\n".length);
    expect(rows(editor)).toEqual(["one", "four"]);
    awareness.destroy();
  });
});

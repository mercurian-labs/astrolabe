import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { documentIndexBuilds } from "./documentIndex.ts";
import { previewDecorations } from "./preview.ts";
import css from "./theme.css?raw";
import base from "./theme.ts?raw";
import { caret, destroyViews, line, mount, select, sourceText } from "./testSupport.ts";

afterEach(destroyViews);

const REMOTE = Symbol("remote");

/** Ranges the preview hides, read from the plugin's atomic set. */
function hiddenRanges(view: EditorView) {
  const ranges: [number, number][] = [];
  view.plugin(previewDecorations)?.atomic.between(0, view.state.doc.length, (from, to) => {
    ranges.push([from, to]);
  });
  return ranges;
}

describe("stability and performance", () => {
  it("A60. no rebuild dispatches a selection; a remote Yjs insertion before the caret keeps it on the same character", () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    local.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(remote, update, REMOTE);
    });
    remote.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) Y.applyUpdate(local, update, REMOTE);
    });
    const text = local.getText("note");
    text.insert(0, "# Title\n\nhello **world**");
    const transactions: Transaction[] = [];
    const view = mount(text.toString(), {
      focused: true,
      selection: [17],
      extensions: [
        yCollab(text, new Awareness(local)),
        EditorView.updateListener.of((update) => transactions.push(...update.transactions)),
      ],
    });
    expect(view.state.sliceDoc(17, 18)).toBe("w");

    remote.getText("note").insert(9, "big ");

    expect(view.state.doc.toString()).toBe("# Title\n\nbig hello **world**");
    expect(view.state.sliceDoc(caret(view), caret(view) + 1)).toBe("w");
    expect(transactions.every((tr) => tr.selection === undefined)).toBe(true);
  });

  it("A61. reference definitions are computed once per tree: a selection-only transaction walks nothing", () => {
    const view = mount("[a]\n\n[a]: https://x\n\ntext", { focused: true, selection: [0] });
    const before = documentIndexBuilds();
    select(view, 8);
    select(view, 20);
    expect(documentIndexBuilds()).toBe(before);
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(documentIndexBuilds()).toBe(before + 1);
  });

  // Needs a browser, so not tested here: A62. off-screen constructs have no decorations until
  // scrolled into view

  it("A63. during a composition the previous set is mapped, so no hidden range covers new characters", () => {
    const view = mount("**bold** x");
    expect(hiddenRanges(view)).toEqual([
      [0, 2],
      [6, 8],
    ]);
    view.dispatch({ changes: { from: 8, insert: " **y**" }, userEvent: "input.type.compose" });
    // Mapped, not rebuilt: the new `**` pairs are not hidden mid-composition.
    expect(hiddenRanges(view)).toEqual([
      [0, 2],
      [6, 8],
    ]);
    // The first update after the composition rebuilds.
    view.dispatch({});
    expect(hiddenRanges(view)).toEqual([
      [0, 2],
      [6, 8],
      [9, 11],
      [12, 14],
    ]);
    expect(sourceText(line(view, 1))).toBe("bold y x");
  });
});

describe("theming", () => {
  it("A64. every custom property the stylesheet declares is referenced by at least one rule", () => {
    const declared = new Set(
      [...css.matchAll(/(--atlas-md-[\w-]+)\s*:/g)].map((match) => match[1]),
    );
    const referenced = new Set(
      [...`${css}\n${base}`.matchAll(/var\(\s*(--atlas-md-[\w-]+)/g)].map((match) => match[1]),
    );
    expect(declared.size).toBeGreaterThan(0);
    expect([...declared].filter((name) => !referenced.has(name))).toEqual([]);
  });

  // Needs a browser, so not tested here: A65. dark defaults switch under prefers-color-scheme: dark
});

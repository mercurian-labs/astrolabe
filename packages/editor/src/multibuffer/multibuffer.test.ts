import {
  collab,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
  type Update,
} from "@codemirror/collab";
import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { excerptBounds } from "./excerpt.ts";
import {
  type ExcerptDocument,
  Multibuffer,
  type MultibufferExcerpt,
  type MultibufferFileInput,
} from "./multibuffer.ts";

const lines = (count: number, prefix = "line") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join("\n");

/** One file's authority, in memory: accepts updates at its version and sends them to everyone. */
class Authority {
  readonly updates: Update[] = [];
  readonly clients = new Set<(updates: readonly Update[]) => void>();
  constructor(public text: string) {}

  push(version: number, updates: readonly Update[]) {
    if (version !== this.updates.length) return;
    this.updates.push(...updates);
    for (const client of this.clients) client(updates);
  }
}

/** A collab client of `authority`, the way `DocumentSession` binds a file's editor. */
class FakeDocument implements ExcerptDocument {
  editor: {
    readonly state: EditorState;
    readonly dispatch: (spec: Transaction | Parameters<EditorView["dispatch"]>[0]) => void;
  } | null = null;
  changes = 0;
  constructor(
    readonly authority: Authority,
    readonly clientID: string,
  ) {}

  initialState() {
    return {
      text: this.authority.text,
      extension: collab({ startVersion: this.authority.updates.length, clientID: this.clientID }),
    };
  }

  attach(editor: NonNullable<FakeDocument["editor"]>) {
    this.editor = editor;
    this.authority.clients.add(this.receive);
  }

  detach() {
    this.editor = null;
    this.authority.clients.delete(this.receive);
  }

  changed() {
    this.changes += 1;
    const editor = this.editor!;
    this.authority.push(getSyncedVersion(editor.state), sendableUpdates(editor.state));
  }

  private readonly receive = (updates: readonly Update[]) => {
    const editor = this.editor!;
    editor.dispatch(receiveUpdates(editor.state, updates));
  };
}

/** Another editor of the file elsewhere: a plain collab editor of the authority. */
function otherEditor(authority: Authority, clientID: string) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: authority.text,
      extensions: [collab({ startVersion: authority.updates.length, clientID }), history()],
    }),
  });
  authority.clients.add((updates) => view.dispatch(receiveUpdates(view.state, updates)));
  return {
    view,
    /** Edits it, and sends the edit to the authority. */
    edit(spec: Parameters<EditorView["dispatch"]>[0]) {
      view.dispatch(spec);
      authority.push(getSyncedVersion(view.state), sendableUpdates(view.state));
    },
  };
}

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function setup(files: Record<string, string>, inputs: MultibufferFileInput[], context = 1) {
  const authorities = new Map(
    Object.entries(files).map(([path, text]) => [path, new Authority(text)]),
  );
  const documents = new Map<string, FakeDocument>();
  const opened: Array<{ path: string; line: number }> = [];
  const multibuffer = new Multibuffer({
    context,
    open: (path) => {
      const document = new FakeDocument(authorities.get(path)!, `multibuffer:${path}`);
      documents.set(path, document);
      return document;
    },
    close: () => {},
    openFile: (path, line) => opened.push({ path, line }),
  });
  multibuffer.set(inputs);
  const extensions = (): Extension => history();
  /** Opens every file and shows every excerpt in an editor. */
  const showAll = () => {
    for (const file of multibuffer.fileList()) {
      multibuffer.need(file);
      multibuffer.documentReady(file);
    }
    for (const row of multibuffer.rows()) {
      if (row.kind !== "excerpt" || row.excerpt.view !== null) continue;
      show(row.excerpt);
    }
  };
  const show = (item: MultibufferExcerpt) => {
    const state = multibuffer.stateFor(item, extensions)!;
    const view = new EditorView({
      parent: document.body,
      state,
      dispatchTransactions: multibuffer.dispatchFrom(item),
    });
    views.push(view);
    multibuffer.shown(item, view);
    // As the view does: a caret move waiting for this excerpt's editor lands once it is built.
    const request = multibuffer.focusRequest();
    if (request?.excerpt === item) multibuffer.applyFocus(request, view);
    return view;
  };
  const excerpts = () =>
    multibuffer.rows().flatMap((row) => (row.kind === "excerpt" ? [row.excerpt] : []));
  const visible = (item: MultibufferExcerpt) => {
    const state = item.view?.state ?? item.state!;
    const { from, to } = excerptBounds(state);
    return state.doc.sliceString(from, to);
  };
  return { multibuffer, authorities, documents, opened, showAll, show, excerpts, visible };
}

describe("Multibuffer", () => {
  it("shows each file's excerpts under its header, merging what touches", () => {
    const { multibuffer, showAll, excerpts, visible } = setup(
      { "a.ts": lines(20), "b.ts": lines(5) },
      [
        { path: "a.ts", lines: [{ line: 3 }, { line: 5 }, { line: 15 }] },
        { path: "b.ts", lines: [{ line: 1 }] },
      ],
    );
    expect(multibuffer.rows().map((row) => row.kind)).toEqual([
      "header",
      "excerpt",
      "excerpt",
      "header",
      "excerpt",
    ]);
    showAll();
    expect(excerpts().map(visible)).toEqual([
      "line 2\nline 3\nline 4\nline 5\nline 6",
      "line 14\nline 15\nline 16",
      "line 1\nline 2",
    ]);
  });

  it("sends an excerpt's edit to the file's other excerpts and to its other editors", () => {
    const { authorities, showAll, excerpts, visible, documents } = setup({ "a.ts": lines(20) }, [
      { path: "a.ts", lines: [{ line: 3 }, { line: 15 }] },
    ]);
    const other = otherEditor(authorities.get("a.ts")!, "tab");
    views.push(other.view);
    showAll();
    const [first, second] = excerpts();
    const view = first!.view!;
    const start = excerptBounds(view.state).from;
    view.dispatch({ changes: { from: start, insert: "// hi\n" }, userEvent: "input.type" });

    expect(visible(first!)).toBe("// hi\nline 2\nline 3\nline 4");
    expect(second!.view!.state.doc.toString()).toBe(view.state.doc.toString());
    expect(visible(second!)).toBe("line 14\nline 15\nline 16");
    expect(other.view.state.doc.line(2).text).toBe("// hi");
    expect(documents.get("a.ts")!.changes).toBe(1);
  });

  it("takes edits from elsewhere into every excerpt, and keeps them out of undo", () => {
    const { authorities, showAll, excerpts, visible } = setup({ "a.ts": lines(20) }, [
      { path: "a.ts", lines: [{ line: 10 }] },
    ]);
    const other = otherEditor(authorities.get("a.ts")!, "tab");
    views.push(other.view);
    showAll();
    const [only] = excerpts();
    const view = only!.view!;
    const line10 = view.state.doc.line(10);
    view.dispatch({ changes: { from: line10.to, insert: "!" }, userEvent: "input.type" });
    other.edit({ changes: { from: 0, insert: "top\n" } });
    other.edit({
      changes: { from: other.view.state.doc.line(11).from, insert: "mid " },
    });

    expect(visible(only!)).toBe("line 9\nmid line 10!\nline 11");
    undo(view);
    expect(visible(only!)).toBe("line 9\nmid line 10\nline 11");
    expect(other.view.state.doc.toString()).toBe(view.state.doc.toString());
  });

  it("keeps typed edits and the caret inside the excerpt", () => {
    const { showAll, excerpts, visible } = setup({ "a.ts": lines(20) }, [
      { path: "a.ts", lines: [{ line: 10 }] },
    ]);
    showAll();
    const view = excerpts()[0]!.view!;
    const { from, to } = excerptBounds(view.state);
    // Select everything and type: only the excerpt's lines are replaced.
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
    expect(view.state.selection.main.from).toBe(from);
    expect(view.state.selection.main.to).toBe(to);
    view.dispatch(view.state.replaceSelection("x"));
    expect(visible(excerpts()[0]!)).toBe("x");
    expect(view.state.doc.line(8).text).toBe("line 8");
    expect(view.state.doc.line(10).text).toBe("line 12");
    // A deletion reaching across the line break above the excerpt keeps that break.
    const start = excerptBounds(view.state).from;
    view.dispatch({ changes: { from: start - 1, to: start + 1 }, userEvent: "delete" });
    expect(view.state.doc.line(8).text).toBe("line 8");
    expect(view.state.doc.line(9).text).toBe("");
  });

  it("expands an excerpt and merges it with the next one it reaches", () => {
    const { multibuffer, showAll, excerpts, visible } = setup({ "a.ts": lines(30) }, [
      { path: "a.ts", lines: [{ line: 5 }, { line: 12 }] },
    ]);
    showAll();
    const [first] = excerpts();
    multibuffer.expand(first!, 0, 2);
    expect(excerpts()).toHaveLength(2);
    expect(visible(first!)).toBe([4, 5, 6, 7, 8].map((n) => `line ${n}`).join("\n"));
    multibuffer.expand(first!, 0, 2);
    expect(excerpts()).toHaveLength(1);
    expect(visible(excerpts()[0]!)).toBe(
      Array.from({ length: 10 }, (_, index) => `line ${index + 4}`).join("\n"),
    );
  });

  it("merges excerpts once the lines between them are deleted", () => {
    const { authorities, showAll, excerpts } = setup({ "a.ts": lines(30) }, [
      { path: "a.ts", lines: [{ line: 5 }, { line: 12 }] },
    ]);
    const other = otherEditor(authorities.get("a.ts")!, "tab");
    views.push(other.view);
    showAll();
    expect(excerpts()).toHaveLength(2);
    other.edit({
      changes: { from: other.view.state.doc.line(7).from, to: other.view.state.doc.line(11).from },
    });
    expect(excerpts()).toHaveLength(1);
  });

  it("hands the caret to the next excerpt at the last line, and across files", () => {
    const { multibuffer, showAll, excerpts } = setup({ "a.ts": lines(30), "b.ts": lines(30) }, [
      { path: "a.ts", lines: [{ line: 5 }, { line: 20 }] },
      { path: "b.ts", lines: [{ line: 3 }] },
    ]);
    showAll();
    const [first, second, third] = excerpts();
    const view = first!.view!;
    const last = view.state.doc.line(6);
    view.dispatch({ selection: { anchor: last.from + 3 } });
    multibuffer.leave(first!, 1, 3);
    const next = second!.view!;
    expect(next.state.doc.lineAt(next.state.selection.main.head).number).toBe(19);
    expect(next.state.selection.main.head - next.state.doc.line(19).from).toBe(3);
    multibuffer.jumpFile(second!, 1);
    const target = third!.view!;
    expect(target.state.doc.lineAt(target.state.selection.main.head).number).toBe(2);
  });

  it("keeps an excerpt's editor state while it is scrolled out of view", () => {
    const { authorities, multibuffer, showAll, excerpts, show, visible } = setup(
      { "a.ts": lines(20) },
      [{ path: "a.ts", lines: [{ line: 10 }] }],
    );
    const other = otherEditor(authorities.get("a.ts")!, "tab");
    views.push(other.view);
    showAll();
    const item = excerpts()[0]!;
    const view = item.view!;
    view.dispatch({
      changes: { from: excerptBounds(view.state).from, insert: "mine " },
      userEvent: "input.type",
    });
    multibuffer.hidden(item, view);
    view.destroy();
    other.edit({ changes: { from: 0, insert: "top\n" } });
    const again = show(item);
    expect(visible(item)).toBe("mine line 9\nline 10\nline 11");
    undo(again);
    expect(visible(item)).toBe("line 9\nline 10\nline 11");
    expect(other.view.state.doc.line(10).text).toBe("line 9");
  });

  it("refreshes a file's results, keeping the context the person added", () => {
    const { multibuffer, showAll, excerpts, visible } = setup({ "a.ts": lines(40) }, [
      { path: "a.ts", lines: [{ line: 10 }, { line: 30 }] },
    ]);
    showAll();
    const [first] = excerpts();
    multibuffer.expand(first!, 3, 0);
    multibuffer.set([{ path: "a.ts", lines: [{ line: 11 }] }]);
    expect(excerpts()).toEqual([first]);
    expect(visible(first!)).toBe(
      Array.from({ length: 7 }, (_, index) => `line ${index + 6}`).join("\n"),
    );
  });

  it("moves the caret to the next file's excerpt even when its editor is built twice", () => {
    const { multibuffer, show, excerpts } = setup({ "a.ts": lines(30), "b.ts": lines(30) }, [
      { path: "a.ts", lines: [{ line: 5 }] },
      { path: "b.ts", lines: [{ line: 12 }] },
    ]);
    for (const file of multibuffer.fileList()) {
      multibuffer.need(file);
      multibuffer.documentReady(file);
    }
    const [first, second] = excerpts();
    show(first!).focus();
    // The next file's excerpt is scrolled out of view: it has no editor until it scrolls in.
    multibuffer.jumpFile(first!, 1);
    const built = show(second!);
    expect(built.hasFocus).toBe(true);
    // React builds a new effect's editor, destroys it, and builds it again.
    multibuffer.hidden(second!, built);
    built.destroy();
    const again = show(second!);
    expect(again.hasFocus).toBe(true);
    expect(again.state.doc.lineAt(again.state.selection.main.head).number).toBe(11);
  });

  it("counts hidden lines up to the file's next excerpt, and shows five more on a click", () => {
    const { showAll, excerpts, visible } = setup({ "a.ts": lines(40) }, [
      { path: "a.ts", lines: [{ line: 12 }, { line: 25 }] },
    ]);
    showAll();
    const bars = (item: MultibufferExcerpt) => [
      ...item.view!.dom.querySelectorAll<HTMLButtonElement>(".atlas-excerpt-expand"),
    ];
    const labels = (item: MultibufferExcerpt) => bars(item).map((bar) => bar.textContent);
    const [first, second] = excerpts();
    expect(labels(first!)).toEqual(["↑ 10 more lines", "↓ 10 more lines"]);
    expect(labels(second!)).toEqual(["↑ 10 more lines", "↓ 14 more lines"]);

    bars(first!)[0]!.click();
    expect(visible(first!)).toBe(
      Array.from({ length: 8 }, (_, index) => `line ${index + 6}`).join("\n"),
    );
    expect(labels(first!)).toEqual(["↑ 5 more lines", "↓ 10 more lines"]);
    bars(first!)[1]!.click();
    expect(labels(first!)).toEqual(["↑ 5 more lines", "↓ 5 more lines"]);
    expect(labels(second!)).toEqual(["↑ 5 more lines", "↓ 14 more lines"]);
  });
});

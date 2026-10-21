import { afterEach, describe, expect, it } from "vite-plus/test";
import { runScopeHandlers, type EditorView } from "@codemirror/view";
import { katexRequested, loadKatex, unloadKatex } from "./math.ts";
import { caret, destroyViews, lines, mount, select, sourceText, texts } from "./testSupport.ts";

afterEach(destroyViews);

const TABLE = "| Name | Value |\n| :--- | ----: |\n| **bold** | [link](https://x) |\n| a | b |";
const DOC = `${TABLE}\n\nafter`;

const tableWidgets = (view: EditorView) => [
  ...view.contentDOM.querySelectorAll<HTMLElement>(".cm-md-table-widget"),
];

function press(view: EditorView, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  return runScopeHandlers(view, event, "editor");
}

describe("tables", () => {
  it("A74. a GFM table at rest is one widget with a header, body rows, inline formatting, links, and alignment", () => {
    const view = mount(DOC);
    const [widget] = tableWidgets(view);
    expect(tableWidgets(view)).toHaveLength(1);
    expect(lines(view).map((element) => sourceText(element))).toEqual(["", "after"]);
    const headers = [...(widget?.querySelectorAll("thead th") ?? [])];
    expect(headers.map((cell) => cell.textContent)).toEqual(["Name", "Value"]);
    const rows = [...(widget?.querySelectorAll("tbody tr") ?? [])];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector("td .cm-md-strong")?.textContent).toBe("bold");
    const link = rows[0]?.querySelector<HTMLElement>("td [data-href]");
    expect(link?.dataset.href).toBe("https://x");
    expect(link?.textContent).toBe("link");
    expect(rows[1] ? [...rows[1].children].map((cell) => cell.textContent) : []).toEqual([
      "a",
      "b",
    ]);
    for (const row of [widget?.querySelector("thead tr"), ...rows]) {
      const cells = [...(row?.children ?? [])].map((cell) =>
        cell instanceof HTMLElement ? cell.style.textAlign : "",
      );
      expect(cells).toEqual(["left", "right"]);
    }
  });

  it("A75. a caret in the table shows its source rows with `|` and the delimiter row dimmed; moving below restores the widget", () => {
    const view = mount(DOC, { focused: true, selection: [3] });
    expect(tableWidgets(view)).toEqual([]);
    // Cells are decorated inline as elsewhere: the bold and link markers are off-range.
    expect(
      lines(view)
        .slice(0, 4)
        .map((element) => sourceText(element)),
    ).toEqual(["| Name | Value |", "| :--- | ----: |", "| bold | link |", "| a | b |"]);
    const dimmed = texts(view, ".cm-md-table-delimiter");
    expect(dimmed).toContain("| :--- | ----: |");
    expect(dimmed.filter((text) => text === "|")).toHaveLength(9);
    expect(texts(view, ".cm-md-strong")).toEqual(["bold"]);
    expect(texts(view, ".cm-md-link")).toEqual(["link"]);

    select(view, DOC.length);
    expect(tableWidgets(view)).toHaveLength(1);
    expect(lines(view).map((element) => sourceText(element))).toEqual(["", "after"]);
  });

  // Draft 4 (section 4.11) supersedes A76's "reveals the source": the click activates the
  // cell in place, with the outer caret parked at the cell's source text start.
  it("A76. clicking a body cell puts the caret at that cell's source text and activates it in place", () => {
    const doc = `intro\n\n${DOC}`;
    const view = mount(doc, { focused: true, selection: [doc.length] });
    // An edit above the table moves its source without rebuilding the widget's DOM.
    view.dispatch({ changes: { from: 0, insert: "more " } });
    const [widget] = tableWidgets(view);
    const cell = widget?.querySelectorAll("tbody td")[3];
    expect(cell?.textContent).toBe("b");
    cell?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(caret(view)).toBe(view.state.doc.toString().indexOf("| a | b |") + 6);
    expect(view.state.sliceDoc(caret(view), caret(view) + 1)).toBe("b");
    expect(tableWidgets(view)).toHaveLength(1);
    expect(
      tableWidgets(view)[0]?.querySelector(".cm-md-cell-active .cm-content")?.textContent,
    ).toBe("b");

    select(view, view.state.doc.length);
    const header = tableWidgets(view)[0]?.querySelectorAll("thead th")[1];
    header?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
    );
    expect(view.state.sliceDoc(caret(view), caret(view) + 5)).toBe("Value");
  });

  it("A77. Tab and Shift-Tab move between cells across rows; Tab in the last cell changes nothing", () => {
    const doc = "| a | b |\n| - | - |\n| c | d |\n\n- item";
    const view = mount(doc, { focused: true, selection: [2] });
    const at = (text: string) => doc.indexOf(text);
    press(view, "Tab");
    expect(caret(view)).toBe(at("b"));
    press(view, "Tab");
    expect(caret(view)).toBe(at("c"));
    press(view, "Tab", true);
    expect(caret(view)).toBe(at("b"));
    press(view, "Tab", true);
    expect(caret(view)).toBe(at("a"));
    select(view, at("d") + 1);
    press(view, "Tab");
    expect(caret(view)).toBe(at("d") + 1);
    expect(view.state.doc.toString()).toBe(doc);

    // Outside a table, Tab still indents list items.
    select(view, doc.length);
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe(doc.replace("\n- item", "\n  - item"));
  });

  it("A78. a table whose delimiter row is malformed renders no widget and no dimmed delimiters", () => {
    const view = mount("| a |\n| b |");
    expect(tableWidgets(view)).toEqual([]);
    expect(view.contentDOM.querySelector(".cm-md-table-delimiter")).toBeNull();
    expect(lines(view).map((element) => sourceText(element))).toEqual(["| a |", "| b |"]);
  });

  it("counts empty cells by their pipes", () => {
    const view = mount("| a | b | c |\n| - | - | - |\n| x |  | z |");
    const cells = [...view.contentDOM.querySelectorAll("tbody td")].map((cell) => cell.textContent);
    expect(cells).toEqual(["x", "", "z"]);
  });

  it("does not rebuild the table's DOM for an edit outside it", () => {
    const view = mount(DOC);
    const [before] = tableWidgets(view);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    expect(tableWidgets(view)[0]).toBe(before);
  });

  it("loads KaTeX for a document whose only math is in a table cell and renders it in the widget", async () => {
    unloadKatex();
    const view = mount("| Formula |\n| --- |\n| $x$ |");
    expect(katexRequested()).toBe(true);
    expect(tableWidgets(view)[0]?.querySelector("td .cm-md-math")?.textContent).toBe("x");
    await loadKatex();
    const [widget] = tableWidgets(view);
    expect(widget?.querySelector("td .katex")).not.toBeNull();
    expect(widget?.querySelector("td .cm-md-math")).toBeNull();
  });

  it("rebuilds a table drawn before KaTeX arrived once it has, even when other math asked for it", async () => {
    unloadKatex();
    const view = mount("$y$ above\n\n| Formula |\n| --- |\n| $x$ |");
    const [before] = tableWidgets(view);
    expect(before?.querySelector(".katex")).toBeNull();
    await loadKatex();
    const [after] = tableWidgets(view);
    expect(after?.querySelector("td .katex")).not.toBeNull();
    expect(after?.querySelector("td .cm-md-math")).toBeNull();
  });

  it("follows a changed definition: a reference link in a cell takes the new target", () => {
    const doc = "| Link |\n| --- |\n| [docs][ref] |\n\n[ref]: https://one";
    const view = mount(doc);
    const href = () =>
      tableWidgets(view)[0]?.querySelector<HTMLElement>("td [data-href]")?.dataset.href;
    expect(href()).toBe("https://one");
    const from = doc.indexOf("one");
    view.dispatch({ changes: { from, to: from + 3, insert: "two" } });
    expect(href()).toBe("https://two");
  });

  it("keeps the same table element through an edit in a paragraph above it", () => {
    const doc =
      "intro\n\n| Link | Math |\n| --- | --- |\n| [docs][ref] | $x$ |\n\n[ref]: https://one";
    const view = mount(doc);
    const [before] = tableWidgets(view);
    view.dispatch({ changes: { from: 5, insert: " more" } });
    expect(tableWidgets(view)[0]).toBe(before);
  });

  it("handles each caret on its own: Tab indents the list caret's item and moves the table caret", () => {
    for (const item of ["- a", "1. a", "- [ ] a"]) {
      const doc = `${item}\n\n| x | y |\n| - | - |\n| c | d |`;
      const listCaret = item.length;
      // What Tab does to the item with only the list caret.
      const alone = mount(doc, { focused: true, selection: [listCaret] });
      press(alone, "Tab");
      const indented = alone.state.doc.toString();
      const shift = indented.length - doc.length;
      expect(shift, item).toBeGreaterThan(0);

      const view = mount(doc, { focused: true, selection: [listCaret, doc.indexOf("c")] });
      press(view, "Tab");
      expect(view.state.doc.toString(), item).toBe(indented);
      expect(view.state.selection.ranges.map((range) => range.head)).toEqual([
        listCaret + shift,
        indented.indexOf("d"),
      ]);
      press(view, "Tab", true);
      expect(view.state.doc.toString(), item).toBe(doc);
      expect(view.state.selection.ranges.map((range) => range.head)).toEqual([
        listCaret,
        doc.indexOf("c"),
      ]);
    }
  });

  it("keeps a table inside a quote as source", () => {
    const view = mount("> | a | b |\n> | - | - |\n> | c | d |");
    expect(tableWidgets(view)).toEqual([]);
    expect(texts(view, ".cm-md-table-delimiter")).toContain("| - | - |");
  });
});

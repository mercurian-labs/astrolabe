import { describe, expect, it } from "vite-plus/test";

import { isEditableNote, newNoteProperties, withEdit, withUnsentEdit } from "./wikiBaseEdits.ts";

describe("withEdit", () => {
  it("leaves edits on their way to the server as they are", () => {
    const edit = (value: string) =>
      ({ kind: "property", file: "A.md", property: "status", value }) as const;
    expect(withUnsentEdit([edit("open")], 1, edit("done"))).toEqual([edit("open"), edit("done")]);
    expect(withUnsentEdit([edit("open")], 0, edit("done"))).toEqual([edit("done")]);
  });

  it("folds repeated settings of one view into one edit", () => {
    const first = withEdit([], {
      kind: "view",
      base: "Work.base",
      view: "Table",
      settings: { columnSize: { status: 120 } },
    });
    const second = withEdit(first, {
      kind: "view",
      base: "Work.base",
      view: "Table",
      settings: { columnSize: { status: 160 }, rowHeight: "tall" },
    });
    expect(second).toEqual([
      {
        kind: "view",
        base: "Work.base",
        view: "Table",
        settings: { columnSize: { status: 160 }, rowHeight: "tall" },
      },
    ]);
  });

  it("keeps a rename apart, and a note's property to its latest value", () => {
    const renamed = withEdit(
      [{ kind: "view", base: "Work.base", view: "Table", settings: { limit: 3 } }],
      { kind: "view", base: "Work.base", view: "Table", name: "All" },
    );
    expect(renamed).toHaveLength(2);
    const twice = withEdit(
      withEdit([], { kind: "property", file: "Alpha.md", property: "status", value: "open" }),
      { kind: "property", file: "Alpha.md", property: "note.status", value: "done" },
    );
    expect(twice).toEqual([
      { kind: "property", file: "Alpha.md", property: "note.status", value: "done" },
    ]);
  });
});

describe("newNoteProperties", () => {
  it("fills what plain filters and the group ask for", () => {
    expect(
      newNoteProperties(
        { and: ['status == "open"', "note.priority == 2", 'file.hasTag("area")', "done == false"] },
        { property: "owner", value: "[[Priya]]" },
      ),
    ).toEqual({ status: "open", priority: 2, done: false, tags: ["area"], owner: "[[Priya]]" });
  });

  it("leaves out what it can't read, and worked-out groups", () => {
    expect(
      newNoteProperties({ or: ['status == "open"'] }, { property: "file.folder", value: "/" }),
    ).toEqual({});
    expect(newNoteProperties("priority > 2", undefined)).toEqual({});
  });
});

it("edits only notes at the top of the wiki", () => {
  expect(isEditableNote("Alpha.md")).toBe(true);
  expect(isEditableNote("projects/Delta.md")).toBe(false);
  expect(isEditableNote("Product.skillmap.md")).toBe(false);
  expect(isEditableNote("Open.base")).toBe(false);
});

import { describe, expect, it } from "vite-plus/test";
import { MercurianProjectId, type MemoryNote } from "@t3tools/contracts";

import {
  beginMemoryNoteEdit,
  initialMemorySelection,
  INITIAL_MEMORY_EDITOR_STATE,
  memoryEditorReducer,
  memoryNoteWritePayload,
  memoryPageStanding,
  memoryRailItems,
} from "./MemoryPage.logic";

const index = {
  maps: [
    { file: "maps/z.yaml", refusal: "maps/z.yaml: bad arrangement" },
    { file: "maps/a.yaml", name: "Product", purpose: "Structure", arrangement: [] },
  ],
  notes: [
    { name: "Specs", path: "Specs.md" },
    { name: "Composer", path: "Composer.md" },
  ],
  unresolved: [{ name: "Future", referencedBy: ["Specs"] }],
  problems: [],
  productMapOffer: null,
} as const;

describe("memoryRailItems", () => {
  it("groups sorted maps, notes, and unresolved references while retaining refusals", () => {
    expect(memoryRailItems(index).map((item) => [item.kind, item.key])).toEqual([
      ["refused-map", "map:maps/z.yaml"],
      ["map", "map:maps/a.yaml"],
      ["note", "note:Composer"],
      ["note", "note:Specs"],
      ["unresolved", "unresolved:Future"],
    ]);
  });

  it("deep-links written and unresolved note names case-insensitively", () => {
    const items = memoryRailItems(index);
    expect(initialMemorySelection(items, "composer")).toBe("note:Composer");
    expect(initialMemorySelection(items, "Future")).toBe("unresolved:Future");
    expect(initialMemorySelection(items, "New idea")).toBe("unresolved:New idea");
  });
});

describe("memoryPageStanding", () => {
  it("distinguishes scope, designation, loading, and ready states", () => {
    expect(memoryPageStanding({ projectId: null, designated: false, index: null })).toBe(
      "no-project",
    );
    expect(memoryPageStanding({ projectId: "p", designated: false, index: null })).toBe(
      "not-designated",
    );
    expect(memoryPageStanding({ projectId: "p", designated: true, index: null })).toBe("loading");
    expect(memoryPageStanding({ projectId: "p", designated: true, index })).toBe("ready");
  });
});

const memoryNote = (overrides: Partial<MemoryNote> = {}): MemoryNote => ({
  name: "Composer",
  exists: true,
  path: "Composer.md",
  markdown: "# Composer\n",
  links: [],
  backlinks: [],
  openDecisions: [],
  ...overrides,
});

describe("memory note editor", () => {
  it("seeds editing from the loaded markdown and guards a no-op save", () => {
    const editing = beginMemoryNoteEdit(memoryNote());
    expect(editing).toEqual({
      _tag: "editing",
      markdown: "# Composer\n",
      baseMarkdown: "# Composer\n",
      refusal: null,
    });
    expect(
      memoryNoteWritePayload(MercurianProjectId.make("project"), "Composer", editing),
    ).toBeNull();

    const changed = memoryEditorReducer(editing, {
      type: "change",
      markdown: "# Composer\n\nChanged.\n",
    });
    expect(memoryNoteWritePayload(MercurianProjectId.make("project"), "Composer", changed)).toEqual(
      {
        projectId: MercurianProjectId.make("project"),
        name: "Composer",
        markdown: "# Composer\n\nChanged.\n",
        baseMarkdown: "# Composer\n",
      },
    );
    expect(memoryEditorReducer(changed, { type: "cancel" })).toBe(INITIAL_MEMORY_EDITOR_STATE);
  });

  it("opens an unwritten note with empty content and a null baseline", () => {
    const editing = beginMemoryNoteEdit(
      memoryNote({ name: "Future", exists: false, path: undefined, markdown: undefined }),
    );
    expect(editing).toMatchObject({ _tag: "editing", markdown: "", baseMarkdown: null });
    expect(
      memoryNoteWritePayload(MercurianProjectId.make("project"), "Future", editing),
    ).toBeNull();
    const changed = memoryEditorReducer(editing, { type: "change", markdown: "# Future\n" });
    expect(
      memoryNoteWritePayload(MercurianProjectId.make("project"), "Future", changed)?.baseMarkdown,
    ).toBeNull();
  });

  it("keeps the draft on note-changed refusal and reload re-seeds the editor", () => {
    const changed = memoryEditorReducer(beginMemoryNoteEdit(memoryNote()), {
      type: "change",
      markdown: "my local edit",
    });
    const refused = memoryEditorReducer(changed, {
      type: "write-refused",
      error: { _tag: "WriteMemoryNoteBlockedError", reason: "note-changed" },
    });
    expect(refused).toMatchObject({
      _tag: "editing",
      markdown: "my local edit",
      refusal: { message: "This note changed on disk.", reload: true },
    });

    const reloaded = memoryEditorReducer(refused, {
      type: "reload",
      note: memoryNote({ markdown: "changed elsewhere" }),
    });
    expect(reloaded).toEqual({
      _tag: "editing",
      markdown: "changed elsewhere",
      baseMarkdown: "changed elsewhere",
      refusal: null,
    });
  });
});

import type { WikiChangeRequest, WikiChangeRequestId, WikiIndexResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  changeRequestCanvasReview,
  documentFile,
  documentPath,
  documentTitle,
  documentTitleAmong,
  draftDocuments,
  draftLabel,
  draftMovedTo,
  isDocumentFile,
  keepCanvasName,
  resolveWikiLink,
  wikiDocumentFilesWithDraft,
  wikiDocumentScope,
  wikiDraft,
  wikiLinkFile,
  wikiLinkOpens,
  wikiSaveFailure,
} from "./wikiLogic.ts";

describe("drafts", () => {
  const draft = (files: ReadonlyArray<string>, status = "open") =>
    ({
      changeRequestId: "draft-1",
      draft: true,
      status,
      amendments: files.length === 0 ? [] : [{ files }],
      files,
    }) as unknown as WikiChangeRequest;
  const scope = (file: string, tabChangeRequestId?: WikiChangeRequestId) =>
    wikiDocumentScope({
      tabChangeRequestId,
      draft: draft(["Alpha.md", "Tasks.base", "plans/Beta.md"]),
      file,
    });

  it("finds a wiki's draft, passing over an empty, closed or ordinary one", () => {
    const ordinary = {
      draft: false,
      status: "open",
      amendments: [{ files: ["A.md"] }],
      files: ["A.md"],
    };
    expect(wikiDraft([ordinary as unknown as WikiChangeRequest])).toBeNull();
    expect(wikiDraft([draft([])])).toBeNull();
    expect(wikiDraft([draft(["A.md"], "closed")])).toBeNull();
    expect(wikiDraft([draft(["A.md"])])?.changeRequestId).toBe("draft-1");
  });

  it("reads a document from its tab's change request, else the draft if it holds it, else main", () => {
    expect(scope("alpha.md")).toBe("draft-1");
    expect(scope("plans/Beta.md")).toBe("draft-1");
    expect(scope("other/Beta.md")).toBeUndefined();
    expect(scope("Tasks.base")).toBe("draft-1");
    expect(scope("Other.base")).toBe("draft-1");
    expect(scope("Beta.md")).toBeUndefined();
    expect(scope("Alpha.md", "cr-1" as WikiChangeRequestId)).toBe("cr-1");
  });

  it("counts the documents a draft holds", () => {
    expect(draftLabel(draft(["A.md"]))).toBe("Draft · 1 document");
    expect(draftLabel(draft(["A.md", "B.md"]))).toBe("Draft · 2 documents");
  });

  it("retries a save unless the failure says it can't help", () => {
    const failure = (reason: string) => ({ _tag: "WikiError", reason, message: "No." });
    expect(wikiSaveFailure(failure("stale")).retry).toBe(true);
    expect(wikiSaveFailure(failure("git-failed")).retry).toBe(true);
    expect(wikiSaveFailure(new Error("Socket closed")).retry).toBe(true);
    expect(wikiSaveFailure(failure("invalid")).retry).toBe(false);
    expect(wikiSaveFailure(failure("checkout-busy")).retry).toBe(false);
  });
});

describe("keepCanvasName", () => {
  it.each([
    ["How a refund works", "How a refund works"],
    ["  Auth / session\tflow ", "Auth session flow"],
    ["a\\b", "a b"],
    ["...hidden", "hidden"],
  ])("names %j %j", (title, name) => {
    expect(keepCanvasName(title)).toBe(name);
  });
});

describe("changeRequestCanvasReview", () => {
  const card = (id: string, text: string) => ({ id, type: "text", text, x: 0, y: 0 });
  const file = (nodes: ReadonlyArray<object>) => JSON.stringify({ nodes, edges: [] });
  const detail = (status: "open" | "merged", before: string | null) =>
    ({
      changeRequest: { status },
      files: [{ file: "Board.canvas", before, after: "ignored" }],
    }) as unknown as Parameters<typeof changeRequestCanvasReview>[0];
  const after = file([card("a", "Changed"), card("b", "New")]);

  it("marks what the change request changes, over the text the board shows", () => {
    const review = changeRequestCanvasReview(
      detail("open", file([card("a", "One"), card("gone", "Gone")])),
      "Board.canvas",
      after,
    );
    expect(review?.marks.cards).toEqual({ a: "text", b: "added", gone: "removed" });
    expect(review?.data.nodes.map((node) => node.id)).toContain("gone");
  });

  it("marks nothing once merged, for a file it doesn't touch, or JSON that doesn't read", () => {
    expect(changeRequestCanvasReview(detail("merged", null), "Board.canvas", after)).toBeNull();
    expect(changeRequestCanvasReview(detail("open", null), "Other.canvas", after)).toBeNull();
    expect(changeRequestCanvasReview(detail("open", null), "Board.canvas", "{nope")).toBeNull();
    expect(changeRequestCanvasReview(null, "Board.canvas", after)).toBeNull();
  });
});

describe("documentTitleAmong", () => {
  const WALK = ["a/Plan.md", "b/Plan.md", "a/deep/Plan.md", "Plan.md"];

  it.each([
    ["a/Plan.md", WALK, "a/Plan"],
    ["b/Plan.md", WALK, "b/Plan"],
    ["a/deep/Plan.md", WALK, "deep/Plan"],
    ["Plan.md", WALK, "Plan"],
    ["a/Plan.md", ["a/Plan.md", "b/Other.md"], "Plan"],
    ["a/Plan.md", ["a/Plan.md", "a/Plan.md"], "Plan"],
    ["x/deep/Plan.md", ["x/deep/Plan.md", "y/deep/Plan.md"], "x/deep/Plan"],
    ["a/Plan.md", ["a/Plan.md", "x/a/Plan.md"], "a/Plan"],
    ["x/a/Plan.md", ["a/Plan.md", "x/a/Plan.md"], "x/a/Plan"],
    ["a/Plan.md", ["a/Plan.md", "adeep/plan.canvas"], "a/Plan"],
    ["deep/Plan.md", ["deep/Plan.md", "adeep/Plan.md"], "deep/Plan"],
  ])("%s among %j reads %s", (file, open, title) => {
    expect(documentTitleAmong(file, open)).toBe(title);
  });
});

describe("what a draft does to a wiki's list", () => {
  const row = (file: string) => ({ name: file.replace(/\.md$/, ""), file });
  const draft = {
    files: ["Old.md", "shelf/New.md", "fresh/First.md", "fresh/shot.png", "Edited.md"],
    moves: [{ from: "Old.md", to: "shelf/New.md" }],
  } as unknown as WikiChangeRequest;

  it("shows a moved document where it went, and a written one at all", () => {
    const listed = draftDocuments([row("Old.md"), row("Edited.md")], draft, (file, name) => ({
      name,
      file,
    }));
    expect(listed.map(({ file }) => file)).toEqual(["shelf/New.md", "Edited.md", "fresh/First.md"]);
    expect(draftMovedTo(draft, "Old.md")).toBe("shelf/New.md");
    expect(draftMovedTo(draft, "Edited.md")).toBeUndefined();
  });

  it("adds what the draft wrote to what a link finds, and takes away what it moved", () => {
    const index = {
      notes: [row("Old.md"), row("Edited.md")],
      canvases: [],
      bases: [],
      maps: [],
    } as unknown as WikiIndexResult;
    expect(wikiDocumentFilesWithDraft(index, draft)).toEqual([
      "Edited.md",
      "shelf/New.md",
      "fresh/First.md",
    ]);
    expect(wikiDocumentFilesWithDraft(index, null)).toEqual(["Old.md", "Edited.md"]);
  });

  it("leaves the list alone with no draft", () => {
    const rows = [row("Old.md")];
    expect(draftDocuments(rows, null, () => row("x"))).toBe(rows);
  });
});

describe("what a link opens", () => {
  const index = {
    notes: [{ file: "a/Note.md" }],
    canvases: [],
    bases: [],
    maps: [],
  } as unknown as Parameters<typeof wikiLinkOpens>[0];
  const placement = {
    attachments: "root",
    attachmentFolder: "",
    newNotes: "beside",
    newNoteFolder: "",
  } as const;

  it.each([
    ["Note", "b/L.md", "a/Note.md"],
    ["Red", "b/L.md", "b/Red.md"],
    ["x/Red", "b/L.md", "x/Red.md"],
    ["./Red", "b/L.md", null],
    ["../Red", "b/L.md", null],
    ["./Note", "a/L.md", "a/Note.md"],
  ])("%s from %s opens %s", (target, from, file) => {
    expect(wikiLinkOpens(index, target, from, placement)).toBe(file);
  });
});

describe("documents by path", () => {
  it("reads a path as its title, and a saved name as its file", () => {
    expect(documentTitle("a/deep/Plan.md")).toBe("Plan");
    expect(documentTitle("a/Board.canvas")).toBe("Board");
    expect(documentTitle("a/Open.base")).toBe("Open");
    expect(documentTitle("Release 1.2")).toBe("Release 1.2");
    expect(documentPath("a/Plan.md")).toBe("a/Plan");
    expect(documentFile("Plan")).toBe("Plan.md");
    expect(documentFile("a/Plan")).toBe("a/Plan.md");
    expect(documentFile("Plan.md")).toBe("Plan.md");
    expect(documentFile("Board.canvas")).toBe("Board.canvas");
  });

  it("opens wiki documents in any folder, and anything else as a file", () => {
    expect(isDocumentFile("plans/Note.md")).toBe(true);
    expect(isDocumentFile("plans/Board.canvas")).toBe(true);
    expect(isDocumentFile("plans/Open.base")).toBe(true);
    expect(isDocumentFile("plans/README.md")).toBe(true);
    expect(isDocumentFile("Map.skillmap.md")).toBe(false);
    expect(isDocumentFile("pic.png")).toBe(false);
  });

  it("follows a link as the server does, beside the linker when it finds nothing", () => {
    const index = {
      notes: [
        { name: "a/Plan", file: "a/Plan.md", outgoing: 0, incoming: 0 },
        { name: "b/Plan", file: "b/Plan.md", outgoing: 0, incoming: 0 },
      ],
      canvases: [{ file: "a/Board.canvas", outgoing: 0, incoming: 0 }],
      bases: [],
      maps: [],
    };
    expect(wikiLinkFile(index, "Plan", "b/Note.md")).toBe("b/Plan.md");
    expect(wikiLinkFile(index, "Board.canvas", null)).toBe("a/Board.canvas");
    expect(wikiLinkFile(index, "New", "b/Note.md")).toBe("b/New.md");
    expect(wikiLinkFile(index, "c/New", "b/Note.md")).toBe("c/New.md");
    expect(wikiLinkFile(null, "/a/Plan.md", "b/Note.md")).toBe("a/Plan.md");
    expect(resolveWikiLink(index, "Plan", "c/Note.md")).toEqual({
      file: "a/Plan.md",
      others: ["b/Plan.md"],
    });
  });
});

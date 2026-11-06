import type { WikiChangeRequest, WikiChangeRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  changeRequestCanvasReview,
  draftLabel,
  keepCanvasName,
  wikiDocumentScope,
  wikiDraft,
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
  const scope = (name: string, tabChangeRequestId?: WikiChangeRequestId) =>
    wikiDocumentScope({ tabChangeRequestId, draft: draft(["Alpha.md", "Tasks.base"]), name });

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
    expect(scope("alpha")).toBe("draft-1");
    expect(scope("Tasks.base")).toBe("draft-1");
    expect(scope("Other.base")).toBe("draft-1");
    expect(scope("Beta")).toBeUndefined();
    expect(scope("Alpha", "cr-1" as WikiChangeRequestId)).toBe("cr-1");
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

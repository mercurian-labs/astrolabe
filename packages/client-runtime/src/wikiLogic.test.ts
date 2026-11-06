import { describe, expect, it } from "vite-plus/test";

import { changeRequestCanvasReview, keepCanvasName } from "./wikiLogic.ts";

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

import { describe, expect, it } from "vite-plus/test";

import {
  memoryMergeHomeSuggestion,
  suggestionsAfterDismiss,
  type PlanSuggestion,
} from "./planSuggestions.logic";

describe("plan suggestions", () => {
  it("stays dismissed until a suggestion not present at dismissal appears", () => {
    const first: PlanSuggestion = {
      id: "first",
      noteName: "Composer",
      question: "First?",
      label: "First suggestion",
      message: "First message",
    };
    const second: PlanSuggestion = {
      id: "second",
      noteName: "Plans",
      question: "Second?",
      label: "Second suggestion",
      message: "Second message",
    };
    const dismissed = new Set([first.id]);
    expect(suggestionsAfterDismiss([first], dismissed)).toEqual([]);
    expect(suggestionsAfterDismiss([first, second], dismissed)).toEqual([first, second]);
  });
});

describe("memory merge-home suggestion", () => {
  const noChanges = { marked: [], hand: [], unmarked: null, unreviewedCount: 0 } as const;
  const changes = {
    ...noChanges,
    unmarked: { id: "unmarked:head:snapshot:paths", diff: "diff --git a/Memory.md b/Memory.md" },
    unreviewedCount: 1,
  };
  const detail = (prState?: "open" | "closed" | "merged", archivedAt?: string) =>
    ({
      plan: archivedAt === undefined ? {} : { archivedAt },
      codingSessions: prState === undefined ? [] : [{ prState }],
    }) as never;

  it("appears for changed memory after a merged pull request", () => {
    expect(memoryMergeHomeSuggestion(detail("merged"), changes)?.label).toBe(
      "Merge this line's memory home",
    );
  });

  it("appears for changed memory on an archived plan", () => {
    expect(
      memoryMergeHomeSuggestion(detail(undefined, "2026-09-04T00:00:00.000Z"), changes),
    ).not.toBeNull();
  });

  it("stays hidden without memory changes or a shipped signal", () => {
    expect(memoryMergeHomeSuggestion(detail("merged"), noChanges)).toBeNull();
    expect(memoryMergeHomeSuggestion(detail("open"), changes)).toBeNull();
  });
});

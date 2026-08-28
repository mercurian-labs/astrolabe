import type { MemoryNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectMentionedMemoryNoteNames,
  planSuggestionMessage,
  suggestionsAfterDismiss,
  unresolvedMemoryNoteSuggestions,
} from "./planSuggestions.logic";

const note = (
  name: string,
  decisions: ReadonlyArray<{ readonly title: string; readonly resolved: boolean }>,
): MemoryNote => ({
  name,
  exists: true,
  path: `${name}.md`,
  markdown: "",
  links: [],
  backlinks: [],
  openDecisions: decisions,
});

describe("plan suggestions", () => {
  it("collects and deduplicates note mentions from current timeline messages", () => {
    expect(
      collectMentionedMemoryNoteNames([
        { _tag: "message", text: "Read [[Composer]] and [[Plans|the plan note]]." },
        { _tag: "spec-revision" },
        { _tag: "message", text: "Return to [[composer]]." },
      ]),
    ).toEqual(["Composer", "Plans"]);
  });

  it("offers unresolved decisions only and deduplicates identical entries", () => {
    const suggestions = unresolvedMemoryNoteSuggestions([
      note("Composer", [
        { title: "Where should suggestions live?", resolved: false },
        { title: "Should drafts persist?", resolved: true },
      ]),
      note("Composer", [{ title: "Where should suggestions live?", resolved: false }]),
    ]);
    expect(suggestions.map(({ label }) => label)).toEqual([
      "Composer: Where should suggestions live?",
    ]);
  });

  it("writes the note token and quoted question into the sent message", () => {
    expect(planSuggestionMessage("Composer", "Where should suggestions live?")).toBe(
      `Let's resolve the open decision on [[Composer]]: "Where should suggestions live?".`,
    );
  });

  it("stays dismissed until a suggestion not present at dismissal appears", () => {
    const [first, second] = unresolvedMemoryNoteSuggestions([
      note("Composer", [
        { title: "First?", resolved: false },
        { title: "Second?", resolved: false },
      ]),
    ]);
    if (first === undefined || second === undefined) throw new Error("expected suggestions");
    const dismissed = new Set([first.id]);
    expect(suggestionsAfterDismiss([first], dismissed)).toEqual([]);
    expect(suggestionsAfterDismiss([first, second], dismissed)).toEqual([first, second]);
  });
});

import { describe, expect, it } from "vite-plus/test";

import { suggestionsAfterDismiss, type PlanSuggestion } from "./planSuggestions.logic";

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

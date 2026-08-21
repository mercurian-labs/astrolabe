import { ProviderInstanceId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { buildMobileCodingSessionDraft } from "./codingSessionDraftSheet.logic";
import {
  clearMobileCodingSessionDraft,
  findMobileCodingSessionDraft,
  openMobileCodingSessionDraft,
  resetMobileCodingSessionDraftsForTest,
  updateMobileCodingSessionDraft,
} from "./codingSessionDraft";

const draft = (planId: string, parentCommitId: string) =>
  buildMobileCodingSessionDraft({
    planId,
    parentCommitId,
    repositoryId: "repo",
    repositoryName: "Mobile",
    baseRef: "main",
    startFromOrigin: true,
    runtimeMode: "full-access",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
  });

describe("mobile coding session draft store", () => {
  beforeEach(resetMobileCodingSessionDraftsForTest);

  it("resumes by plan and parent commit without crossing either boundary", () => {
    const first = openMobileCodingSessionDraft(draft("plan-a", "parent-a"));
    openMobileCodingSessionDraft(draft("plan-a", "parent-b"));
    openMobileCodingSessionDraft(draft("plan-b", "parent-a"));
    updateMobileCodingSessionDraft("plan-a", "parent-a", {
      baseRef: "release",
      runtimeMode: "approval-required",
    });

    expect(findMobileCodingSessionDraft("plan-a", "parent-a")).toMatchObject({
      draftId: first.draftId,
      baseRef: "release",
      runtimeMode: "approval-required",
    });
    expect(findMobileCodingSessionDraft("plan-a", "parent-b")?.baseRef).toBe("main");
    expect(findMobileCodingSessionDraft("plan-b", "parent-a")?.baseRef).toBe("main");
  });

  it("keeps the first seed on reopen and clears only after Start succeeds", () => {
    openMobileCodingSessionDraft(draft("plan", "parent"));
    updateMobileCodingSessionDraft("plan", "parent", { startFromOrigin: false });

    expect(
      openMobileCodingSessionDraft({ ...draft("plan", "parent"), baseRef: "other" }),
    ).toMatchObject({ baseRef: "main", startFromOrigin: false });

    clearMobileCodingSessionDraft("plan", "parent");
    expect(findMobileCodingSessionDraft("plan", "parent")).toBeNull();
  });
});

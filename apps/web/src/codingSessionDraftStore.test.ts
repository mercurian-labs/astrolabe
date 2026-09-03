import { ProviderInstanceId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  decodeCodingSessionDraftStorage,
  findCodingSessionDraft,
  useCodingSessionDraftStore,
  type CodingSessionDraft,
} from "./codingSessionDraftStore";

const draft = (id: string, planId = "plan", parentCommitId = "parent"): CodingSessionDraft => ({
  draftId: id,
  planId,
  parentCommitId,
  runtimeMode: "full-access",
  modelSelection: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5.6" },
  createdAt: "2026-08-14T12:00:00.000Z",
});

describe("codingSessionDraftStore", () => {
  beforeEach(() => {
    useCodingSessionDraftStore.setState((state) => {
      const { lastModelSelection: _last, ...rest } = state;
      return { ...rest, draftsById: {} };
    }, true);
  });

  it("keeps one draft per plan and ready commit while allowing siblings", () => {
    const store = useCodingSessionDraftStore.getState();
    expect(store.openDraft(draft("first")).draftId).toBe("first");
    expect(store.openDraft(draft("duplicate")).draftId).toBe("first");
    expect(store.openDraft(draft("sibling", "plan", "other-parent")).draftId).toBe("sibling");
    expect(Object.keys(useCodingSessionDraftStore.getState().draftsById)).toHaveLength(2);
    expect(
      findCodingSessionDraft(useCodingSessionDraftStore.getState().draftsById, "plan", "parent")
        ?.draftId,
    ).toBe("first");
  });

  it("ignores corrupt storage and invalid draft records", () => {
    expect(decodeCodingSessionDraftStorage("not json")).toEqual({});
    expect(
      decodeCodingSessionDraftStorage(
        JSON.stringify({ draftsById: { invalid: { draftId: "invalid" } } }),
      ),
    ).toEqual({ draftsById: {} });
  });

  it("updates stickiness only after a successful start and discards that draft", () => {
    useCodingSessionDraftStore.getState().openDraft(draft("first"));
    useCodingSessionDraftStore.getState().updateDraft("first", {
      modelSelection: { instanceId: ProviderInstanceId.make("claude-work"), model: "opus" },
    });
    expect(useCodingSessionDraftStore.getState().lastModelSelection).toBeUndefined();
    useCodingSessionDraftStore.getState().completeStart("first");
    expect(useCodingSessionDraftStore.getState().draftsById.first).toBeUndefined();
    expect(useCodingSessionDraftStore.getState().lastModelSelection).toEqual({
      instanceId: "claude-work",
      model: "opus",
    });
  });

  it("prunes drafts whose plans no longer exist", () => {
    const store = useCodingSessionDraftStore.getState();
    store.openDraft(draft("keep", "kept"));
    store.openDraft(draft("drop", "missing"));
    useCodingSessionDraftStore.getState().pruneMissingPlans(new Set(["kept"]));
    expect(Object.keys(useCodingSessionDraftStore.getState().draftsById)).toEqual(["keep"]);
  });
});

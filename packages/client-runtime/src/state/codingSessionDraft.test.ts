import { MercurianRepositoryId, ProviderInstanceId, type VcsRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { commitId } from "../../../../apps/web/src/test/fixtures/timeline.ts";

import {
  CODING_SESSION_RUNTIME_MODES,
  createCodingSessionDraft,
  localBranchOptions,
  seedBaseRef,
  startCodingSessionPayload,
} from "./codingSessionDraft.ts";

const ref = (name: string, input: Partial<VcsRef> = {}): VcsRef => ({
  name,
  current: false,
  isDefault: false,
  worktreePath: null,
  ...input,
});

describe("codingSessionDraft logic", () => {
  it("seeds only local base refs, preferring default and then current", () => {
    const refs = [
      ref("origin/main", { isRemote: true, remoteName: "origin", isDefault: true }),
      ref("feature", { current: true }),
      ref("main", { isDefault: true }),
    ];
    expect(localBranchOptions(refs).map(({ name }) => name)).toEqual(["feature", "main"]);
    expect(seedBaseRef(refs)).toBe("main");
    expect(seedBaseRef([ref("feature", { current: true })])).toBe("feature");
  });

  it("offers exactly the three supported runtime modes", () => {
    expect(CODING_SESSION_RUNTIME_MODES.map(({ value }) => value)).toEqual([
      "approval-required",
      "auto-accept-edits",
      "full-access",
    ]);
  });

  it("fixes the ready repository and emits every editable start field", () => {
    const draft = createCodingSessionDraft({
      draftId: "draft",
      planId: "plan",
      ready: {
        commitId: commitId("ready"),
        repositoryId: MercurianRepositoryId.make("repo"),
        repositoryName: "server",
      },
      baseRef: "main",
      startFromOrigin: true,
      modelSelection: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5.6" },
      createdAt: "2026-08-14T00:00:00.000Z",
    });
    expect(draft.repositoryName).toBe("server");
    expect(startCodingSessionPayload({ ...draft, runtimeMode: "approval-required" })).toEqual({
      planId: "plan",
      parentCommitId: "ready",
      repositoryId: "repo",
      baseRef: "main",
      startFromOrigin: true,
      runtimeMode: "approval-required",
      modelSelection: { instanceId: "codex-work", model: "gpt-5.6" },
    });
  });
});

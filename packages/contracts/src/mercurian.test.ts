import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import {
  CodingSessionBlockedError,
  MercurianCommitId,
  MercurianRepositoryId,
  MercurianStartCodingSessionInput,
  PlanId,
  PlanStreamItem,
  ProviderInstanceId,
} from "./index.ts";

describe("coding-session contracts", () => {
  it("round-trips an exact-instance start payload", () => {
    const input = {
      planId: PlanId.make("plan"),
      parentCommitId: MercurianCommitId.make("ready"),
      repositoryId: MercurianRepositoryId.make("repo"),
      baseRef: "main",
      startFromOrigin: true,
      runtimeMode: "full-access" as const,
      modelSelection: { instanceId: ProviderInstanceId.make("codex-work"), model: "gpt-5.6" },
    };
    expect(Schema.decodeUnknownSync(MercurianStartCodingSessionInput)(input)).toEqual(input);
  });

  it("round-trips keyed side-fact frames and typed refusals", () => {
    const frame = {
      kind: "coding-sessions" as const,
      sessions: [
        {
          commitId: MercurianCommitId.make("session"),
          repositoryId: MercurianRepositoryId.make("repo"),
          threadId: ThreadId.make("thread"),
          branch: "mercurian/plan-12345678",
          worktreePath: "/tmp/session",
          baseRef: "main",
          startedAt: "2026-08-14T00:00:00.000Z",
          endedAt: null,
          outcome: null,
          prUrl: null,
        },
      ],
    };
    expect(Schema.decodeUnknownSync(PlanStreamItem)(frame)).toEqual(frame);
    expect(
      Schema.decodeUnknownSync(CodingSessionBlockedError)(
        new CodingSessionBlockedError({ reason: "model-unavailable" }),
      ).reason,
    ).toBe("model-unavailable");
    for (const reason of [
      "not-ready",
      "repository-mismatch",
      "repository-not-in-project",
      "repository-not-git",
      "base-ref-missing",
      "no-instance",
      "model-unavailable",
    ] as const) {
      expect(new CodingSessionBlockedError({ reason }).message).not.toContain(reason);
    }
  });
});

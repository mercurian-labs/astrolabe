import { MercurianCommitId, MercurianRepositoryId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { composePlanRowStatus } from "./wire.ts";

const session = {
  commitId: MercurianCommitId.make("session"),
  repositoryId: MercurianRepositoryId.make("repository"),
  threadId: ThreadId.make("thread"),
  branch: "mercurian/session-12345678",
  worktreePath: "/tmp/session",
  baseRef: "main",
  startedAt: "2026-08-18T00:00:00.000Z",
  endedAt: null,
  outcome: null,
  prUrl: null,
} as const;

describe("planning wire coding-session status", () => {
  it("rolls a running session into the existing Working fact", () => {
    expect(composePlanRowStatus({ isWorking: false, hasPendingInput: false }, [session])).toEqual({
      isWorking: true,
      hasPendingInput: false,
    });
  });

  it("leaves status byte-for-byte unchanged when there are no sessions", () => {
    const status = { isWorking: false, hasPendingInput: true } as const;
    expect(composePlanRowStatus(status, [])).toEqual(status);
    expect(
      composePlanRowStatus(status, [{ ...session, endedAt: "2026-08-18T01:00:00.000Z" }]),
    ).toEqual(status);
  });
});

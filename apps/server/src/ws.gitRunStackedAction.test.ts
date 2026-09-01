import { assert, it } from "@effect/vitest";
import { MercurianCommitId, MercurianRepositoryId, PlanId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { attachCreatedPullRequestToCodingSession } from "./ws.ts";

const sessionRecord = {
  commitId: MercurianCommitId.make("session-pr-commit"),
  planId: PlanId.make("session-pr-plan"),
  repositoryId: MercurianRepositoryId.make("session-pr-repository"),
  threadId: ThreadId.make("thread-session-pr"),
  branch: "feature/session-pr",
  worktreePath: "/tmp/session-pr",
  baseRef: "main",
  startedAt: DateTime.makeUnsafe("2026-08-20T12:00:00.000Z"),
  endedAt: null,
  outcome: null,
  prUrl: null,
  settledCommitOid: null,
  partial: false,
} as const;

const createdResult = {
  action: "create_pr" as const,
  branch: { status: "skipped_not_requested" as const },
  commit: { status: "skipped_not_requested" as const },
  push: { status: "pushed" as const, branch: "feature/session-pr" },
  pr: {
    status: "created" as const,
    url: "https://example.com/pr/119",
    number: 119,
    baseBranch: "main",
    headBranch: "feature/session-pr",
    title: "Session header actions",
  },
  toast: {
    title: "Created PR #119",
    cta: {
      kind: "open_pr" as const,
      label: "View PR",
      url: "https://example.com/pr/119",
    },
  },
};

it.effect("attaches a newly-created PR to the session resolved by branch", () =>
  Effect.gen(function* () {
    const attached: Array<{ readonly threadId: ThreadId; readonly prUrl: string }> = [];
    yield* attachCreatedPullRequestToCodingSession(
      {
        getByBranch: () => Effect.succeed(Option.some(sessionRecord)),
        attachPullRequest: (input) => Effect.sync(() => attached.push(input)),
      },
      createdResult,
      sessionRecord.branch,
    );
    assert.deepStrictEqual(attached, [
      { threadId: sessionRecord.threadId, prUrl: "https://example.com/pr/119" },
    ]);
  }),
);

it.effect("leaves an upstream thread with no coding-session row untouched", () =>
  Effect.gen(function* () {
    let attachCalls = 0;
    yield* attachCreatedPullRequestToCodingSession(
      {
        getByBranch: () => Effect.succeed(Option.none()),
        attachPullRequest: () => Effect.sync(() => attachCalls++),
      },
      createdResult,
      "feature/upstream",
    );
    assert.strictEqual(attachCalls, 0);
  }),
);

import { assert, it } from "@effect/vitest";
import { MercurianCommitId, MercurianRepositoryId, PlanId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { attachCreatedPullRequestToCodingSession } from "./ws.ts";

const sessionRecord = {
  lineRootCommitId: MercurianCommitId.make("session-pr-commit"),
  planId: PlanId.make("session-pr-plan"),
  homeRepositoryId: MercurianRepositoryId.make("session-pr-repository"),
  threadId: ThreadId.make("thread-session-pr"),
  branch: "feature/session-pr",
  worktreePath: "/tmp/session-pr",
  snapshotOid: null,
  snapshotKind: null,
  departedRef: null,
  branchMovement: null,
  lineBranchMissingOid: null,
  unreachableRepositories: [],
  createdAt: DateTime.makeUnsafe("2026-08-20T12:00:00.000Z"),
  updatedAt: DateTime.makeUnsafe("2026-08-20T12:00:00.000Z"),
  repositories: [],
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

it.effect("attaches a newly-created PR to the session repository resolved by cwd", () =>
  Effect.gen(function* () {
    const attached: Array<{
      readonly threadId: ThreadId;
      readonly repositoryId: MercurianRepositoryId;
      readonly prUrl: string;
    }> = [];
    yield* attachCreatedPullRequestToCodingSession(
      {
        getByBranch: () => Effect.succeed(Option.some(sessionRecord)),
        attachPullRequest: (input) => Effect.sync(() => attached.push(input)),
      },
      { getByBranch: () => Effect.succeed(Option.none()) },
      createdResult,
      sessionRecord.branch,
      "/tmp/member-b",
      () =>
        Effect.succeed(
          Option.some({
            workspaceMembers: [
              {
                repositoryId: MercurianRepositoryId.make("member-b"),
                worktreePath: "/tmp/member-b",
              },
            ],
          } as never),
        ),
      [],
    );
    assert.deepStrictEqual(attached, [
      {
        threadId: sessionRecord.threadId,
        repositoryId: MercurianRepositoryId.make("member-b"),
        prUrl: "https://example.com/pr/119",
      },
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
      { getByBranch: () => Effect.succeed(Option.none()) },
      createdResult,
      "feature/upstream",
      "/tmp/upstream",
      () => Effect.succeed(Option.none()),
      [],
    );
    assert.strictEqual(attachCalls, 0);
  }),
);

it.effect("keeps attaching pull requests for a legacy coding-session thread", () =>
  Effect.gen(function* () {
    const attached: Array<{
      readonly threadId: ThreadId;
      readonly repositoryId: MercurianRepositoryId;
      readonly prUrl: string;
    }> = [];
    const legacyThreadId = ThreadId.make("legacy-session-thread");
    yield* attachCreatedPullRequestToCodingSession(
      {
        getByBranch: () => Effect.succeed(Option.none()),
        attachPullRequest: (input) => Effect.sync(() => attached.push(input)),
      },
      {
        getByBranch: () =>
          Effect.succeed(
            Option.some({
              threadId: legacyThreadId,
              repositoryId: MercurianRepositoryId.make("legacy-repository"),
            } as never),
          ),
      },
      createdResult,
      sessionRecord.branch,
      "/tmp/legacy-session",
      () => Effect.succeed(Option.none()),
      [],
    );
    assert.deepStrictEqual(attached, [
      {
        threadId: legacyThreadId,
        repositoryId: MercurianRepositoryId.make("legacy-repository"),
        prUrl: "https://example.com/pr/119",
      },
    ]);
  }),
);

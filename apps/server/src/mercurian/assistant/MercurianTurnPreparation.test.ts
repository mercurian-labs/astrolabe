import { assert, it } from "@effect/vitest";
import {
  MessageId,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  PlanId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  TurnPreparation,
  TurnPreparationDefault,
} from "../../orchestration/Services/TurnPreparation.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import { CommitId, HistoryId } from "../commitTree/schema.ts";
import * as LineRuntimeStore from "../lineRuntimes/LineRuntimeStore.ts";
import * as MemoryIndex from "../memory/MemoryIndex.ts";
import * as MemorySourceStore from "../memory/MemorySourceStore.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import { MercurianTurnPreparationLive } from "./MercurianTurnPreparation.ts";

const now = DateTime.makeUnsafe("2026-09-03T12:00:00.000Z");
const threadId = ThreadId.make("line-thread");
const planId = PlanId.make("plan");
const parentId = CommitId.make("parent-message");
const messageId = MessageId.make("human-message");
const message = {
  id: messageId,
  role: "user" as const,
  text: "Build it",
  attachments: [],
  turnId: null,
  streaming: false,
  createdAt: "2026-09-03T12:00:00.000Z",
  updatedAt: "2026-09-03T12:00:00.000Z",
};
const thread = {
  id: threadId,
  messages: [message],
  workspaceMembers: [
    { repositoryId: MercurianRepositoryId.make("repository"), worktreePath: "/tmp/repository" },
  ],
} as never;

interface PreparationOptions {
  readonly parentCommitId?: CommitId;
  readonly timeline: ReadonlyArray<Record<string, unknown>>;
  readonly ancestors: ReadonlyArray<Record<string, unknown>>;
  readonly planText?: string;
  readonly spec?: { readonly goal: string; readonly acceptanceCriteria: string } | null;
  readonly memory?: {
    readonly rootPath: string;
    readonly notes: Readonly<
      Record<
        string,
        {
          readonly exists: boolean;
          readonly path?: string;
          readonly backlinks?: ReadonlyArray<string>;
        }
      >
    >;
  };
}

const preparationDependencies = (options: PreparationOptions) => {
  const runtime = {
    planId,
    lineRootCommitId: MercurianCommitId.make("line-root"),
    threadId,
    homeRepositoryId: MercurianRepositoryId.make("repository"),
    branch: "mercurian/line",
    worktreePath: "/tmp/repository",
    unreachableRepositories: [],
    snapshotOid: null,
    snapshotKind: null,
    departedRef: null,
    branchMovement: null,
    lineBranchMissingOid: null,
    createdAt: now,
    updatedAt: now,
    repositories: [
      {
        repositoryId: MercurianRepositoryId.make("repository"),
        repositoryName: "server",
        snapshotOid: null,
        snapshotKind: null,
        branchTipOid: null,
        departedRef: null,
        branchMovement: null,
        prUrl: null,
      },
    ],
  };
  const source =
    options.memory === undefined
      ? Option.none()
      : Option.some({
          projectId: MercurianProjectId.make("project"),
          repositoryId: MercurianRepositoryId.make("memory"),
          repositoryName: "project-memory",
          repositoryPath: options.memory.rootPath,
          rootPath: options.memory.rootPath,
          subpath: null,
          createdAt: now,
          updatedAt: now,
        });
  return Layer.mergeAll(
    Layer.mock(LineRuntimeStore.LineRuntimeStore)({
      getByThreadId: () => Effect.succeed(Option.some(runtime)),
    }),
    Layer.mock(PlanningStore.PlanningStore)({
      getPlanSnapshot: () =>
        Effect.succeed({
          plan: { planId, projectId: MercurianProjectId.make("project"), title: "Ship runtime" },
          timeline: options.timeline,
        } as never),
      getPlanTextAt: () => Effect.succeed(options.planText ?? ""),
      getSpecAt: () =>
        Effect.succeed(options.spec == null ? null : ({ document: options.spec } as never)),
    }),
    Layer.mock(CommitStore.CommitStore)({
      getCommit: () =>
        Effect.succeed(
          Option.some({
            parents: options.parentCommitId === undefined ? [] : [options.parentCommitId],
          } as never),
        ),
      ancestors: () => Effect.succeed(options.ancestors as never),
    }),
    Layer.mock(MemorySourceStore.MemorySourceStore)({
      getResolvedSource: () => Effect.succeed(source),
    }),
    Layer.mock(MemoryIndex.MemoryIndex)({
      readNote: (_projectId, name) => {
        const note = options.memory?.notes[name];
        return Effect.succeed({
          name,
          exists: note?.exists ?? false,
          ...(note?.path === undefined ? {} : { path: note.path }),
          links: [],
          backlinks: [...(note?.backlinks ?? [])],
        } as never);
      },
    }),
  );
};

const ancestor = (commitId: CommitId, sequence: number, kind: "message" | "spec-revision") => ({
  commitId,
  historyId: HistoryId.make("history"),
  sequence,
  kind,
  authorKind: "human" as const,
  parents: [],
  published: true,
  createdAt: now,
  payload: {},
});

it.effect("keeps the default turn preparation byte-identical", () =>
  Effect.gen(function* () {
    const preparation = yield* TurnPreparation;
    assert.deepStrictEqual(yield* preparation.prepare({ thread, message, sessionIsFresh: true }), {
      text: "Build it",
      session: {},
    });
  }).pipe(Effect.provide(TurnPreparationDefault)),
);

it.effect(
  "adds the appendix and ancestor transcript with skipResume on the first line turn",
  () => {
    let transcriptHead: CommitId | undefined;
    const dependencies = Layer.mergeAll(
      Layer.mock(LineRuntimeStore.LineRuntimeStore)({
        getByThreadId: () =>
          Effect.succeed(
            Option.some({
              planId,
              lineRootCommitId: MercurianCommitId.make("line-root"),
              threadId,
              homeRepositoryId: MercurianRepositoryId.make("repository"),
              branch: "mercurian/line",
              worktreePath: "/tmp/repository",
              unreachableRepositories: [],
              snapshotOid: null,
              snapshotKind: null,
              departedRef: null,
              branchMovement: null,
              lineBranchMissingOid: null,
              createdAt: now,
              updatedAt: now,
              repositories: [
                {
                  repositoryId: MercurianRepositoryId.make("repository"),
                  repositoryName: "server",
                  snapshotOid: null,
                  snapshotKind: null,
                  branchTipOid: null,
                  departedRef: null,
                  branchMovement: null,
                  prUrl: null,
                },
              ],
            }),
          ),
      }),
      Layer.mock(PlanningStore.PlanningStore)({
        getPlanSnapshot: () =>
          Effect.succeed({
            plan: { planId, projectId: MercurianProjectId.make("project"), title: "Ship runtime" },
            timeline: [
              {
                _tag: "message",
                commitId: MercurianCommitId.make(parentId),
                parents: [],
                sequence: 1,
                authorKind: "human",
                text: "Earlier request",
                createdAt: now,
              },
            ],
          } as never),
        getPlanTextAt: () => Effect.succeed("# Current plan"),
        getSpecAt: () => Effect.succeed(null),
      }),
      Layer.mock(CommitStore.CommitStore)({
        getCommit: () => Effect.succeed(Option.some({ parents: [parentId] } as never)),
        ancestors: ({ commitId }) =>
          Effect.sync(() => {
            transcriptHead = commitId;
            return [
              {
                commitId: parentId,
                historyId: HistoryId.make("history"),
                sequence: 1,
                kind: "message" as const,
                authorKind: "human" as const,
                parents: [],
                published: true,
                createdAt: now,
                payload: {},
              },
            ];
          }),
      }),
      Layer.mock(MemorySourceStore.MemorySourceStore)({
        getResolvedSource: () => Effect.succeed(Option.none()),
      }),
      Layer.mock(MemoryIndex.MemoryIndex)({}),
    );
    return Effect.gen(function* () {
      const preparation = yield* TurnPreparation;
      const fresh = yield* preparation.prepare({ thread, message, sessionIsFresh: true });
      const continued = yield* preparation.prepare({ thread, message, sessionIsFresh: false });
      assert.ok(fresh.text.includes("planning assistant"));
      assert.ok(fresh.text.includes("Earlier request"));
      assert.ok(fresh.text.includes("Build it"));
      assert.strictEqual(transcriptHead, parentId);
      assert.deepStrictEqual(fresh.session, { skipResume: true });
      assert.deepStrictEqual(continued, { text: "Build it", session: {} });
    }).pipe(Effect.provide(Layer.provide(MercurianTurnPreparationLive, dependencies)));
  },
);

it.effect("adds only the appendix to a brand-new line's first turn", () => {
  const dependencies = preparationDependencies({
    timeline: [],
    ancestors: [],
  });
  return Effect.gen(function* () {
    const preparation = yield* TurnPreparation;
    const prepared = yield* preparation.prepare({ thread, message, sessionIsFresh: true });
    assert.ok(prepared.text.includes("planning assistant"));
    assert.ok(prepared.text.includes("Reply to this message:\nBuild it"));
    assert.ok(!prepared.text.includes("Earlier conversation"));
    assert.deepStrictEqual(prepared.session, {});
  }).pipe(Effect.provide(Layer.provide(MercurianTurnPreparationLive, dependencies)));
});

it.effect("grounds reachable memory and resolves note mentions on the first turn", () => {
  const root = CommitId.make("root");
  const dependencies = preparationDependencies({
    parentCommitId: root,
    timeline: [
      {
        _tag: "message",
        commitId: MercurianCommitId.make(root),
        parents: [],
        sequence: 1,
        authorKind: "human",
        text: "Earlier request",
        createdAt: now,
      },
    ],
    ancestors: [ancestor(root, 1, "message")],
    memory: {
      rootPath: "/memory",
      notes: {
        Composer: { exists: true, path: "/memory/Composer.md" },
        Future: { exists: false, backlinks: ["Plans"] },
      },
    },
  });
  const mentionedMessage = {
    ...message,
    text: "Use [[Composer]] and [[Future]].",
  };
  return Effect.gen(function* () {
    const preparation = yield* TurnPreparation;
    const prepared = yield* preparation.prepare({
      thread,
      message: mentionedMessage,
      sessionIsFresh: true,
    });
    assert.ok(prepared.text.includes("Project memory (durable design truth"));
    assert.ok(prepared.text.includes("- /memory"));
    assert.ok(prepared.text.includes("Earlier request"));
    assert.ok(prepared.text.includes("- Composer: /memory/Composer.md"));
    assert.ok(prepared.text.includes("- Future: not yet written — linked from Plans"));
    assert.ok(prepared.text.includes("Reply to this message:\nUse [[Composer]] and [[Future]]."));
  }).pipe(Effect.provide(Layer.provide(MercurianTurnPreparationLive, dependencies)));
});

it.effect("includes a standalone human spec revision in the next turn input", () => {
  const root = CommitId.make("root");
  const specRevision = CommitId.make("spec-revision");
  const spec = {
    goal: "Keep the revised navigation contract",
    acceptanceCriteria: "The sidebar preserves the active project while it resizes.",
  };
  const dependencies = preparationDependencies({
    parentCommitId: specRevision,
    timeline: [
      {
        _tag: "message",
        commitId: MercurianCommitId.make(root),
        parents: [],
        sequence: 1,
        authorKind: "human",
        text: "Reshape the sidebar",
        createdAt: now,
      },
      {
        _tag: "spec-revision",
        commitId: MercurianCommitId.make(specRevision),
        parents: [MercurianCommitId.make(root)],
        sequence: 2,
        authorKind: "human",
        cause: "direct",
        createdAt: now,
      },
    ],
    ancestors: [ancestor(root, 1, "message"), ancestor(specRevision, 2, "spec-revision")],
    spec,
  });
  const nextMessage = { ...message, text: "What should change in the plan?" };
  return Effect.gen(function* () {
    const preparation = yield* TurnPreparation;
    const prepared = yield* preparation.prepare({
      thread,
      message: nextMessage,
      sessionIsFresh: true,
    });
    assert.ok(prepared.text.includes("[The person revised the spec.]"));
    assert.ok(prepared.text.includes("Goal / user story:\nKeep the revised navigation contract"));
    assert.ok(
      prepared.text.includes(
        "Acceptance criteria:\n---\nThe sidebar preserves the active project while it resizes.",
      ),
    );
    assert.ok(prepared.text.includes("Reply to this message:\nWhat should change in the plan?"));
  }).pipe(Effect.provide(Layer.provide(MercurianTurnPreparationLive, dependencies)));
});

it.effect("keeps the next line turn resumable while resolving note mentions", () => {
  const dependencies = preparationDependencies({
    parentCommitId: CommitId.make("root"),
    timeline: [],
    ancestors: [],
    memory: {
      rootPath: "/memory",
      notes: { Composer: { exists: true, path: "/memory/Composer.md" } },
    },
  });
  const continuedMessage = { ...message, text: "Consult [[Composer]]." };
  return Effect.gen(function* () {
    const preparation = yield* TurnPreparation;
    const prepared = yield* preparation.prepare({
      thread,
      message: continuedMessage,
      sessionIsFresh: false,
    });
    assert.strictEqual(
      prepared.text,
      "Consult [[Composer]].\n\n---\n\nMemory notes mentioned in this message:\n- Composer: /memory/Composer.md",
    );
    assert.deepStrictEqual(prepared.session, {});
  }).pipe(Effect.provide(Layer.provide(MercurianTurnPreparationLive, dependencies)));
});

it.effect("a fork rebuilds the session with the ancestor transcript", () => {
  const root = CommitId.make("root");
  const selected = CommitId.make("selected");
  const other = CommitId.make("other");
  const dependencies = preparationDependencies({
    parentCommitId: selected,
    timeline: [
      {
        _tag: "message",
        commitId: MercurianCommitId.make(root),
        parents: [],
        sequence: 1,
        authorKind: "human",
        text: "Reshape the sidebar",
        createdAt: now,
      },
      {
        _tag: "message",
        commitId: MercurianCommitId.make(selected),
        parents: [MercurianCommitId.make(root)],
        sequence: 2,
        authorKind: "assistant",
        text: "Selected answer",
        createdAt: now,
      },
      {
        _tag: "message",
        commitId: MercurianCommitId.make(other),
        parents: [MercurianCommitId.make(root)],
        sequence: 3,
        authorKind: "assistant",
        text: "Other answer",
        createdAt: now,
      },
    ],
    ancestors: [
      ancestor(root, 1, "message"),
      { ...ancestor(selected, 2, "message"), authorKind: "assistant" as const },
    ],
  });
  const forkMessage = { ...message, text: "Try another direction" };
  return Effect.gen(function* () {
    const preparation = yield* TurnPreparation;
    const prepared = yield* preparation.prepare({
      thread,
      message: forkMessage,
      sessionIsFresh: true,
    });
    assert.ok(prepared.text.includes("resuming a planning conversation"));
    assert.ok(prepared.text.includes("Reshape the sidebar"));
    assert.ok(prepared.text.includes("Selected answer"));
    assert.ok(!prepared.text.includes("Other answer"));
    assert.ok(prepared.text.includes("Reply to this message:\nTry another direction"));
  }).pipe(Effect.provide(Layer.provide(MercurianTurnPreparationLive, dependencies)));
});

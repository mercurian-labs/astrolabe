import * as Path from "effect/Path";
import { StorageSourceStore } from "../storage/StorageSourceStore.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ReconstructionStore } from "./ReconstructionStore.ts";
import { ReconstructionSummary } from "./ReconstructionSummary.ts";
import { assert, it } from "@effect/vitest";
import {
  MessageId,
  type MemoryLineRef,
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
import * as NodePath from "@effect/platform-node/NodePath";

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
    { repositoryId: MercurianRepositoryId.make("memory"), worktreePath: "/memory" },
  ],
} as unknown as import("@t3tools/contracts").OrchestrationThread;

interface PreparationOptions {
  readonly parentCommitId?: CommitId;
  readonly forkParentCommitId?: MercurianCommitId;
  readonly timeline: ReadonlyArray<Record<string, unknown>>;
  readonly ancestors: ReadonlyArray<Record<string, unknown>>;
  readonly memory?: {
    readonly rootPath: string;
    readonly subpath?: string;
    readonly readLines?: Array<MemoryLineRef>;
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

const reconstructionDependencies = Layer.mergeAll(
  NodeServices.layer,
  Layer.mock(ReconstructionStore)({
    save: () => Effect.void,
    prepare: () => Effect.void,
    current: () => Effect.succeed(null),
    finish: () => Effect.void,
  }),
  Layer.mock(ReconstructionSummary)({ summarize: () => Effect.succeed("Older history summary") }),
);

const preparationDependencies = (options: PreparationOptions) => {
  const runtime = {
    planId,
    ...(options.forkParentCommitId === undefined
      ? {}
      : { forkParentCommitId: options.forkParentCommitId }),
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
    prState: null,
    memoryMergedHomeAt: null,
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
          repositoryId: MercurianRepositoryId.make("repository"),
          repositoryName: "project-memory",
          repositoryPath: options.memory.rootPath,
          rootPath: options.memory.rootPath,
          subpath: options.memory.subpath ?? null,
          createdAt: now,
          updatedAt: now,
        });
  return Layer.mergeAll(
    Path.layer,
    Layer.mock(StorageSourceStore)({
      getSnapshot: Effect.succeed(
        Option.isSome(source) ? [{ ...source.value, kind: "memory" as const }] : [],
      ),
    }),
    Layer.mock(LineRuntimeStore.LineRuntimeStore)({
      getByThreadId: () => Effect.succeed(Option.some(runtime)),
    }),
    Layer.mock(PlanningStore.PlanningStore)({
      getPlanSnapshot: () =>
        Effect.succeed({
          plan: { planId, projectId: MercurianProjectId.make("project"), title: "Ship runtime" },
          timeline: options.timeline,
        } as never),
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
      readNote: (_projectId, name, line) => {
        if (line !== undefined) options.memory?.readLines?.push(line);
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
    NodePath.layer,
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
    const dependencies = Layer.mergeAll(
      Path.layer,
      Layer.mock(StorageSourceStore)({ getSnapshot: Effect.succeed([]) }),
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
              prState: null,
              memoryMergedHomeAt: null,
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
      }),
      Layer.mock(CommitStore.CommitStore)({
        getCommit: () => Effect.succeed(Option.some({ parents: [parentId] } as never)),
        ancestors: ({ commitId }) =>
          Effect.sync(() => {
            void commitId;
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
      NodePath.layer,
    );
    return Effect.gen(function* () {
      const preparation = yield* TurnPreparation;
      const fresh = yield* preparation.prepare({ thread, message, sessionIsFresh: true });
      const continued = yield* preparation.prepare({ thread, message, sessionIsFresh: false });
      assert.ok(fresh.text.includes("planning assistant"));
      assert.ok(fresh.text.includes("Earlier request"));
      assert.ok(fresh.text.includes("Build it"));

      assert.deepStrictEqual(fresh.session, { skipResume: true });
      assert.ok(continued.text.endsWith("Build it"));
      assert.ok(continued.text.includes("Plans location is not configured"));
      assert.deepStrictEqual(continued.session, {});
    }).pipe(
      Effect.provide(
        Layer.provide(
          MercurianTurnPreparationLive,
          Layer.merge(reconstructionDependencies, dependencies),
        ),
      ),
    );
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
    assert.deepStrictEqual(prepared.session, { skipResume: true });
  }).pipe(
    Effect.provide(
      Layer.provide(
        MercurianTurnPreparationLive,
        Layer.merge(reconstructionDependencies, dependencies),
      ),
    ),
  );
});

it.effect("grounds reachable memory and resolves note mentions on the first turn", () => {
  const root = CommitId.make("root");
  const readLines: Array<MemoryLineRef> = [];
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
      rootPath: "/designated-main/memory",
      subpath: "memory",
      readLines,
      notes: {
        Composer: { exists: true, path: "/tmp/repository/memory/Composer.md" },
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
    assert.ok(prepared.text.includes("- /tmp/repository/memory"));
    assert.ok(!prepared.text.includes("/designated-main/memory"));
    assert.ok(prepared.text.includes("Earlier request"));
    assert.ok(prepared.text.includes("- Composer: /tmp/repository/memory/Composer.md"));
    assert.ok(prepared.text.includes("- Future: not yet written — linked from Plans"));
    assert.ok(prepared.text.includes("Reply to this message:\nUse [[Composer]] and [[Future]]."));
    assert.deepStrictEqual(readLines, [{ threadId }, { threadId }]);
  }).pipe(
    Effect.provide(
      Layer.provide(
        MercurianTurnPreparationLive,
        Layer.merge(reconstructionDependencies, dependencies),
      ),
    ),
  );
});

it.effect(
  "preserves a legacy human spec revision marker without claiming current document contents",
  () => {
    const root = CommitId.make("root");
    const specRevision = CommitId.make("spec-revision");
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
      assert.ok(prepared.text.includes("Plans location is not configured"));
      assert.ok(!prepared.text.includes("The spec artifact"));
      assert.ok(!prepared.text.includes("The plan document"));
      assert.ok(prepared.text.includes("Reply to this message:\nWhat should change in the plan?"));
    }).pipe(
      Effect.provide(
        Layer.provide(
          MercurianTurnPreparationLive,
          Layer.merge(reconstructionDependencies, dependencies),
        ),
      ),
    );
  },
);

it.effect("grounds project documents in the line workspace on fresh and continued turns", () => {
  const dependencies = Layer.merge(
    preparationDependencies({ timeline: [], ancestors: [] }),
    Layer.mock(StorageSourceStore)({
      getSnapshot: Effect.succeed([
        {
          projectId: MercurianProjectId.make("project"),
          repositoryId: MercurianRepositoryId.make("repository"),
          kind: "plan",
          subpath: "plans",
          createdAt: now,
          updatedAt: now,
        },
        {
          projectId: MercurianProjectId.make("project"),
          repositoryId: MercurianRepositoryId.make("unreachable"),
          kind: "spec",
          subpath: "specs",
          createdAt: now,
          updatedAt: now,
        },
      ]),
    }),
  );
  return Effect.gen(function* () {
    const preparation = yield* TurnPreparation;
    for (const sessionIsFresh of [true, false]) {
      const prepared = yield* preparation.prepare({ thread, message, sessionIsFresh });
      assert.ok(prepared.text.includes("Plans directory: /tmp/repository/plans"));
      assert.ok(prepared.text.includes("Specs repository is unavailable on this line"));
      assert.ok(!prepared.text.includes("The plan document is currently empty"));
      assert.ok(!prepared.text.includes("The spec artifact does not exist yet"));
    }
  }).pipe(
    Effect.provide(
      Layer.provide(
        MercurianTurnPreparationLive,
        Layer.merge(reconstructionDependencies, dependencies),
      ),
    ),
  );
});

it.effect("keeps the next line turn resumable while resolving note mentions", () => {
  const readLines: Array<MemoryLineRef> = [];
  const dependencies = preparationDependencies({
    parentCommitId: CommitId.make("root"),
    timeline: [],
    ancestors: [],
    memory: {
      rootPath: "/memory",
      readLines,
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
    assert.ok(
      prepared.text.endsWith(
        "Consult [[Composer]].\n\n---\n\nMemory notes mentioned in this message:\n- Composer: /memory/Composer.md",
      ),
    );
    assert.deepStrictEqual(prepared.session, {});
    assert.deepStrictEqual(readLines, [{ threadId }]);
  }).pipe(
    Effect.provide(
      Layer.provide(
        MercurianTurnPreparationLive,
        Layer.merge(reconstructionDependencies, dependencies),
      ),
    ),
  );
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
    assert.ok(prepared.text.includes("recorded conversation"));
    assert.ok(prepared.text.includes("Reshape the sidebar"));
    assert.ok(prepared.text.includes("Selected answer"));
    assert.ok(!prepared.text.includes("Other answer"));
    assert.ok(prepared.text.includes("Reply to this message:\nTry another direction"));
  }).pipe(
    Effect.provide(
      Layer.provide(
        MercurianTurnPreparationLive,
        Layer.merge(reconstructionDependencies, dependencies),
      ),
    ),
  );
});

it.effect(
  "records exact summarized input at a later clean restart, including its selected parent",
  () => {
    const root = MercurianCommitId.make("root");
    const selected = MercurianCommitId.make("selected");
    const records: import("@t3tools/contracts").PlanReconstruction[] = [];
    const bindings: string[] = [];
    const summary = "\n The earlier decision was to preserve history. \n";
    const dependencies = Layer.mergeAll(
      preparationDependencies({
        parentCommitId: CommitId.make(selected),
        ancestors: [],
        timeline: [
          {
            _tag: "message",
            commitId: root,
            parents: [],
            authorKind: "human",
            text: "old".repeat(50_000),
          },
          {
            _tag: "message",
            commitId: selected,
            parents: [root],
            authorKind: "assistant",
            text: "The selected answer",
          },
        ],
      }),
      Layer.mock(ReconstructionStore)({
        save: (record) =>
          Effect.sync(() => {
            records.push(record);
          }),
        prepare: (_threadId, messageId, id) =>
          Effect.sync(() => {
            bindings.push(`${messageId}:${id}`);
          }),
        finish: () => Effect.void,
      }),
      Layer.mock(ReconstructionSummary)({
        summarize: (text) =>
          Effect.sync(() => {
            assert.ok(text.includes("The selected answer"));
            return summary;
          }),
      }),
    );
    return Effect.gen(function* () {
      const prepared = yield* (yield* TurnPreparation).prepare({
        thread: { ...thread, messages: [message, message, message] },
        message,
        sessionIsFresh: true,
        contextDisposition: "clean-start",
      });
      const record = records[0]!;
      assert.strictEqual(record.compacted?.summary, summary);
      assert.strictEqual(record.compacted?.throughCommitId, selected);
      assert.strictEqual(record.throughCommitId, selected);
      assert.strictEqual(String(record.verbatimFromCommitId), String(message.id));
      assert.ok(prepared.text.includes(summary));
      assert.deepStrictEqual(bindings, [`${message.id}:${record.id}`]);
      assert.ok(prepared.onSubmitted);
    }).pipe(
      Effect.provide(
        Layer.provide(
          MercurianTurnPreparationLive,
          Layer.merge(reconstructionDependencies, dependencies),
        ),
      ),
    );
  },
);

it.effect(
  "a genuine resume inherits known provenance without reconstructing or summarizing",
  () => {
    const bound: string[] = [];
    const dependencies = Layer.merge(
      preparationDependencies({ timeline: [], ancestors: [] }),
      Layer.mock(ReconstructionStore)({
        current: () => Effect.succeed("known"),
        prepare: (_thread, _message, id) =>
          Effect.sync(() => {
            bound.push(id);
          }),
        finish: () => Effect.void,
      }),
    );
    return Effect.gen(function* () {
      const prepared = yield* (yield* TurnPreparation).prepare({
        thread,
        message,
        sessionIsFresh: true,
        contextDisposition: "resume",
      });
      assert.ok(prepared.text.endsWith(message.text));
      assert.ok(prepared.text.includes("Plans location is not configured"));
      assert.deepStrictEqual(prepared.session, {});
      assert.deepStrictEqual(bound, ["known"]);
    }).pipe(
      Effect.provide(
        Layer.provide(
          MercurianTurnPreparationLive,
          Layer.merge(reconstructionDependencies, dependencies),
        ),
      ),
    );
  },
);

it.effect(
  "refuses oversized mandatory artifacts before making a summary or saving evidence",
  () => {
    const parent = CommitId.make("root");
    const dependencies = Layer.mergeAll(
      preparationDependencies({
        parentCommitId: parent,
        planText: "x".repeat(130_000),
        ancestors: [],
        timeline: [
          {
            _tag: "message",
            commitId: parent,
            parents: [],
            authorKind: "human",
            text: "Earlier question",
          },
        ],
      }),
      Layer.mock(ReconstructionStore)({ save: () => Effect.die("Must not record unsent context") }),
      Layer.mock(ReconstructionSummary)({
        summarize: () => Effect.die("Must reject before summarizing"),
      }),
    );
    return Effect.gen(function* () {
      const result = yield* Effect.result(
        (yield* TurnPreparation).prepare({ thread, message, sessionIsFresh: true }),
      );
      assert.strictEqual(result._tag, "Failure");
    }).pipe(
      Effect.provide(
        Layer.provide(
          MercurianTurnPreparationLive,
          Layer.merge(reconstructionDependencies, dependencies),
        ),
      ),
    );
  },
);

it.effect("native resume leaves unknown legacy provenance unknown", () => {
  const dependencies = Layer.mergeAll(
    preparationDependencies({ timeline: [], ancestors: [] }),
    Layer.mock(ReconstructionStore)({ current: () => Effect.succeed(null) }),
    Layer.mock(ReconstructionSummary)({}),
  );
  return Effect.gen(function* () {
    const prepared = yield* (yield* TurnPreparation).prepare({
      thread,
      message,
      sessionIsFresh: true,
      contextDisposition: "resume",
    });
    assert.deepStrictEqual(prepared, { text: message.text, session: {} });
  }).pipe(
    Effect.provide(
      MercurianTurnPreparationLive.pipe(
        Layer.provide(Layer.merge(reconstructionDependencies, dependencies)),
      ),
    ),
  );
});

it.effect(
  "a genuine fork ignores inherited native context and records its own reconstruction",
  () => {
    const parent = MercurianCommitId.make("fork-parent");
    const dependencies = preparationDependencies({
      forkParentCommitId: parent,
      timeline: [
        {
          _tag: "message",
          commitId: parent,
          parents: [],
          authorKind: "assistant",
          text: "Selected ancestor",
        },
      ],
      ancestors: [],
    });
    return Effect.gen(function* () {
      const prepared = yield* (yield* TurnPreparation).prepare({
        thread,
        message,
        sessionIsFresh: true,
        contextDisposition: "resume",
      });
      assert.ok(prepared.text.includes("Selected ancestor"));
      assert.deepStrictEqual(prepared.session, { skipResume: true });
      assert.ok(prepared.onSubmitted);
    }).pipe(
      Effect.provide(
        MercurianTurnPreparationLive.pipe(
          Layer.provide(Layer.merge(reconstructionDependencies, dependencies)),
        ),
      ),
    );
  },
);

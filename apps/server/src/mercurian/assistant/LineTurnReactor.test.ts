import * as NodeCrypto from "node:crypto";
import * as FileSystem from "effect/FileSystem";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { ServerConfig } from "../../config.ts";
import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { LineBranchStore } from "../commitTree/LineBranchStore.ts";
import { make as makeSnapshotChain } from "../worktreeSlots/SnapshotChain.ts";
import { makeMemoryPosition, type MemoryLineContext } from "../memory/MemoryPosition.ts";
import { TurnId, type OrchestrationCheckpointSummary } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  MessageId,
  PlanId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as OrchestrationEngine from "../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadDeletionReactor from "../../orchestration/Services/ThreadDeletionReactor.ts";
import * as ProviderRegistry from "../../provider/Services/ProviderRegistry.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import * as LineRuntimeStore from "../lineRuntimes/LineRuntimeStore.ts";
import * as LegacySessionStore from "../lineRuntimes/LegacySessionStore.ts";
import type { LineRuntimeRecord } from "../lineRuntimes/schema.ts";
import * as MemoryIndex from "../memory/MemoryIndex.ts";
import * as PlanningStore from "../planning/PlanningStore.ts";
import * as PlanTurnRegistry from "../planning/PlanTurnRegistry.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as SlotRegistry from "../worktreeSlots/SlotRegistry.ts";
import * as SlotService from "../worktreeSlots/SlotService.ts";
import * as SlotStore from "../worktreeSlots/SlotStore.ts";
import { CommitId, HistoryId } from "../commitTree/schema.ts";
import { LineTurnReactor, layer } from "./LineTurnReactor.ts";

const now = "2026-09-04T12:00:00.000Z";
const planId = PlanId.make("plan-line-turn");
const mercurianProjectId = MercurianProjectId.make("mercurian-project");
const orchestrationProjectId = ProjectId.make("orchestration-project");
const threadId = ThreadId.make("line-thread");
const rootId = CommitId.make("root");
const messageId = MessageId.make("human-message");
const instanceId = ProviderInstanceId.make("codex");

const baseEvent = {
  sequence: 1,
  eventId: EventId.make("event"),
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: now,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
} as const;

const turnStarted = (): OrchestrationEvent =>
  ({
    ...baseEvent,
    type: "thread.turn-start-requested",
    payload: {
      threadId,
      messageId,
      modelSelection: { instanceId, model: "gpt-5.6" },
      runtimeMode: "approval-required",
      createdAt: now,
    },
  }) as OrchestrationEvent;

let providerEventSequence = 0;
const runtimeEvent = (event: object): ProviderRuntimeEvent =>
  ({
    eventId: EventId.make(`provider-${providerEventSequence++}`),
    provider: "codex",
    threadId,
    createdAt: now,
    ...event,
  }) as ProviderRuntimeEvent;

interface HarnessState {
  runtime: LineRuntimeRecord | null;
  readonly timeline: Array<Record<string, unknown>>;
  readonly humanCommits: Array<PlanningStore.AppendMessageInput>;
  readonly assistantCommits: Array<PlanningStore.AppendAssistantMessageInput>;
  createdPlans: number;
  rootCalls: number;
  planTitle: string;
}

const makeHarness = (options?: {
  readonly persistReplies?: boolean;
  readonly upstream?: boolean;
  readonly pending?: boolean;
  readonly forkParent?: CommitId;
  readonly unreachableRepositories?: ReadonlyArray<string>;
  readonly memoryLandingFailure?: MemoryIndex.MemoryAmendmentValidationError;
}) =>
  Effect.gen(function* () {
    const domain = yield* PubSub.unbounded<OrchestrationEvent>();
    const provider = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const humanReceipts = yield* Queue.unbounded<PlanningStore.AppendMessageInput>();
    const assistantReceipts = yield* Queue.unbounded<PlanningStore.AppendAssistantMessageInput>();
    const birthReceipts = yield* Queue.unbounded<void>();
    const runtimeReads = yield* Queue.unbounded<void>();
    const memoryLandings =
      yield* Queue.unbounded<Parameters<MemoryIndex.MemoryIndex["Service"]["landAmendment"]>[0]>();
    const root = options?.forkParent ?? rootId;
    const state: HarnessState = {
      runtime:
        options?.upstream === true
          ? null
          : ({
              planId,
              lineRootCommitId: options?.pending === true ? null : MercurianCommitId.make(root),
              ...(options?.forkParent === undefined
                ? {}
                : { forkParentCommitId: MercurianCommitId.make(options.forkParent) }),
              threadId,
              homeRepositoryId: MercurianRepositoryId.make("repository"),
              branch: "mercurian/line",
              worktreePath: "/repo",
              unreachableRepositories: [...(options?.unreachableRepositories ?? [])],
              snapshotOid: null,
              snapshotKind: null,
              departedRef: null,
              branchMovement: null,
              lineBranchMissingOid: null,
              createdAt: DateTime.makeUnsafe(now),
              updatedAt: DateTime.makeUnsafe(now),
              repositories: [],
            } satisfies LineRuntimeRecord),
      timeline:
        options?.pending === true
          ? []
          : [
              {
                _tag: "message",
                commitId: MercurianCommitId.make(root),
                parents: [],
                sequence: 1,
                authorKind: "human",
                text: "Ancestor",
                createdAt: DateTime.makeUnsafe(now),
              },
            ],
      humanCommits: [],
      assistantCommits: [],
      createdPlans: 0,
      rootCalls: 0,
      planTitle: "Line turn",
    };
    const detail = () =>
      ({
        plan: {
          planId,
          projectId: mercurianProjectId,
          historyId: HistoryId.make("history"),
          title: state.planTitle,
          archivedAt: null,
          createdAt: DateTime.makeUnsafe(now),
          updatedAt: DateTime.makeUnsafe(now),
        },
        timeline: state.timeline,
        planText: "",
        spec: null,
        codingSessions: [],
        lineRuntimes: state.runtime === null ? [] : [state.runtime],
        inFlightTurns: [],
        snapshotSequence: 0,
      }) as never;
    const dependencies = Layer.mergeAll(
      Layer.mock(PlanningStore.PlanningStore)({
        getProjectByOrchestrationProjectId: () =>
          Effect.succeed(
            options?.upstream === true
              ? Option.none()
              : Option.some({ projectId: mercurianProjectId } as never),
          ),
        createPlanFromThread: () =>
          Effect.sync(() => {
            state.createdPlans += 1;
            return detail();
          }).pipe(Effect.tap(() => Queue.offer(birthReceipts, undefined))),
        renamePlan: (input) => Effect.sync(() => void (state.planTitle = input.title)),
        getPlanSnapshot: () => Effect.succeed(detail()),
        appendMessage: (input) =>
          Effect.sync(() => {
            state.humanCommits.push(input);
            const commitId = input.commitId ?? CommitId.make("minted-human");
            state.timeline.push({
              _tag: "message",
              commitId: MercurianCommitId.make(commitId),
              parents:
                input.parentCommitId === undefined
                  ? []
                  : [MercurianCommitId.make(input.parentCommitId)],
              sequence: state.timeline.length + 1,
              authorKind: "human",
              text: input.text,
              createdAt: input.createdAt,
            });
            return { commitId, ranUnder: input.ranUnder } as never;
          }).pipe(Effect.tap(() => Queue.offer(humanReceipts, state.humanCommits.at(-1)!))),
        appendAssistantMessage: (input) =>
          Effect.sync(() => {
            state.assistantCommits.push(input);
            const commitId = CommitId.make(
              options?.persistReplies ? NodeCrypto.randomUUID() : "assistant",
            );
            if (options?.persistReplies)
              state.timeline.push({
                _tag: "message",
                ...input,
                commitId,
                authorKind: "assistant",
                parents: [input.parentCommitId],
                sequence: state.timeline.length + 1,
              });
            return { commitId } as never;
          }).pipe(Effect.tap(() => Queue.offer(assistantReceipts, input))),
        saveAssistantPlanRevision: () =>
          Effect.succeed({ commitId: CommitId.make("plan-revision") } as never),
        saveAssistantSpecRevision: () =>
          Effect.succeed({ commitId: CommitId.make("spec-revision") } as never),
        getPlanTextAt: () => Effect.succeed(""),
        getSpecAt: () => Effect.succeed(null),
      }),
      Layer.mock(LineRuntimeStore.LineRuntimeStore)({
        getByThreadId: () =>
          Queue.offer(runtimeReads, undefined).pipe(
            Effect.as(state.runtime === null ? Option.none() : Option.some(state.runtime)),
          ),
        create: (input) =>
          Effect.sync(() => {
            state.runtime = {
              ...input,
              snapshotOid: null,
              snapshotKind: null,
              departedRef: null,
              branchMovement: null,
              lineBranchMissingOid: null,
              updatedAt: input.createdAt,
            };
          }),
        rootPending: (_threadId, lineRootCommitId) =>
          Effect.sync(() => {
            state.rootCalls += 1;
            if (state.runtime !== null) {
              const { forkParentCommitId: _forkParentCommitId, ...record } = state.runtime;
              state.runtime = { ...record, lineRootCommitId };
            }
          }),
        deleteByThread: () => Effect.sync(() => void (state.runtime = null)),
        listByPlan: () => Effect.succeed(state.runtime === null ? [] : [state.runtime]),
      }),
      Layer.mock(CommitStore.CommitStore)({
        getCommit: ({ commitId }) => {
          const exists = state.timeline.some(
            (item) => item.commitId === MercurianCommitId.make(commitId),
          );
          return Effect.succeed(
            exists ? Option.some({ commitId, parents: [], payload: {} } as never) : Option.none(),
          );
        },
      }),
      Layer.mock(LegacySessionStore.LegacySessionStore)({
        getByThreadId: () => Effect.succeed(Option.none()),
      }),
      Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
        getThreadDetailById: () =>
          Effect.succeed(
            Option.some({
              id: threadId,
              modelSelection: { instanceId, model: "gpt-5.6" },
              messages: [
                {
                  id: messageId,
                  text: "Build it",
                  attachments: [],
                },
              ],
            } as never),
          ),
      }),
      Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
        streamDomainEvents: Stream.fromPubSub(domain),
        latestSequence: Effect.succeed(0),
        dispatch: () => Effect.succeed({ sequence: 1 }),
      }),
      Layer.mock(ProviderService.ProviderService)({
        streamEvents: Stream.fromPubSub(provider),
        getCapabilities: () =>
          Effect.succeed({ sessionModelSwitch: "in-session", groundingRoots: "multi" }),
      }),
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed([
          { instanceId, driver: "codex", models: [], status: "ready" } as never,
        ]),
      }),
      Layer.mock(RepositoryStore.RepositoryStore)({
        getWorkingSnapshot: Effect.succeed({
          repositories: [
            {
              repositoryId: MercurianRepositoryId.make("repository"),
              name: "server",
              path: "/repo",
              scripts: [],
              hasGit: true,
            },
          ],
          projectRepositories: [
            {
              projectId: mercurianProjectId,
              repositoryId: MercurianRepositoryId.make("repository"),
            },
          ],
        } as never),
      }),
      Layer.mock(MemoryIndex.MemoryIndex)({
        landAmendment: (input) =>
          Queue.offer(memoryLandings, input).pipe(
            Effect.andThen(
              options?.memoryLandingFailure === undefined
                ? Effect.succeed({
                    memoryCommitSha: "memory-commit",
                    branch: "mercurian/memory",
                  })
                : Effect.fail(options.memoryLandingFailure),
            ),
          ),
      }),
      Layer.mock(SlotStore.SlotStore)({ listAll: Effect.succeed([]) }),
      Layer.mock(SlotRegistry.SlotRegistry)({ lease: () => Effect.succeed(Option.none()) }),
      Layer.mock(SlotService.SlotService)({ release: () => Effect.succeed(false) }),
      Layer.mock(ThreadDeletionReactor.ThreadDeletionReactor)({ drainThrough: () => Effect.void }),
      PlanTurnRegistry.layer,
      NodeServices.layer,
    );
    return {
      state,
      layer: layer.pipe(Layer.provide(dependencies)),
      publishDomain: (event: OrchestrationEvent) => PubSub.publish(domain, event),
      publishProvider: (event: ProviderRuntimeEvent) => PubSub.publish(provider, event),
      humanReceipts,
      assistantReceipts,
      birthReceipts,
      runtimeReads,
      memoryLandings,
    };
  });

const startTurn = (
  harness: Effect.Success<ReturnType<typeof makeHarness>>,
  reactor: LineTurnReactor["Service"],
) =>
  Effect.gen(function* () {
    yield* reactor.recordSend({
      threadId,
      messageId,
      text: "Build it",
      attachments: [],
      modelSelection: { instanceId, model: "gpt-5.6" },
      createdAt: now,
    });
    const input = yield* Queue.take(harness.humanReceipts);
    yield* harness.publishDomain(turnStarted());
    yield* reactor.drainThrough(turnStarted().sequence);
    return input;
  });

describe("LineTurnReactor", () => {
  for (const fork of [false, true])
    it.effect(
      `resolves ${fork ? "fork" : "first-line"} settled reply IDs through captures, followups and interruption`,
      () =>
        Effect.gen(function* () {
          const harness = yield* makeHarness({
            pending: true,
            ...(fork ? { forkParent: rootId } : {}),
            persistReplies: true,
          });
          if (fork)
            harness.state.timeline.push(
              { _tag: "message", commitId: rootId, parents: [], sequence: 1, authorKind: "human" },
              {
                _tag: "message",
                commitId: CommitId.make("original-line-reply"),
                parents: [rootId],
                sequence: 2,
                authorKind: "assistant",
              },
            );
          yield* Effect.gen(function* () {
            const reactor = yield* LineTurnReactor;
            const git = yield* GitVcsDriver.GitVcsDriver;
            const fs = yield* FileSystem.FileSystem;
            const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "line-memory-integration-" });
            const run = Effect.fn(function* (args: readonly string[]) {
              return (yield* git.execute({ cwd, args, operation: "test" })).stdout.trim();
            });
            yield* run(["init", "-b", "main"]);
            yield* run(["config", "user.name", "Memory Test"]);
            yield* run(["config", "user.email", "memory@example.com"]);
            yield* fs.writeFileString(`${cwd}/Base.md`, "baseline\n");
            yield* run(["add", "."]);
            yield* run(["commit", "-m", "base"]);
            const baseOid = yield* run(["rev-parse", "HEAD"]);
            yield* run(["checkout", "-b", "memory-line"]);
            const repositoryId = MercurianRepositoryId.make("repository");
            const lineRootCommitId = MercurianCommitId.make(messageId);
            const branch = {
              repositoryId,
              lineRootCommitId,
              branch: "memory-line",
              baseOid,
              built: true,
              repointHold: null,
              createdAt: DateTime.makeUnsafe(now),
            };
            const driver = yield* GitVcsDriver.makeVcsDriverShape();
            const chain = yield* makeSnapshotChain.pipe(
              Effect.provideService(
                CheckpointStore,
                CheckpointStore.of({
                  ...driver.checkpoints,
                  isGitRepository: () => Effect.succeed(true),
                }),
              ),
              Effect.provide(
                Layer.mergeAll(
                  Layer.mock(LineBranchStore)({ get: () => Effect.succeed(Option.some(branch)) }),
                  Layer.mock(SlotStore.SlotStore)({ listAll: Effect.succeed([]) }),
                ),
              ),
            );
            const checkpoints: OrchestrationCheckpointSummary[] = [];
            const positions = yield* makeMemoryPosition.pipe(
              Effect.provide(
                Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
                  getThreadCheckpointContext: () =>
                    Effect.succeed(
                      Option.some({
                        threadId,
                        projectId: orchestrationProjectId,
                        workspaceRoot: cwd,
                        worktreePath: cwd,
                        checkpoints,
                      }),
                    ),
                }),
              ),
            );
            const context = (): MemoryLineContext => ({
              planId,
              lineRootCommitId,
              branch,
              source: {
                projectId: mercurianProjectId,
                repositoryId,
                repositoryName: "memory",
                repositoryPath: cwd,
                rootPath: cwd,
                subpath: null,
                createdAt: DateTime.makeUnsafe(now),
                updatedAt: DateTime.makeUnsafe(now),
              },
              detail: {
                plan: { planId, projectId: mercurianProjectId },
                timeline: harness.state.timeline,
                codingSessions: [],
                lineRuntimes: [harness.state.runtime],
              } as unknown as MemoryLineContext["detail"],
            });
            const replies: string[] = [];
            for (let turn = 1; turn <= 3; turn++) {
              const user = turn === 1 ? messageId : MessageId.make(`followup-${turn}`);
              yield* reactor.recordSend({
                threadId,
                messageId: user,
                text: `Turn ${turn}`,
                attachments: [],
                createdAt: now,
              });
              const event = turnStarted();
              yield* harness.publishDomain({
                ...event,
                sequence: turn,
                payload: { ...event.payload, messageId: user },
              } as OrchestrationEvent);
              yield* reactor.drainThrough(turn);
              yield* fs.writeFileString(`${cwd}/Turn-${turn}.md`, `captured ${turn}\n`);
              yield* harness.publishProvider(
                runtimeEvent({
                  type: "turn.completed",
                  payload: { state: turn === 3 ? "interrupted" : "completed" },
                }),
              );
              const settled = yield* Queue.take(harness.assistantReceipts);
              assert.strictEqual(settled.sourceUserMessageId, CommitId.make(user));
              const reply = harness.state.timeline.at(-1)!;
              replies.push(String(reply.commitId));
              const reading = {
                kind: "checkpoint" as const,
                commitId: MercurianCommitId.make(String(reply.commitId)),
              };
              // The provider's settle can precede the checkpoint receipt. Never show a false baseline.
              assert.deepStrictEqual(yield* positions.read(context(), reading), {
                kind: "unavailable",
                reason: "checkpoint-missing",
              });
              const ref = checkpointRefForThreadTurn(threadId, turn);
              const capture = yield* chain.capture({
                cwd,
                lineRootCommitId,
                repositoryId,
                lineBranch: "memory-line",
                kind: "settled",
                ref,
              });
              const providerAssistantId = MessageId.make(`assistant:runtime-turn-${turn}`);
              assert.notStrictEqual(providerAssistantId, reply.commitId);
              checkpoints.push({
                userMessageId: user,
                assistantMessageId: providerAssistantId,
                turnId: TurnId.make(`runtime-turn-${turn}`),
                checkpointTurnCount: turn,
                checkpointRef: ref,
                status: "ready",
                files: [],
                completedAt: now,
              });
              const selected = yield* positions.read(context(), reading);
              assert(!("kind" in selected));
              assert.strictEqual(selected.snapshotOid, capture.oid);
              assert.strictEqual(
                yield* run(["show", `${selected.treeOid}:Turn-${turn}.md`]),
                `captured ${turn}`,
              );
              // Existing unified records use the persisted human parent rather than equal assistant IDs.
              delete reply.sourceUserMessageId;
              assert.deepStrictEqual(yield* positions.read(context(), reading), selected);
            }
            const first = yield* positions.read(context(), {
              kind: "checkpoint",
              commitId: MercurianCommitId.make(replies[0]!),
            });
            assert(!("kind" in first));
            assert.notInclude(
              yield* run(["ls-tree", "-r", "--name-only", first.treeOid]),
              "Turn-3.md",
            );
            const last = harness.state.timeline.at(-1)!;
            assert.strictEqual(last.interrupted, true);
            // A non-capture descendant inherits the preceding exact checkpoint.
            harness.state.timeline.push({
              _tag: "plan-revision",
              commitId: CommitId.make("no-capture"),
              parents: [last.commitId],
              sequence: harness.state.timeline.length + 1,
            });
            const inherited = yield* positions.read(context(), {
              kind: "checkpoint",
              commitId: MercurianCommitId.make("no-capture"),
            });
            assert(!("kind" in inherited));
            assert.strictEqual(
              yield* run(["show", `${inherited.treeOid}:Turn-3.md`]),
              "captured 3",
            );
            checkpoints[2] = { ...checkpoints[2]!, userMessageId: MessageId.make("unknown-send") };
            assert.deepStrictEqual(
              yield* positions.read(context(), {
                kind: "checkpoint",
                commitId: MercurianCommitId.make(replies[2]!),
              }),
              { kind: "unavailable", reason: "checkpoint-missing" },
            );
          }).pipe(
            Effect.scoped,
            Effect.provide(
              Layer.mergeAll(
                harness.layer,
                GitVcsDriver.layer.pipe(
                  Layer.provide(
                    ServerConfig.layerTest(process.cwd(), { prefix: "line-memory-integration-" }),
                  ),
                  Layer.provideMerge(VcsProcess.layer),
                  Layer.provideMerge(NodeServices.layer),
                ),
              ),
            ),
          );
        }),
    );

  it.effect("thread.created births a plan and pending line runtime", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ pending: true });
      harness.state.runtime = null;
      yield* Effect.gen(function* () {
        yield* LineTurnReactor;
        yield* harness.publishDomain({
          ...baseEvent,
          type: "thread.created",
          payload: {
            threadId,
            projectId: orchestrationProjectId,
            title: "New line",
            modelSelection: { instanceId, model: "gpt-5.6" },
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: now,
          },
        } as OrchestrationEvent);
        yield* Queue.take(harness.birthReceipts);
        assert.strictEqual(harness.state.createdPlans, 1);
        assert.strictEqual(harness.state.runtime?.lineRootCommitId, null);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("keeps the plan title synchronized with its line thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* harness.publishDomain({
          ...baseEvent,
          sequence: 2,
          type: "thread.meta-updated",
          payload: { threadId, title: "Renamed thread", updatedAt: now },
        } as OrchestrationEvent);
        yield* reactor.drainThrough(2);
        assert.strictEqual(harness.state.planTitle, "Renamed thread");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("recordSend appends the message id on the fork parent and roots the line", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ pending: true, forkParent: rootId });
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* reactor.recordSend({
          threadId,
          messageId,
          text: "Build it",
          attachments: [],
          modelSelection: { instanceId, model: "gpt-5.6" },
          createdAt: now,
        });
        const input = yield* Queue.take(harness.humanReceipts);
        assert.strictEqual(input.commitId, CommitId.make(messageId));
        assert.strictEqual(input.parentCommitId, rootId);
        assert.strictEqual(input.ranUnder?.provider, "codex");
        assert.strictEqual(input.ranUnder?.model, "gpt-5.6");
        assert.strictEqual(
          harness.state.runtime?.lineRootCommitId,
          MercurianCommitId.make(messageId),
        );
        assert.strictEqual(harness.state.runtime?.forkParentCommitId, undefined);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("a second recordSend with the same message id records nothing", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ pending: true });
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        const input = {
          threadId,
          messageId,
          text: "Build it",
          attachments: [],
          modelSelection: { instanceId, model: "gpt-5.6" },
          createdAt: now,
        } as const;
        yield* reactor.recordSend(input);
        yield* reactor.recordSend(input);
        assert.strictEqual(harness.state.humanCommits.length, 1);
        assert.strictEqual(harness.state.rootCalls, 1);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("turn-start-requested opens a turn from the pre-recorded commit", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* startTurn(harness, reactor);
        const [turn] = yield* reactor.inFlightTurns(planId);
        assert.strictEqual(turn?.parentCommitId, MercurianCommitId.make(messageId));
        assert.strictEqual(harness.state.humanCommits.length, 1);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("streams a reply and settles it as the assistant's commit", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* startTurn(harness, reactor);
        yield* harness.publishProvider(
          runtimeEvent({
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "Done" },
          }),
        );
        yield* harness.publishProvider(
          runtimeEvent({ type: "turn.completed", payload: { state: "completed" } }),
        );
        const settled = yield* Queue.take(harness.assistantReceipts);
        assert.strictEqual(settled.parentCommitId, CommitId.make(messageId));
        assert.strictEqual(settled.text, "Done");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("a question pauses the turn on the person, and the answer is recorded", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* startTurn(harness, reactor);
        yield* harness.publishProvider(
          runtimeEvent({
            type: "user-input.requested",
            payload: {
              questions: [
                {
                  id: "choice",
                  header: "Choose",
                  question: "Which?",
                  options: [{ label: "A", description: "A" }],
                },
              ],
            },
          }),
        );
        yield* harness.publishProvider(
          runtimeEvent({ type: "user-input.resolved", payload: { answers: { choice: "A" } } }),
        );
        yield* harness.publishProvider(
          runtimeEvent({ type: "turn.completed", payload: { state: "completed" } }),
        );
        const settled = yield* Queue.take(harness.assistantReceipts);
        assert.deepStrictEqual(settled.question?.answers, { choice: "A" });
        assert.strictEqual(settled.question?.questions[0]?.id, "choice");
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("folds command and edit activity into the settled reply", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* startTurn(harness, reactor);
        yield* harness.publishProvider(
          runtimeEvent({
            type: "item.started",
            itemId: "command",
            payload: { itemType: "command_execution", title: "pnpm test" },
          }),
        );
        yield* harness.publishProvider(
          runtimeEvent({
            type: "item.started",
            itemId: "edit",
            payload: { itemType: "file_change", title: "src/index.ts" },
          }),
        );
        yield* harness.publishProvider(
          runtimeEvent({ type: "turn.completed", payload: { state: "completed" } }),
        );
        const settled = yield* Queue.take(harness.assistantReceipts);
        assert.deepStrictEqual(
          settled.grounding?.map(({ kind }) => kind),
          ["command", "edit"],
        );
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("lands a memory amendment directly under the active line turn", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* startTurn(harness, reactor);
        yield* reactor.proposeMemoryAmendmentFromThread({
          threadId,
          title: "Memory",
          notes: [{ name: "Line runtime", markdown: "# Line runtime" }],
          placements: [],
        });
        const landing = yield* Queue.take(harness.memoryLandings);
        const [turn] = yield* reactor.inFlightTurns(planId);
        assert.isDefined(turn);
        assert.strictEqual(landing.projectId, mercurianProjectId);
        assert.strictEqual(landing.threadId, threadId);
        assert.strictEqual(landing.turnId, turn?.turnId);
        assert.deepStrictEqual(landing.amendment, {
          title: "Memory",
          notes: [{ name: "Line runtime", markdown: "# Line runtime" }],
          placements: [],
        });
        yield* harness.publishProvider(
          runtimeEvent({ type: "turn.completed", payload: { state: "completed" } }),
        );
        yield* Queue.take(harness.assistantReceipts);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("returns a direct landing refusal without losing the real turn claim", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        memoryLandingFailure: new MemoryIndex.MemoryAmendmentValidationError({
          reason: "memory-changed",
        }),
      });
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* startTurn(harness, reactor);
        const refusal = yield* Effect.flip(
          reactor.proposeMemoryAmendmentFromThread({
            threadId,
            title: "Memory",
            notes: [{ name: "Line runtime", markdown: "# Line runtime" }],
            placements: [],
          }),
        );
        assert.strictEqual(refusal._tag, "MemoryAmendmentValidationError");
        if (refusal._tag === "MemoryAmendmentValidationError") {
          assert.strictEqual(refusal.reason, "memory-changed");
        }
        const landing = yield* Queue.take(harness.memoryLandings);
        const [turn] = yield* reactor.inFlightTurns(planId);
        assert.isDefined(turn);
        assert.strictEqual(landing.turnId, turn?.turnId);

        yield* harness.publishProvider(
          runtimeEvent({ type: "turn.completed", payload: { state: "completed" } }),
        );
        yield* Queue.take(harness.assistantReceipts);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("narrows visibly for a cwd-only provider", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ unreachableRepositories: ["web"] });
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* startTurn(harness, reactor);
        const [turn] = yield* reactor.inFlightTurns(planId);
        assert.deepStrictEqual(turn?.groundingScope, { unreachableRepositories: ["web"] });
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("stopping lands the partial as a commit marked interrupted", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* startTurn(harness, reactor);
        yield* harness.publishProvider(
          runtimeEvent({
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "Partial" },
          }),
        );
        yield* harness.publishProvider(
          runtimeEvent({ type: "turn.aborted", payload: { reason: "interrupted" } }),
        );
        const settled = yield* Queue.take(harness.assistantReceipts);
        assert.strictEqual(settled.text, "Partial");
        assert.strictEqual(settled.interrupted, true);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("an interrupt force-settles after the grace window", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const reactor = yield* LineTurnReactor;
        yield* startTurn(harness, reactor);
        yield* harness.publishProvider(
          runtimeEvent({
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "Partial" },
          }),
        );
        yield* harness.publishDomain({
          ...baseEvent,
          sequence: 2,
          type: "thread.turn-interrupt-requested",
          payload: { threadId, createdAt: now },
        } as OrchestrationEvent);
        yield* TestClock.adjust("5 seconds");
        const settled = yield* Queue.take(harness.assistantReceipts);
        assert.strictEqual(settled.text, "Partial");
        assert.strictEqual(settled.interrupted, true);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );

  it.effect("upstream project threads produce no commits", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ upstream: true });
      yield* Effect.gen(function* () {
        yield* LineTurnReactor;
        yield* harness.publishDomain(turnStarted());
        yield* harness.publishDomain({
          ...baseEvent,
          sequence: 2,
          type: "thread.deleted",
          payload: { threadId, deletedAt: now },
        } as OrchestrationEvent);
        yield* Queue.take(harness.runtimeReads);
        yield* Queue.take(harness.runtimeReads);
        assert.deepStrictEqual(harness.state.humanCommits, []);
        assert.deepStrictEqual(harness.state.assistantCommits, []);
      }).pipe(Effect.scoped, Effect.provide(harness.layer));
    }),
  );
});

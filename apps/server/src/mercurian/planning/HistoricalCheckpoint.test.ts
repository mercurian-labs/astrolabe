// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CheckpointRef,
  MercurianCommitId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThread,
  type PlanReconstruction,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Config from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Git from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { CheckpointStore } from "../../checkpointing/CheckpointStore.ts";
import * as CheckpointDiff from "../../checkpointing/CheckpointDiffQuery.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../../orchestration/Services/ThreadDeletionReactor.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { TerminalManager } from "../../terminal/Manager.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import { CommitId } from "../commitTree/schema.ts";
import * as LineBranches from "../commitTree/LineBranchStore.ts";
import * as BranchReactor from "../commitTree/LineBranchReactor.ts";
import * as Runtimes from "../lineRuntimes/LineRuntimeStore.ts";
import * as RuntimeService from "../lineRuntimes/LineRuntimeService.ts";
import * as LegacySessions from "../lineRuntimes/LegacySessionStore.ts";
import type { RepositoryView } from "../repositories/schema.ts";
import * as Repositories from "../repositories/RepositoryStore.ts";
import * as Slots from "../worktreeSlots/SlotStore.ts";
import * as SlotRegistry from "../worktreeSlots/SlotRegistry.ts";
import * as SlotService from "../worktreeSlots/SlotService.ts";
import * as Snapshots from "../worktreeSlots/SnapshotChain.ts";
import * as LineTurn from "../assistant/LineTurnReactor.ts";
import * as Preparation from "../assistant/MercurianTurnPreparation.ts";
import { ReconstructionStore } from "../assistant/ReconstructionStore.ts";
import { ReconstructionSummary } from "../assistant/ReconstructionSummary.ts";
import { MemoryIndex } from "../memory/MemoryIndex.ts";
import { MemorySourceStore } from "../memory/MemorySourceStore.ts";
import * as Planning from "./PlanningStore.ts";
import * as TurnRegistry from "./PlanTurnRegistry.ts";
import * as Records from "./CheckpointRecordStore.ts";
import { checkpointForkParent } from "./checkpointTargets.ts";

const runGit = (cwd: string, args: string[]) =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const now = DateTime.makeUnsafe("2026-09-05T00:00:00Z");
const iso = DateTime.formatIso(now);
const originalThread = ThreadId.make("original");
const orchestrationProject = ProjectId.make("orchestration-project");
const instanceId = ProviderInstanceId.make("codex");

const persistence = Planning.layer.pipe(
  Layer.provideMerge(LegacySessions.layer),
  Layer.provideMerge(Runtimes.layer),
  Layer.provideMerge(Repositories.layer),
  Layer.provideMerge(TurnRegistry.layer),
  Layer.provideMerge(CommitStore.layer),
  Layer.provideMerge(LineBranches.layer),
  Layer.provideMerge(Slots.layer),
  Layer.provideMerge(Sqlite.layerMemory),
);
const checkpointLayer = Layer.effect(
  CheckpointStore,
  Effect.gen(function* () {
    const driver = yield* Git.makeVcsDriverShape();
    return CheckpointStore.of({ ...driver.checkpoints!, isGitRepository: driver.isInsideWorkTree });
  }),
);

for (const { laterB, cleanup, replyTiming, standaloneMemory } of [
  { laterB: false, cleanup: false, replyTiming: "before", standaloneMemory: false },
  { laterB: false, cleanup: true, replyTiming: "before", standaloneMemory: false },
  { laterB: true, cleanup: false, replyTiming: "before", standaloneMemory: false },
  { laterB: true, cleanup: true, replyTiming: "before", standaloneMemory: false },
  { laterB: true, cleanup: true, replyTiming: "absent", standaloneMemory: false },
  { laterB: true, cleanup: true, replyTiming: "after-fork", standaloneMemory: false },
  { laterB: false, cleanup: false, replyTiming: "before", standaloneMemory: true },
]) {
  it.effect(
    `forks exact A (reply: ${replyTiming}) ${laterB ? "after B" : "as its first child"}, with A's files and reconstruction ${cleanup ? "after cleanup" : "with the original runtime present"}${standaloneMemory ? " and standalone memory" : ""}`,
    () =>
      Effect.acquireUseRelease(
        Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "m198-history-"))),
        (directory) =>
          Effect.gen(function* () {
            const planning = yield* Planning.PlanningStore;
            const repositories = yield* Repositories.RepositoryStore;
            const runtimes = yield* Runtimes.LineRuntimeStore;
            const records = yield* Records.CheckpointRecordStore;
            const git = yield* Git.GitVcsDriver;
            const checkpoints = yield* CheckpointStore;
            const project = yield* planning.createProject({
              name: "Historical fork",
              createdAt: now,
            });
            const created = yield* planning.createPlan({
              projectId: project.projectId,
              message: "Root prompt",
              lastUsed: null,
              createdAt: now,
            });
            const planId = created.plan.planId;
            const root = MercurianCommitId.make(created.timeline[0]!.commitId);
            const repos: Array<RepositoryView & { head: string }> = [];
            for (const name of ["code", "docs"]) {
              const path = NodePath.join(directory, name);
              NodeFS.mkdirSync(path);
              runGit(path, ["init", "--initial-branch=main"]);
              runGit(path, ["config", "user.email", "test@example.com"]);
              runGit(path, ["config", "user.name", "Test"]);
              NodeFS.writeFileSync(NodePath.join(path, "file.txt"), "base\n");
              runGit(path, ["add", "."]);
              runGit(path, ["commit", "-m", "base"]);
              const repository = yield* repositories.addRepository({ path, name, createdAt: now });
              repos.push({ ...repository, head: runGit(path, ["rev-parse", "HEAD"]) });
            }
            yield* repositories.setProjectRepositories({
              projectId: project.projectId,
              repositoryIds: (standaloneMemory ? repos.slice(0, 1) : repos).map(
                (repo) => repo.repositoryId,
              ),
              addedAt: now,
            });
            const memorySource = standaloneMemory
              ? {
                  projectId: project.projectId,
                  repositoryId: repos[1]!.repositoryId,
                  subpath: null,
                  createdAt: now,
                  updatedAt: now,
                }
              : undefined;
            const commands: OrchestrationCommand[] = [];
            const reconstructions: PlanReconstruction[] = [];
            const mocks = Layer.mergeAll(
              Layer.mock(OrchestrationEngineService)({
                streamDomainEvents: Stream.empty,
                latestSequence: Effect.succeed(0),
                dispatch: (command) =>
                  Effect.sync(() => {
                    commands.push(command);
                    return { sequence: commands.length };
                  }),
              }),
              Layer.mock(ProjectionSnapshotQuery)({
                getActiveProjectByWorkspaceRoot: () =>
                  Effect.succeed(Option.some({ id: orchestrationProject } as never)),
                getShellSnapshot: () =>
                  Effect.succeed({
                    projects: [
                      {
                        id: orchestrationProject,
                        defaultModelSelection: { instanceId, model: "gpt-5.6" },
                      },
                    ],
                    threads: [],
                  } as never),
                getThreadShellById: () => Effect.succeed(Option.none()),
              }),
              Layer.mock(ProviderService)({
                streamEvents: Stream.empty,
                getCapabilities: () =>
                  Effect.succeed({ sessionModelSwitch: "in-session", groundingRoots: "multi" }),
              }),
              Layer.mock(ProviderRegistry)({}),
              Layer.mock(TerminalManager)({}),
              Layer.mock(ThreadDeletionReactor)({ drainThrough: () => Effect.void }),
              Layer.mock(VcsStatusBroadcaster)({
                refreshStatus: () => Effect.succeed({} as never),
              }),
              Layer.mock(MemoryIndex)({}),
              Layer.mock(MemorySourceStore)({
                getSnapshot: Effect.succeed(memorySource === undefined ? [] : [memorySource]),
                getSource: () => Effect.succeed(Option.fromNullishOr(memorySource)),
                getResolvedSource: () =>
                  Effect.succeed(
                    memorySource === undefined
                      ? Option.none()
                      : Option.some({
                          ...memorySource,
                          repositoryName: repos[1]!.name,
                          repositoryPath: repos[1]!.path,
                          rootPath: repos[1]!.path,
                        }),
                  ),
              }),
              Layer.mock(ReconstructionSummary)({}),
              Layer.mock(ReconstructionStore)({
                save: (record) =>
                  Effect.sync(() => {
                    reconstructions.push(record);
                  }),
                prepare: () => Effect.void,
                finish: () => Effect.void,
              }),
              Layer.mock(GitWorkflowService)({
                createWorktree: git.createWorktree,
                removeWorktree: git.removeWorktree,
              }),
            );
            yield* Effect.gen(function* () {
              const chain = yield* Snapshots.make;
              const slotService = yield* SlotService.make.pipe(
                Effect.provideService(Snapshots.SnapshotChain, chain),
              );
              yield* Effect.gen(function* () {
                let runtimeService = yield* RuntimeService.make;
                let branchReactor = yield* BranchReactor.make;
                yield* branchReactor.reconcile();
                const branches = yield* LineBranches.LineBranchStore;
                yield* runtimes.create({
                  planId,
                  lineRootCommitId: root,
                  threadId: originalThread,
                  homeRepositoryId: repos[0]!.repositoryId,
                  branch: "main",
                  worktreePath: repos[0]!.path,
                  repositoryIds: repos.map((repo) => repo.repositoryId),
                  unreachableRepositories: [],
                  createdAt: now,
                });
                const lineTurn = yield* LineTurn.make;
                const capture = (label: string) =>
                  Effect.forEach(repos, (repo) =>
                    Effect.gen(function* () {
                      const branch = Option.getOrThrow(
                        yield* branches.get({
                          lineRootCommitId: root,
                          repositoryId: repo.repositoryId,
                        }),
                      );
                      const snapshot = yield* chain.capture({
                        cwd: repo.path,
                        lineRootCommitId: root,
                        repositoryId: repo.repositoryId,
                        lineBranch: branch.branch,
                        kind: label === "A" && replyTiming !== "before" ? "partial" : "settled",
                        ref: CheckpointRef.make(`refs/t3/test/${label}`),
                      });
                      return {
                        repositoryId: repo.repositoryId,
                        repositoryName: repo.name,
                        files: [],
                        captureStatus: "ready" as const,
                        summaryStatus: "ready" as const,
                        beforeSnapshotOid: snapshot.previousOid ?? repo.head,
                        afterSnapshotOid: snapshot.oid,
                        branchTipOid: repo.head,
                        branchName: branch.branch,
                      };
                    }),
                  );
                yield* capture("before");
                const send = (threadId: ThreadId, id: string, text: string) =>
                  lineTurn.recordSend({
                    threadId,
                    messageId: MessageId.make(id),
                    text,
                    attachments: [],
                    createdAt: iso,
                  });
                const qa = yield* send(originalThread, "query-A", "Request A");
                const appendReplyA = () =>
                  planning.appendAssistantMessage({
                    planId,
                    parentCommitId: qa.commitId,
                    checkpointOwnerCommitId: MercurianCommitId.make(qa.commitId),
                    reconstructionId: "native-provenance-A",
                    text: "Reply A",
                    createdAt: now,
                  });
                let ra = replyTiming === "before" ? yield* appendReplyA() : undefined;
                for (const repo of repos) {
                  NodeFS.writeFileSync(NodePath.join(repo.path, "file.txt"), "captured A\n");
                  NodeFS.writeFileSync(NodePath.join(repo.path, "new-A.txt"), "uncommitted A\n");
                }
                const factsA = yield* capture("A");
                const savedA = (yield* records.attach({
                  ownerCommitId: MercurianCommitId.make(qa.commitId),
                  lineRootCommitId: root,
                  capture: {
                    status: "ready",
                    terminal: true,
                    files: [],
                    repositories: factsA,
                    ...(replyTiming === "before"
                      ? {}
                      : { partial: true, snapshotKind: "partial" as const }),
                  },
                }))!;
                const pendingBeforeReply =
                  replyTiming === "after-fork"
                    ? yield* runtimeService.ensureThread({
                        planId,
                        forkParentCommitId: yield* checkpointForkParent(savedA, savedA.revision),
                      })
                    : undefined;
                if (pendingBeforeReply !== undefined) ra = yield* appendReplyA();
                if (laterB) {
                  const qb = yield* send(originalThread, "query-B", "Request B");
                  yield* planning.appendAssistantMessage({
                    planId,
                    parentCommitId: qb.commitId,
                    checkpointOwnerCommitId: MercurianCommitId.make(qb.commitId),
                    text: "Reply B",
                    createdAt: now,
                  });
                  for (const repo of repos) {
                    NodeFS.writeFileSync(NodePath.join(repo.path, "file.txt"), "captured B\n");
                    NodeFS.writeFileSync(NodePath.join(repo.path, "new-B.txt"), "later B\n");
                  }
                  const factsB = yield* capture("B");
                  yield* records.attach({
                    ownerCommitId: MercurianCommitId.make(qb.commitId),
                    lineRootCommitId: root,
                    capture: { status: "ready", terminal: true, files: [], repositories: factsB },
                  });
                  for (const fact of factsB)
                    yield* runtimes.recordRepositorySnapshot(originalThread, fact.repositoryId, {
                      snapshotOid: fact.afterSnapshotOid,
                      kind: "settled",
                      branchTipOid: fact.branchTipOid,
                      departedRef: null,
                      branchMovement: { kind: "unchanged" },
                    });
                }
                // Runtime deletion does not own capture lookup or retained Git refs.
                if (cleanup) {
                  yield* runtimes.deleteByThread(originalThread);
                  runtimeService = yield* RuntimeService.make;
                  branchReactor = yield* BranchReactor.make;
                }
                for (const repo of repos) runGit(repo.path, ["gc", "--prune=now"]);
                const reopened = yield* Records.make;
                const durableA = (yield* reopened.get(planId, savedA.ownerCommitId))!;
                assert.ok(durableA.request);
                assert.strictEqual(
                  durableA.responseCommitId,
                  ra === undefined ? undefined : MercurianCommitId.make(ra.commitId),
                );
                if (replyTiming !== "before") {
                  assert.strictEqual(durableA.capture?.partial, true);
                  assert.strictEqual(durableA.capture?.terminal, true);
                }
                const diffQuery = yield* CheckpointDiff.make;
                for (const repo of repos) {
                  const result = yield* diffQuery.getCheckpointDiff({
                    planId,
                    ownerCommitId: savedA.ownerCommitId,
                    repositoryId: repo.repositoryId,
                    checkpointRevision: durableA.revision,
                  });
                  assert.strictEqual(result.status, "ready");
                  if (result.status === "ready") {
                    assert.ok(result.diff.includes("+captured A"));
                    assert.ok(!result.diff.includes("captured B"));
                  }
                  assert.strictEqual(runGit(repo.path, ["rev-parse", "HEAD"]), repo.head);
                  assert.ok(
                    yield* checkpoints.hasCheckpointRef({
                      cwd: repo.path,
                      checkpointRef: CheckpointRef.make(
                        factsA.find((fact) => fact.repositoryId === repo.repositoryId)!
                          .afterSnapshotOid,
                      ),
                    }),
                  );
                }
                const previousSlot = laterB
                  ? yield* slotService.claim({
                      planId,
                      projectId: project.projectId,
                      lineRootCommitId: root,
                      holder: { kind: "turn", threadId: originalThread },
                    })
                  : undefined;
                if (previousSlot !== undefined) {
                  for (const member of previousSlot.members) {
                    assert.strictEqual(
                      NodeFS.readFileSync(
                        NodePath.join(previousSlot.path, member.relativePath, "file.txt"),
                        "utf8",
                      ),
                      "captured B\n",
                    );
                  }
                  yield* slotService.release(previousSlot.slotId, {
                    kind: "turn",
                    threadId: originalThread,
                  });
                }
                const parent =
                  pendingBeforeReply === undefined
                    ? yield* checkpointForkParent(durableA, durableA.revision)
                    : savedA.ownerCommitId;
                const fork =
                  pendingBeforeReply ??
                  (yield* runtimeService.ensureThread({
                    planId,
                    forkParentCommitId: parent,
                  }));
                assert.strictEqual(
                  parent,
                  MercurianCommitId.make(replyTiming === "before" ? ra!.commitId : qa.commitId),
                );
                if (pendingBeforeReply !== undefined) {
                  assert.strictEqual(
                    durableA.responseCommitId,
                    MercurianCommitId.make(ra!.commitId),
                  );
                  assert.ok(durableA.revision > savedA.revision);
                  assert.strictEqual(
                    yield* checkpointForkParent(durableA, durableA.revision),
                    MercurianCommitId.make(ra!.commitId),
                  );
                  const pending = Option.getOrThrow(yield* runtimes.getByThreadId(fork.threadId));
                  assert.strictEqual(pending.forkParentCommitId, parent);
                }
                const sent = yield* send(fork.threadId, "fork-query", "Continue A");
                const detail = yield* planning.getPlanSnapshot({ planId });
                const forkRoot = MercurianCommitId.make(sent.commitId);
                assert.deepStrictEqual(
                  detail.timeline.find((item) => item.commitId === sent.commitId)?.parents,
                  [CommitId.make(parent)],
                );
                assert.ok(
                  BranchReactor.lineRoots(detail).some((item) => item.commitId === sent.commitId),
                );
                assert.strictEqual(
                  BranchReactor.lineRootCommitIdFor(detail, sent.commitId),
                  forkRoot,
                );
                yield* branchReactor.reconcile();
                const assigned = yield* runtimeService.ensureSlot({
                  threadId: fork.threadId,
                  holder: { kind: "turn" },
                });
                if (previousSlot !== undefined)
                  assert.strictEqual(assigned.slotId, previousSlot.slotId);
                const slot = Option.getOrThrow(
                  yield* (yield* Slots.SlotStore).get(assigned.slotId),
                );
                for (const member of slot.members) {
                  const cwd = NodePath.join(slot.path, member.relativePath);
                  assert.strictEqual(
                    NodeFS.readFileSync(NodePath.join(cwd, "file.txt"), "utf8"),
                    "captured A\n",
                  );
                  assert.strictEqual(
                    runGit(cwd, ["rev-parse", "HEAD"]),
                    repos.find((repo) => repo.repositoryId === member.repositoryId)!.head,
                  );
                  assert.ok(runGit(cwd, ["status", "--porcelain"]).includes("file.txt"));
                  assert.strictEqual(
                    NodeFS.readFileSync(NodePath.join(cwd, "new-A.txt"), "utf8"),
                    "uncommitted A\n",
                  );
                  assert.ok(!NodeFS.existsSync(NodePath.join(cwd, "new-B.txt")));
                }
                const preparation = yield* Preparation.make;
                const message = {
                  id: MessageId.make(sent.commitId),
                  role: "user" as const,
                  text: "Continue A",
                  attachments: [],
                  turnId: null,
                  streaming: false,
                  createdAt: iso,
                  updatedAt: iso,
                };
                const thread = {
                  id: fork.threadId,
                  messages: [message],
                  workspaceMembers: [],
                } as unknown as OrchestrationThread;
                const prepared = yield* preparation.prepare({
                  thread,
                  message,
                  sessionIsFresh: true,
                  contextDisposition: "resume",
                });
                assert.deepStrictEqual(prepared.session, { skipResume: true });
                assert.ok(prepared.text.includes("Request A"));
                assert.strictEqual(prepared.text.includes("Reply A"), replyTiming === "before");
                assert.ok(!prepared.text.includes("Request B"));
                assert.ok(!prepared.text.includes("Reply B"));
                assert.strictEqual(reconstructions[0]?.throughCommitId, parent);
                if (ra !== undefined) {
                  const responseA = detail.timeline.find((item) => item.commitId === ra.commitId);
                  assert.ok(responseA?._tag === "message");
                  if (responseA?._tag === "message")
                    assert.strictEqual(responseA.reconstructionId, "native-provenance-A");
                }
                yield* slotService.release(slot.slotId, { kind: "turn", threadId: fork.threadId });
                if (laterB && cleanup) {
                  const standalone = yield* planning.savePlanRevision({
                    planId,
                    text: "Standalone imported files",
                    parentCommitId: sent.commitId,
                    createdAt: now,
                  });
                  const badRecord = (yield* records.attach({
                    ownerCommitId: MercurianCommitId.make(standalone.commitId),
                    lineRootCommitId: forkRoot,
                    capture: {
                      terminal: true,
                      status: "ready",
                      files: [],
                      repositories: factsA.map((fact) => ({
                        ...fact,
                        afterSnapshotOid: "f".repeat(40),
                      })),
                    },
                  }))!;
                  assert.strictEqual(badRecord.request, undefined);
                  const unavailable = yield* diffQuery.getCheckpointDiff({
                    planId,
                    ownerCommitId: badRecord.ownerCommitId,
                    repositoryId: repos[0]!.repositoryId,
                    checkpointRevision: badRecord.revision,
                  });
                  assert.deepStrictEqual(unavailable, {
                    status: "unavailable",
                    checkpointRevision: badRecord.revision,
                    reason: "snapshot-missing",
                  });
                  const countBefore = commands.length;
                  const failure = yield* runtimeService
                    .ensureThread({
                      planId,
                      forkParentCommitId: yield* checkpointForkParent(
                        badRecord,
                        badRecord.revision,
                      ),
                    })
                    .pipe(Effect.flip);
                  assert.strictEqual(failure._tag, "LineRuntimeServiceError");
                  assert.strictEqual(commands.length, countBefore);
                  for (const repo of repos)
                    assert.strictEqual(runGit(repo.path, ["rev-parse", "HEAD"]), repo.head);
                }
              }).pipe(Effect.provideService(SlotService.SlotService, slotService));
            }).pipe(Effect.provide(mocks));
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                persistence,
                Git.layer,
                checkpointLayer,
                SlotRegistry.layer,
                Layer.mock(ServerSettings.ServerSettingsService)({
                  getSettings: Effect.succeed({
                    newWorktreesStartFromOrigin: false,
                    worktreePoolSize: 1,
                  } as never),
                }),
              ).pipe(
                Layer.provideMerge(VcsProcess.layer),
                Layer.provideMerge(ProcessRunner.layer),
                Layer.provideMerge(Config.layerTest(directory, { prefix: "m198-historical-" })),
                Layer.provideMerge(NodeServices.layer),
              ),
            ),
          ),
        (directory) =>
          Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      ),
  );
}

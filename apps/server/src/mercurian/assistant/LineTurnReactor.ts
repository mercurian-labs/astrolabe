import {
  type ChatAttachment,
  CommandId,
  MercurianCommitId,
  type MercurianProjectId,
  type MessageId,
  type ModelSelection,
  type OrchestrationEvent,
  type PlanGroundingItem,
  type PlanGroundingScope,
  type PlanId,
  type PlanInFlightTurn,
  type PlanQuestion,
  type PlanStreamItem,
  type PlanningModelSelection,
  PlanTurnId,
  type ProviderRuntimeEvent,
  ThreadId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ThreadDeletionReactor } from "../../orchestration/Services/ThreadDeletionReactor.ts";
import * as ProviderRegistry from "../../provider/Services/ProviderRegistry.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import { lineRootCommitIdFor } from "../commitTree/LineBranchReactor.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import { CommitId } from "../commitTree/schema.ts";
import { LegacySessionStore } from "../lineRuntimes/LegacySessionStore.ts";
import { LineRuntimeStore, type LineRuntimeStoreError } from "../lineRuntimes/LineRuntimeStore.ts";
import { buildLineBranchName } from "../lineRuntimes/branch.ts";
import { resolveThreadLine } from "../lineRuntimes/resolveThreadLine.ts";
import * as MemoryIndex from "../memory/MemoryIndex.ts";
import { PlanningStore, type PlanningStoreError } from "../planning/PlanningStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { RepositoryStore } from "../repositories/RepositoryStore.ts";
import { SlotRegistry } from "../worktreeSlots/SlotRegistry.ts";
import { SlotService } from "../worktreeSlots/SlotService.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import type { LineRuntimeRecord } from "../lineRuntimes/schema.ts";
import { foldGroundingEvent } from "./GroundingFold.ts";

export interface PlanTurnStatus {
  readonly isWorking: boolean;
  readonly hasPendingInput: boolean;
}

interface TurnRuntime {
  readonly planId: PlanId;
  readonly turnId: PlanTurnId;
  readonly threadId: ThreadId;
  readonly parentCommitId: CommitId;
  readonly modelSelection?: PlanningModelSelection;
  text: string;
  readonly grounding: Array<PlanGroundingItem>;
  readonly groundingKeys: Set<string>;
  groundingScope: PlanGroundingScope | undefined;
  readonly askedQuestions: Array<PlanQuestion>;
  pendingQuestions: ReadonlyArray<PlanQuestion> | undefined;
  answers: Record<string, unknown> | undefined;
  settling: boolean;
  stopRequested: boolean;
  readonly projectId?: MercurianProjectId;
}

export class PlanningTurnNotFoundError extends Schema.TaggedErrorClass<PlanningTurnNotFoundError>()(
  "PlanningTurnNotFoundError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return "This session is not an active planning turn.";
  }
}

export class LineRuntimeNotFoundError extends Schema.TaggedErrorClass<LineRuntimeNotFoundError>()(
  "LineRuntimeNotFoundError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return `Thread ${this.threadId} is not a Mercurian line thread.`;
  }
}

export interface RecordSendInput {
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly modelSelection?: ModelSelection;
  readonly createdAt: string;
}

export type RecordSendError =
  | LineRuntimeNotFoundError
  | LineRuntimeStoreError
  | PlanningStoreError
  | CommitStore.CommitStoreError;

export class LineTurnReactor extends Context.Service<
  LineTurnReactor,
  {
    readonly frames: (planId: PlanId) => Stream.Stream<PlanStreamItem>;
    readonly recordSend: (
      input: RecordSendInput,
    ) => Effect.Effect<{ readonly planId: PlanId; readonly commitId: CommitId }, RecordSendError>;
    readonly drainThrough: (sequence: number) => Effect.Effect<void>;
    readonly inFlightTurns: (planId: PlanId) => Effect.Effect<ReadonlyArray<PlanInFlightTurn>>;
    readonly status: Effect.Effect<ReadonlyMap<PlanId, PlanTurnStatus>>;
    readonly changes: Stream.Stream<void>;
    readonly teardownPlan: (input: {
      readonly planId: PlanId;
      readonly commitPartial: boolean;
      readonly lineRuntimes?: ReadonlyArray<LineRuntimeRecord>;
    }) => Effect.Effect<void>;
    readonly saveRevisionFromThread: (input: {
      readonly threadId: ThreadId;
      readonly text: string;
    }) => Effect.Effect<void, PlanningTurnNotFoundError>;
    readonly saveSpecRevisionFromThread: (input: {
      readonly threadId: ThreadId;
      readonly document: import("@t3tools/contracts").SpecDocument;
    }) => Effect.Effect<void, PlanningTurnNotFoundError>;
    readonly proposeMemoryAmendmentFromThread: (input: {
      readonly threadId: ThreadId;
      readonly title: string;
      readonly notes: ReadonlyArray<{ readonly name: string; readonly markdown: string }>;
      readonly placements: ReadonlyArray<{
        readonly map: string;
        readonly parent: string;
        readonly note: string;
        readonly type?: string;
      }>;
    }) => Effect.Effect<
      void,
      PlanningTurnNotFoundError | MemoryIndex.MemoryAmendmentValidationError
    >;
    readonly readPlanFromThread: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<string, PlanningTurnNotFoundError>;
    readonly readSpecFromThread: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<
      import("@t3tools/contracts").SpecDocument | null,
      PlanningTurnNotFoundError
    >;
  }
>()("t3/mercurian/assistant/LineTurnReactor") {}

const toPlanQuestion = (question: UserInputQuestion): PlanQuestion => ({
  id: question.id,
  header: question.header,
  question: question.question,
  options: question.options.map((option) => ({
    label: option.label,
    description: option.description,
  })),
  ...(question.multiSelect === undefined ? {} : { multiSelect: question.multiSelect }),
});

const MAX_GROUNDING_ITEMS = 200;
const INTERRUPT_SETTLE_GRACE = Duration.seconds(5);

export const make = Effect.gen(function* () {
  const planningStore = yield* PlanningStore;
  const commitStore = yield* CommitStore.CommitStore;
  const registry = yield* PlanTurnRegistry;
  const memoryIndex = yield* MemoryIndex.MemoryIndex;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const providerService = yield* ProviderService.ProviderService;
  const orchestration = yield* OrchestrationEngineService;
  const lineRuntimes = yield* LineRuntimeStore;
  const legacySessions = yield* LegacySessionStore;
  const repositoryStore = yield* RepositoryStore;
  const slots = yield* SlotStore;
  const slotRegistry = yield* SlotRegistry;
  const slotService = yield* SlotService;
  const deletionReactor = yield* ThreadDeletionReactor;
  const crypto = yield* Crypto.Crypto;

  const framesPubSub = yield* PubSub.unbounded<{
    readonly planId: PlanId;
    readonly frame: PlanStreamItem;
  }>();
  const changesPubSub = yield* PubSub.unbounded<void>();
  const turns = new Map<ThreadId, TurnRuntime>();
  const seenSequence = yield* SubscriptionRef.make(0);

  const turnsOfPlan = (planId: PlanId) =>
    [...turns.values()].filter((turn) => turn.planId === planId);
  const announceChange = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);
  const publishFrame = (planId: PlanId, frame: PlanStreamItem) =>
    PubSub.publish(framesPubSub, { planId, frame }).pipe(Effect.asVoid);

  const settleTurn = Effect.fn("LineTurnReactor.settleTurn")(function* (
    turn: TurnRuntime,
    options: { readonly interrupted: boolean },
  ) {
    if (turn.settling) return;
    turn.settling = true;
    const claimed = (yield* registry.getTurns(turn.planId)).find(
      (candidate) => candidate.turnId === turn.turnId,
    );
    const question =
      turn.askedQuestions.length === 0
        ? undefined
        : {
            questions: [...turn.askedQuestions],
            ...(turn.answers === undefined ? {} : { answers: turn.answers }),
          };
    const appended = yield* planningStore
      .appendAssistantMessage({
        planId: turn.planId,
        parentCommitId: claimed?.tipCommitId ?? turn.parentCommitId,
        sourceUserMessageId: turn.parentCommitId,
        text: turn.text,
        ...(options.interrupted ? { interrupted: true } : {}),
        ...(turn.grounding.length === 0 ? {} : { grounding: turn.grounding }),
        ...(turn.groundingScope === undefined ? {} : { groundingScope: turn.groundingScope }),
        ...(question === undefined ? {} : { question }),
        ...(turn.modelSelection === undefined ? {} : { generatedBy: turn.modelSelection }),
        createdAt: yield* DateTime.now,
      })
      .pipe(Effect.result);
    turns.delete(turn.threadId);
    yield* registry.close(turn.planId, turn.turnId);
    if (Result.isFailure(appended)) {
      yield* Effect.logError("line turn settle failed to commit", {
        planId: turn.planId,
        cause: appended.failure,
      });
    }
    yield* publishFrame(turn.planId, { kind: "turn-settled", turnId: turn.turnId });
    yield* announceChange;
  });

  const recordGrounding = Effect.fn("LineTurnReactor.recordGrounding")(function* (
    turn: TurnRuntime,
    event: ProviderRuntimeEvent,
  ) {
    const folded = foldGroundingEvent(event);
    if (folded === null || turn.groundingKeys.has(folded.key)) return;
    turn.groundingKeys.add(folded.key);
    if (turn.grounding.length >= MAX_GROUNDING_ITEMS) {
      if (turn.grounding.length === MAX_GROUNDING_ITEMS) {
        const marker: PlanGroundingItem = { kind: "other", label: "…and more" };
        turn.grounding.push(marker);
        yield* publishFrame(turn.planId, {
          kind: "turn-grounding",
          turnId: turn.turnId,
          item: marker,
        });
      }
      return;
    }
    turn.grounding.push(folded.item);
    yield* publishFrame(turn.planId, {
      kind: "turn-grounding",
      turnId: turn.turnId,
      item: folded.item,
    });
  });

  const handleRuntimeEvent = Effect.fn("LineTurnReactor.handleRuntimeEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    const turn = turns.get(event.threadId);
    if (turn === undefined || turn.settling) return;
    switch (event.type) {
      case "content.delta":
        if (event.payload.streamKind !== "assistant_text") return;
        const offset = turn.text.length;
        turn.text += event.payload.delta;
        yield* publishFrame(turn.planId, {
          kind: "turn-delta",
          turnId: turn.turnId,
          textDelta: event.payload.delta,
          offset,
        });
        return;
      case "user-input.requested": {
        const questions = event.payload.questions.map(toPlanQuestion);
        turn.pendingQuestions = questions;
        turn.askedQuestions.push(...questions);
        yield* publishFrame(turn.planId, { kind: "turn-question", turnId: turn.turnId, questions });
        yield* announceChange;
        return;
      }
      case "user-input.resolved":
        if (turn.pendingQuestions === undefined) return;
        turn.pendingQuestions = undefined;
        turn.answers = { ...turn.answers, ...event.payload.answers };
        yield* publishFrame(turn.planId, { kind: "turn-question-answered", turnId: turn.turnId });
        yield* announceChange;
        return;
      case "request.opened":
        yield* recordGrounding(turn, event);
        return;
      case "turn.completed":
        yield* settleTurn(turn, { interrupted: event.payload.state !== "completed" });
        return;
      case "turn.aborted":
      case "session.exited":
        yield* settleTurn(turn, { interrupted: true });
        return;
      default:
        yield* recordGrounding(turn, event);
    }
  });

  const ranUnderFor = Effect.fn("LineTurnReactor.ranUnderFor")(function* (
    selection: NonNullable<
      Extract<
        OrchestrationEvent,
        { type: "thread.turn-start-requested" }
      >["payload"]["modelSelection"]
    >,
  ) {
    const provider = (yield* providerRegistry.getProviders).find(
      (candidate) => candidate.instanceId === selection.instanceId,
    );
    if (provider === undefined) return undefined;
    return {
      provider: provider.driver,
      model: selection.model,
      ...(selection.options === undefined ? {} : { options: selection.options }),
    } satisfies PlanningModelSelection;
  });

  const tipForRuntime = (
    detail: import("../planning/PlanningStore.ts").PlanDetail,
    runtime: LineRuntimeRecord,
  ): CommitId | undefined => {
    if (runtime.lineRootCommitId === null) {
      return runtime.forkParentCommitId === undefined
        ? undefined
        : CommitId.make(runtime.forkParentCommitId);
    }
    return detail.timeline
      .filter(
        (item) =>
          item._tag !== "coding-session" &&
          lineRootCommitIdFor(detail, item.commitId) === runtime.lineRootCommitId,
      )
      .toSorted((left, right) => right.sequence - left.sequence)[0]?.commitId;
  };

  const recordSend: LineTurnReactor["Service"]["recordSend"] = (input) =>
    Effect.gen(function* () {
      const runtime = yield* lineRuntimes.getByThreadId(input.threadId);
      if (Option.isNone(runtime)) {
        return yield* new LineRuntimeNotFoundError({ threadId: input.threadId });
      }
      const commitId = CommitId.make(input.messageId);
      const existing = yield* commitStore.getCommit({ commitId, visibility: "all" });
      if (Option.isSome(existing)) {
        if (runtime.value.lineRootCommitId === null) {
          yield* lineRuntimes.rootPending(input.threadId, MercurianCommitId.make(commitId));
        }
        return { planId: runtime.value.planId, commitId };
      }

      const detail = yield* planningStore.getPlanSnapshot({ planId: runtime.value.planId });
      const parentCommitId = tipForRuntime(detail, runtime.value);
      const ranUnder =
        input.modelSelection === undefined ? undefined : yield* ranUnderFor(input.modelSelection);
      const appended = yield* planningStore.appendMessage({
        planId: runtime.value.planId,
        commitId,
        text: input.text,
        ...(parentCommitId === undefined ? {} : { parentCommitId }),
        ...(input.attachments.length === 0 ? {} : { attachments: [...input.attachments] }),
        ...(ranUnder === undefined ? {} : { ranUnder }),
        lastUsed: null,
        createdAt: DateTime.makeUnsafe(input.createdAt),
      });
      if (runtime.value.lineRootCommitId === null) {
        yield* lineRuntimes.rootPending(input.threadId, MercurianCommitId.make(appended.commitId));
      }
      return { planId: runtime.value.planId, commitId: appended.commitId };
    });

  const adoptCreatedThread = Effect.fn("LineTurnReactor.adoptCreatedThread")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.created" }>,
  ) {
    if (Option.isSome(yield* lineRuntimes.getByThreadId(event.payload.threadId))) return;
    const owner = yield* planningStore.getProjectByOrchestrationProjectId(event.payload.projectId);
    if (Option.isNone(owner)) return;
    const snapshot = yield* repositoryStore.getSnapshot;
    const linked = snapshot.projectRepositories
      .filter((link) => link.projectId === owner.value.projectId)
      .flatMap((link) => {
        const repository = snapshot.repositories.find(
          (candidate) => candidate.repositoryId === link.repositoryId,
        );
        return repository === undefined ? [] : [repository];
      });
    const primary = linked[0];
    if (primary === undefined) return;
    const createdAt = DateTime.makeUnsafe(event.payload.createdAt);
    const detail = yield* planningStore.createPlanFromThread({
      projectId: owner.value.projectId,
      title: event.payload.title,
      createdAt,
    });
    const capabilities = yield* providerService.getCapabilities(
      event.payload.modelSelection.instanceId,
    );
    yield* lineRuntimes.create({
      planId: detail.plan.planId,
      lineRootCommitId: null,
      threadId: event.payload.threadId,
      homeRepositoryId: primary.repositoryId,
      branch: buildLineBranchName(event.payload.title, String(event.payload.threadId)),
      worktreePath: primary.path,
      unreachableRepositories:
        capabilities.groundingRoots === "multi" ? [] : linked.slice(1).map((repo) => repo.name),
      repositoryIds: linked.map((repository) => repository.repositoryId),
      createdAt,
    });
  });

  const startRecordedTurn = Effect.fn("LineTurnReactor.startRecordedTurn")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.turn-start-requested" }>,
  ) {
    const resolved = yield* resolveThreadLine(lineRuntimes, legacySessions, event.payload.threadId);
    if (Option.isNone(resolved)) return;
    const runtime = yield* lineRuntimes.getByThreadId(event.payload.threadId);
    if (Option.isNone(runtime)) return;
    const commitId = CommitId.make(event.payload.messageId);
    const commit = yield* commitStore.getCommit({ commitId, visibility: "all" });
    if (Option.isNone(commit)) {
      yield* Effect.logWarning("line turn start has no recorded send", {
        threadId: event.payload.threadId,
        messageId: event.payload.messageId,
      });
      return;
    }
    const detail = yield* planningStore.getPlanSnapshot({ planId: runtime.value.planId });
    const message = detail.timeline.find(
      (item) => item._tag === "message" && item.commitId === commitId,
    );
    const ranUnder = message?._tag === "message" ? message.ranUnder : undefined;
    const turnId = PlanTurnId.make(yield* crypto.randomUUIDv4);
    yield* registry.open({
      planId: runtime.value.planId,
      turnId,
      threadId: event.payload.threadId,
      parentCommitId: commitId,
      tipCommitId: commitId,
    });
    const turn: TurnRuntime = {
      planId: runtime.value.planId,
      turnId,
      threadId: event.payload.threadId,
      parentCommitId: commitId,
      ...(ranUnder === undefined ? {} : { modelSelection: ranUnder }),
      text: "",
      grounding: [],
      groundingKeys: new Set(),
      groundingScope:
        runtime.value.unreachableRepositories.length === 0
          ? undefined
          : { unreachableRepositories: runtime.value.unreachableRepositories },
      askedQuestions: [],
      pendingQuestions: undefined,
      answers: undefined,
      settling: false,
      stopRequested: false,
      projectId: detail.plan.projectId,
    };
    turns.set(event.payload.threadId, turn);
    yield* publishFrame(runtime.value.planId, {
      kind: "turn-started",
      turnId,
      parentCommitId: MercurianCommitId.make(commitId),
      phase: "running",
      ...(turn.groundingScope === undefined ? {} : { groundingScope: turn.groundingScope }),
    });
    yield* announceChange;
  });

  const handleDomainEvent = Effect.fn("LineTurnReactor.handleDomainEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (event.type === "thread.created") return yield* adoptCreatedThread(event);
    if (event.type === "thread.turn-start-requested") return yield* startRecordedTurn(event);
    if (event.type === "thread.meta-updated" && event.payload.title !== undefined) {
      const runtime = yield* lineRuntimes.getByThreadId(event.payload.threadId);
      if (Option.isNone(runtime)) return;
      yield* planningStore.renamePlan({
        planId: runtime.value.planId,
        title: event.payload.title,
        updatedAt: DateTime.makeUnsafe(event.payload.updatedAt),
      });
      return;
    }
    if (event.type === "thread.turn-interrupt-requested") {
      const turn = turns.get(event.payload.threadId);
      if (turn === undefined || turn.settling) return;
      turn.stopRequested = true;
      yield* Effect.sleep(INTERRUPT_SETTLE_GRACE).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const current = turns.get(event.payload.threadId);
            if (current !== undefined && !current.settling && current.stopRequested) {
              yield* settleTurn(current, { interrupted: true });
            }
          }),
        ),
        Effect.forkDetach,
      );
      return;
    }
    if (event.type === "thread.deleted") {
      const runtime = yield* lineRuntimes.getByThreadId(event.payload.threadId);
      if (Option.isNone(runtime)) return;
      const turn = turns.get(event.payload.threadId);
      if (turn !== undefined) yield* settleTurn(turn, { interrupted: true });
      if (runtime.value.lineRootCommitId !== null) {
        const slot = (yield* slots.listAll).find(
          (candidate) => candidate.currentLineRootCommitId === runtime.value.lineRootCommitId,
        );
        if (slot !== undefined) {
          const lease = yield* slotRegistry.lease(slot.slotId);
          if (Option.isSome(lease)) {
            for (const holder of lease.value.holders) {
              if (holder.threadId === event.payload.threadId) {
                yield* slotService.release(slot.slotId, holder).pipe(Effect.ignoreCause());
              }
            }
          }
        }
      }
      yield* lineRuntimes.deleteByThread(event.payload.threadId);
    }
  });

  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));
  yield* Stream.runForEach(
    orchestration.streamDomainEvents.pipe(
      Stream.onStart(orchestration.latestSequence.pipe(Effect.flatMap(noteSeen))),
    ),
    (event) =>
      handleDomainEvent(event).pipe(
        Effect.catchCause((cause) => Effect.logError("line turn domain event failed", { cause })),
        Effect.andThen(noteSeen(event.sequence)),
      ),
  ).pipe(Effect.forkScoped({ startImmediately: true }));
  yield* Stream.runForEach(providerService.streamEvents, (event) =>
    handleRuntimeEvent(event).pipe(
      Effect.catchCause((cause) => Effect.logError("line turn runtime event failed", { cause })),
    ),
  ).pipe(Effect.forkScoped({ startImmediately: true }));

  const frames: LineTurnReactor["Service"]["frames"] = (planId) =>
    Stream.fromPubSub(framesPubSub).pipe(
      Stream.filter((published) => published.planId === planId),
      Stream.map((published) => published.frame),
    );
  const drainThrough: LineTurnReactor["Service"]["drainThrough"] = (sequence) =>
    SubscriptionRef.changes(seenSequence).pipe(
      Stream.filter((seen) => seen >= sequence),
      Stream.runHead,
      Effect.asVoid,
    );
  const inFlightTurns: LineTurnReactor["Service"]["inFlightTurns"] = (planId) =>
    Effect.sync(() =>
      turnsOfPlan(planId)
        .filter((turn) => !turn.settling)
        .map((turn) => ({
          turnId: turn.turnId,
          parentCommitId: MercurianCommitId.make(turn.parentCommitId),
          text: turn.text,
          grounding: [...turn.grounding],
          phase: "running" as const,
          ...(turn.groundingScope === undefined ? {} : { groundingScope: turn.groundingScope }),
          ...(turn.pendingQuestions === undefined ? {} : { questions: turn.pendingQuestions }),
        })),
    );
  const status: LineTurnReactor["Service"]["status"] = Effect.sync(() => {
    const result = new Map<PlanId, PlanTurnStatus>();
    for (const turn of turns.values()) {
      if (turn.settling) continue;
      const waiting = turn.pendingQuestions !== undefined;
      const existing = result.get(turn.planId) ?? { isWorking: false, hasPendingInput: false };
      result.set(turn.planId, {
        isWorking: existing.isWorking || !waiting,
        hasPendingInput: existing.hasPendingInput || waiting,
      });
    }
    return result;
  });

  const teardownPlan: LineTurnReactor["Service"]["teardownPlan"] = (input) =>
    Effect.gen(function* () {
      for (const turn of turnsOfPlan(input.planId)) {
        if (input.commitPartial) yield* settleTurn(turn, { interrupted: true });
        else {
          turns.delete(turn.threadId);
          yield* registry.close(input.planId, turn.turnId);
        }
      }
      if (input.commitPartial) return;
      const runtimes = input.lineRuntimes ?? (yield* lineRuntimes.listByPlan(input.planId));
      let lastDeleteSequence: number | undefined;
      for (const runtime of runtimes) {
        if (runtime.lineRootCommitId !== null) {
          const slot = (yield* slots.listAll).find(
            (candidate) => candidate.currentLineRootCommitId === runtime.lineRootCommitId,
          );
          if (slot !== undefined) {
            const lease = yield* slotRegistry.lease(slot.slotId);
            if (Option.isSome(lease)) {
              for (const holder of lease.value.holders) {
                if (holder.threadId === runtime.threadId) {
                  yield* slotService.release(slot.slotId, holder).pipe(Effect.ignoreCause());
                }
              }
            }
          }
        }
        const deleted = yield* Effect.exit(
          orchestration.dispatch({
            type: "thread.delete",
            commandId: CommandId.make(
              `server:line-turn-reactor-delete:${yield* crypto.randomUUIDv4}`,
            ),
            threadId: runtime.threadId,
          }),
        );
        if (Exit.isSuccess(deleted)) lastDeleteSequence = deleted.value.sequence;
      }
      if (lastDeleteSequence !== undefined) {
        yield* deletionReactor.drainThrough(lastDeleteSequence).pipe(Effect.ignoreCause());
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("line turn teardown failed", { planId: input.planId, cause }),
      ),
    );

  const requireClaim = Effect.fn("LineTurnReactor.requireClaim")(function* (threadId: ThreadId) {
    const claimed = yield* registry.getByThread(threadId);
    if (Option.isNone(claimed)) return yield* new PlanningTurnNotFoundError({ threadId });
    return claimed.value;
  });
  const saveRevisionFromThread: LineTurnReactor["Service"]["saveRevisionFromThread"] = (input) =>
    Effect.gen(function* () {
      const turn = yield* requireClaim(input.threadId);
      const revision = yield* planningStore
        .saveAssistantPlanRevision({
          planId: turn.planId,
          parentCommitId: turn.tipCommitId,
          text: input.text,
          createdAt: yield* DateTime.now,
        })
        .pipe(Effect.mapError(() => new PlanningTurnNotFoundError({ threadId: input.threadId })));
      yield* registry.advanceTip(turn.planId, turn.turnId, revision.commitId);
    });
  const saveSpecRevisionFromThread: LineTurnReactor["Service"]["saveSpecRevisionFromThread"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const turn = yield* requireClaim(input.threadId);
      const revision = yield* planningStore
        .saveAssistantSpecRevision({
          planId: turn.planId,
          parentCommitId: turn.tipCommitId,
          document: input.document,
          createdAt: yield* DateTime.now,
        })
        .pipe(Effect.mapError(() => new PlanningTurnNotFoundError({ threadId: input.threadId })));
      yield* registry.advanceTip(turn.planId, turn.turnId, revision.commitId);
    });
  const proposeMemoryAmendmentFromThread: LineTurnReactor["Service"]["proposeMemoryAmendmentFromThread"] =
    (input) =>
      Effect.gen(function* () {
        const claimed = yield* requireClaim(input.threadId);
        const turn = turns.get(input.threadId);
        if (turn === undefined || turn.settling || turn.projectId === undefined) {
          return yield* new PlanningTurnNotFoundError({ threadId: input.threadId });
        }
        const landed = yield* memoryIndex
          .landAmendment({
            projectId: turn.projectId,
            threadId: input.threadId,
            turnId: turn.turnId,
            amendment: {
              title: input.title,
              notes: input.notes.map((note) => ({ ...note })),
              placements: input.placements.map((placement) => ({ ...placement })),
            },
          })
          .pipe(Effect.result);
        if (Result.isSuccess(landed)) return;
        if (landed.failure._tag === "MemoryAmendmentValidationError") {
          return yield* landed.failure;
        }
        yield* Effect.logError("memory amendment failed to land", {
          planId: claimed.planId,
          turnId: claimed.turnId,
          cause: landed.failure,
        });
        return yield* new MemoryIndex.MemoryAmendmentValidationError({
          reason: "Project memory could not be amended.",
        });
      });
  const readPlanFromThread: LineTurnReactor["Service"]["readPlanFromThread"] = (input) =>
    Effect.gen(function* () {
      const turn = yield* requireClaim(input.threadId);
      return yield* planningStore
        .getPlanTextAt({ planId: turn.planId, commitId: turn.tipCommitId })
        .pipe(Effect.mapError(() => new PlanningTurnNotFoundError({ threadId: input.threadId })));
    });
  const readSpecFromThread: LineTurnReactor["Service"]["readSpecFromThread"] = (input) =>
    Effect.gen(function* () {
      const turn = yield* requireClaim(input.threadId);
      return yield* planningStore
        .getSpecAt({ planId: turn.planId, commitId: turn.tipCommitId })
        .pipe(
          Effect.map((at) => at?.document ?? null),
          Effect.mapError(() => new PlanningTurnNotFoundError({ threadId: input.threadId })),
        );
    });

  return LineTurnReactor.of({
    frames,
    recordSend,
    drainThrough,
    inFlightTurns,
    status,
    teardownPlan,
    saveRevisionFromThread,
    saveSpecRevisionFromThread,
    proposeMemoryAmendmentFromThread,
    readPlanFromThread,
    readSpecFromThread,
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  });
});

export const layer = Layer.effect(LineTurnReactor, make);

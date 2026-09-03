/**
 * PlanningAssistant — planning turns on line runtimes.
 *
 * A reply in a planning space is one upstream orchestration turn: the human
 * message commits first, then this service ensures the line's runtime, starts
 * the turn with the human commit as its message id, folds provider events into
 * transient plan frames, and lands exactly one assistant message commit when
 * the turn settles. The commit is the record; everything here is runtime state.
 *
 * The invariants this service enforces at the runtime, not in a prompt:
 *
 * - every branch line owns one orchestration thread and one claimed project
 *   slot, reused by later turns on that line and separated when a line forks;
 * - runtime mode and approvals are enforced at the orchestration seams, so
 *   planning uses the same provider lifecycle and interruption path as chat;
 * - one turn per branch at a time, as a server fact: a turn's {@link PlanTurnRegistry}
 *   claim covers exactly the chain it writes, so replies on different branches
 *   run concurrently while both this service and the store's human-write
 *   guard read the same claims.
 *
 * @module PlanningAssistant
 */
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  ApprovalRequestId,
  CommandId,
  type ChatAttachment,
  MessageId,
  MercurianCommitId,
  type MercurianProjectId,
  type MemoryAmendmentProposal,
  NoPendingQuestionError,
  type PlanGroundingItem,
  type PlanGroundingScope,
  type PlanId,
  type PlanInFlightTurn,
  type PlanQuestion,
  type PlanReconstructionMeasure,
  type PlanStreamItem,
  type PlanningModelSelection,
  PlanTurnId,
  type PlanTurnRefusalReason,
  type ProviderRuntimeEvent,
  type RuntimeMode,
  resolvePlanningModel,
  specDocumentFromIssue,
  type SpecDocument,
  ThreadId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import * as ProviderRegistry from "../../provider/Services/ProviderRegistry.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ThreadDeletionReactor } from "../../orchestration/Services/ThreadDeletionReactor.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import { type Commit, type CommitId } from "../commitTree/schema.ts";
import {
  MessageCommitPayload,
  PlanningStore,
  PlanRevisionCommitPayload,
  SpecRevisionCommitPayload,
  type PlanningStoreError,
} from "../planning/PlanningStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import { lineRootCommitIdFor } from "../commitTree/LineBranchReactor.ts";
import { LineRuntimeService, isRepositoryNotGitError } from "../lineRuntimes/LineRuntimeService.ts";
import { LineRuntimeStore } from "../lineRuntimes/LineRuntimeStore.ts";
import type { LineRuntimeRecord } from "../lineRuntimes/schema.ts";
import { SlotService, isLineBranchMissingError } from "../worktreeSlots/SlotService.ts";
import { SlotStore } from "../worktreeSlots/SlotStore.ts";
import { SlotRegistry } from "../worktreeSlots/SlotRegistry.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import * as MemoryIndex from "../memory/MemoryIndex.ts";
import { WorkspaceSettingsStore } from "../workspace/WorkspaceSettingsStore.ts";
import { foldGroundingEvent } from "./GroundingFold.ts";
import {
  measureTranscript,
  planningSystemAppendix,
  TRANSCRIPT_FRAMING_MARGIN,
  type TranscriptEntry,
} from "./PlanningPrompt.ts";
import * as Schema from "effect/Schema";

/** What the tree composes into its rows (wire.ts's two inputs). */
export interface PlanTurnStatus {
  readonly isWorking: boolean;
  readonly hasPendingInput: boolean;
}

export interface StartTurnInput {
  readonly planId: PlanId;
  /** The human message commit this turn replies to. */
  readonly parentCommitId: CommitId;
  /** That message's text — what the provider is asked to reply to. */
  readonly text: string;
  readonly attachments?: ReadonlyArray<ChatAttachment>;
  readonly runtimeMode?: RuntimeMode;
  /** The provider/model pair stamped on that human message. */
  readonly ranUnder?: PlanningModelSelection;
}

export interface AnswerQuestionInput {
  readonly planId: PlanId;
  readonly turnId: PlanTurnId;
  readonly answers: Readonly<Record<string, unknown>>;
}

export interface MeasureReconstructionInput {
  readonly planId: PlanId;
  readonly parentCommitId: CommitId;
}

/** The conversational state of one running turn. Mutated in place; single process. */
interface TurnRuntime {
  readonly planId: PlanId;
  readonly turnId: PlanTurnId;
  threadId: ThreadId;
  readonly parentCommitId: CommitId;
  /** Captured at start so settlement records the model that actually ran. */
  readonly modelSelection: PlanningModelSelection;
  text: string;
  readonly grounding: Array<PlanGroundingItem>;
  readonly groundingKeys: Set<string>;
  groundingScope: PlanGroundingScope | undefined;
  phase: "waiting-for-slot" | "running";
  /** The question currently waiting, if any. */
  pendingQuestions: ReadonlyArray<PlanQuestion> | undefined;
  pendingRequestId: ApprovalRequestId | undefined;
  /** Every question this turn asked — the settled commit's record. */
  readonly askedQuestions: Array<PlanQuestion>;
  answers: Record<string, unknown> | undefined;
  /** Guards double settles: a stop racing the provider's own completion. */
  settling: boolean;
  stopRequested: boolean;
  pendingMemoryAmendment?: MemoryIndex.PendingMemoryAmendment;
  /** Project identity used to resolve proposal repository names at settle. */
  readonly projectId?: MercurianProjectId;
}

/**
 * Grounding beyond this is real but unrenderable; the fold stops recording
 * and the last entry says so, which keeps "what it looked at is shown"
 * honest without an unbounded wire payload.
 */
const MAX_GROUNDING_ITEMS = 200;

export class PlanningAssistant extends Context.Service<
  PlanningAssistant,
  {
    /**
     * Generate the reply to a just-committed human message. Never fails:
     * anything that prevents a reply — no planning model, no instance on
     * this machine, a turn already running — is a `turn-refused` frame on
     * the plan's stream, because the message landing was never conditional
     * on the assistant being able to answer it.
     */
    readonly startTurn: (input: StartTurnInput) => Effect.Effect<void>;
    /** Exact prompt-reconstruction sizes at one immutable plan position. */
    readonly measureReconstruction: (
      input: MeasureReconstructionInput,
    ) => Effect.Effect<
      PlanReconstructionMeasure,
      | PlanningStoreError
      | CommitStore.CommitStoreError
      | RepositoryStore.RepositoryStoreError
      | Schema.SchemaError
    >;
    /**
     * Stop one streaming reply; the partial lands as a commit marked
     * interrupted. Idempotent when that turn is not streaming, and turns on
     * other branches are untouched.
     */
    readonly stopTurn: (input: {
      readonly planId: PlanId;
      readonly turnId: PlanTurnId;
    }) => Effect.Effect<void>;
    /** Answer the structured question one turn is waiting on. */
    readonly answerQuestion: (
      input: AnswerQuestionInput,
    ) => Effect.Effect<void, NoPendingQuestionError>;
    /**
     * The transient frames of this plan's turns. A fresh subscription per
     * access; frames are transport, never resumable (ADR 002 §3).
     */
    readonly frames: (planId: PlanId) => Stream.Stream<PlanStreamItem>;
    /** The partial turns for snapshot composition — join-mid-turn's source, one per streaming branch. */
    readonly inFlightTurns: (planId: PlanId) => Effect.Effect<ReadonlyArray<PlanInFlightTurn>>;
    readonly memoryAmendmentProposal: (
      planId: PlanId,
    ) => Effect.Effect<MemoryAmendmentProposal | undefined>;
    readonly cancelMemoryAmendment: (planId: PlanId) => Effect.Effect<void>;
    readonly clearMemoryAmendment: (planId: PlanId) => Effect.Effect<void>;
    /** The tree's two status inputs, for every plan with a live turn. */
    readonly status: Effect.Effect<ReadonlyMap<PlanId, PlanTurnStatus>>;
    /** Fires when any turn starts, pauses on a question, or settles. */
    readonly changes: Stream.Stream<void>;
    /**
     * The plan is leaving (archive or delete): stop its session, and either
     * land the partial reply as an interrupted commit (archive — the record
     * survives) or discard it (delete — the history is going away).
     */
    readonly teardownPlan: (input: {
      readonly planId: PlanId;
      readonly commitPartial: boolean;
      /** Captured before plan deletion, because its rows cascade with the plan. */
      readonly lineRuntimes?: ReadonlyArray<LineRuntimeRecord>;
    }) => Effect.Effect<void>;
    /**
     * The MCP write door: a provider session asking to revise the plan. Maps
     * the session's thread to its live planning turn — a thread that is not
     * an active planning turn is refused, so no other session ever holds
     * plan-revision powers.
     */
    readonly saveRevisionFromThread: (input: {
      readonly threadId: ThreadId;
      readonly text: string;
    }) => Effect.Effect<void, PlanningTurnNotFoundError>;
    readonly saveSpecRevisionFromThread: (input: {
      readonly threadId: ThreadId;
      readonly document: SpecDocument;
    }) => Effect.Effect<void, PlanningTurnNotFoundError>;
    readonly proposeMemoryAmendmentFromThread: (input: {
      readonly threadId: ThreadId;
      readonly title: string;
      readonly notes: ReadonlyArray<{ readonly name: string; readonly markdown: string }>;
      readonly placements: ReadonlyArray<{
        readonly map: string;
        readonly parent: string;
        readonly note: string;
        readonly type?: string | undefined;
      }>;
    }) => Effect.Effect<void, PlanningTurnNotFoundError>;
    /** The MCP read door: the artifact's text at the calling turn's tip. */
    readonly readPlanFromThread: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<string, PlanningTurnNotFoundError>;
    readonly readSpecFromThread: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<SpecDocument | null, PlanningTurnNotFoundError>;
  }
>()("t3/mercurian/assistant/PlanningAssistant") {}

/** The calling provider session is not an active planning turn. */
export class PlanningTurnNotFoundError extends Schema.TaggedErrorClass<PlanningTurnNotFoundError>()(
  "PlanningTurnNotFoundError",
  { threadId: ThreadId },
) {
  override get message(): string {
    return "This session is not an active planning turn.";
  }
}

const decodeMessagePayload = Schema.decodeUnknownEffect(MessageCommitPayload);
const decodeRevisionPayload = Schema.decodeUnknownEffect(PlanRevisionCommitPayload);
const decodeCurrentSpecRevisionPayload = Schema.decodeUnknownEffect(SpecRevisionCommitPayload);
const LegacySpecDocument = Schema.Struct({ title: Schema.String, description: Schema.String });
const LegacySpecRevisionSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("import"), issueId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("tracker-refresh"), issueId: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("tracker-reconciliation"),
    issueId: Schema.String,
    upstream: LegacySpecDocument,
  }),
  Schema.Struct({ kind: Schema.Literal("direct") }),
]);
const decodeStructuredLegacySpecRevisionPayload = Schema.decodeUnknownEffect(
  Schema.Struct({
    document: LegacySpecDocument,
    source: Schema.optional(LegacySpecRevisionSource),
  }),
);
const decodeLegacySpecRevisionPayload = Schema.decodeUnknownEffect(LegacySpecDocument);
const decodeSpecRevisionPayload = Effect.fn("PlanningAssistant.decodeSpecRevisionPayload")(
  function* (payload: unknown) {
    const current = yield* Effect.result(decodeCurrentSpecRevisionPayload(payload));
    if (Result.isSuccess(current)) return current.success;
    const structured = yield* Effect.result(decodeStructuredLegacySpecRevisionPayload(payload));
    if (Result.isSuccess(structured)) {
      const source = structured.success.source;
      return {
        document: specDocumentFromIssue(
          structured.success.document.title,
          structured.success.document.description,
        ),
        ...(source === undefined
          ? {}
          : source.kind === "tracker-reconciliation"
            ? {
                source: {
                  ...source,
                  upstream: specDocumentFromIssue(
                    source.upstream.title,
                    source.upstream.description,
                  ),
                },
              }
            : { source }),
      } satisfies SpecRevisionCommitPayload;
    }
    const legacy = yield* decodeLegacySpecRevisionPayload(payload);
    return {
      document: specDocumentFromIssue(legacy.title, legacy.description),
    } satisfies SpecRevisionCommitPayload;
  },
);

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

/**
 * The ancestor path rendered for a rebuilt session: dialogue entries plus
 * the artifact text the path derives. Unknown commit kinds are skipped, the
 * same tolerance the planning projection has.
 */
const projectTranscript = Effect.fn("PlanningAssistant.projectTranscript")(function* (
  path: ReadonlyArray<Commit>,
) {
  const entries: Array<TranscriptEntry> = [];
  let planText = "";
  let spec: SpecDocument | null = null;
  for (const commit of path) {
    if (commit.kind === "message") {
      const payload = yield* decodeMessagePayload(commit.payload);
      entries.push({
        kind: "message",
        author: commit.authorKind,
        text: payload.text,
        ...(payload.interrupted === undefined ? {} : { interrupted: payload.interrupted }),
      });
    } else if (commit.kind === "plan-revision") {
      const payload = yield* decodeRevisionPayload(commit.payload);
      entries.push({ kind: "plan-revision", author: commit.authorKind });
      planText = payload.text;
    } else if (commit.kind === "spec-revision") {
      const payload = yield* decodeSpecRevisionPayload(commit.payload);
      entries.push({ kind: "spec-revision", author: commit.authorKind });
      spec = payload.document;
    }
  }
  return { entries, planText, spec };
});

/**
 * How long a stop waits for the adapter's own `turn.aborted` before settling
 * the interrupted commit itself. Long enough for a healthy abort round-trip;
 * short enough that a wedged provider cannot hold the plan hostage.
 */
const STOP_SETTLE_GRACE = Duration.seconds(5);

export const make = Effect.gen(function* () {
  const planningStore = yield* PlanningStore;
  const commits = yield* CommitStore.CommitStore;
  const registry = yield* PlanTurnRegistry;
  const workspaceSettings = yield* WorkspaceSettingsStore;
  const repositoryStore = yield* RepositoryStore.RepositoryStore;
  const memoryIndex = yield* MemoryIndex.MemoryIndex;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const providerService = yield* ProviderService.ProviderService;
  const orchestration = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;
  const lineRuntimeService = yield* LineRuntimeService;
  const lineRuntimes = yield* LineRuntimeStore;
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

  // Mutated only inside Effect.sync/gen blocks of this single service —
  // the same in-process discipline the provider adapters use for theirs.
  // Turns are keyed by their own identity — a plan can hold one per branch.
  const turns = new Map<PlanTurnId, TurnRuntime>();
  const memoryAmendmentProposals = new Map<PlanId, MemoryAmendmentProposal>();

  const turnsOfPlan = (planId: PlanId): Array<TurnRuntime> => {
    const result: Array<TurnRuntime> = [];
    for (const turn of turns.values()) {
      if (turn.planId === planId) result.push(turn);
    }
    return result;
  };

  const announceChange = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);
  const publishFrame = (planId: PlanId, frame: PlanStreamItem) =>
    PubSub.publish(framesPubSub, { planId, frame }).pipe(Effect.asVoid);

  const findTurnByThread = (threadId: ThreadId): TurnRuntime | undefined => {
    for (const turn of turns.values()) {
      if (turn.threadId === threadId) return turn;
    }
    return undefined;
  };

  const mintTurnId = crypto.randomUUIDv4.pipe(Effect.map(PlanTurnId.make));
  const commandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:planning-assistant-${tag}:${uuid}`)),
      Effect.orDie,
    );

  /**
   * Land the turn's one message commit and release everything the turn
   * holds. Total: a failing append still frees the plan — a wedged plan
   * would be strictly worse than a lost reply, and the failure is logged.
   */
  const settleTurn = Effect.fn("PlanningAssistant.settleTurn")(function* (
    turn: TurnRuntime,
    options: { readonly interrupted: boolean },
  ) {
    if (turn.settling) return;
    turn.settling = true;
    const planId = turn.planId;

    const claimed = (yield* registry.getTurns(planId)).find(
      (candidate) => candidate.turnId === turn.turnId,
    );
    const parentCommitId = claimed?.tipCommitId ?? turn.parentCommitId;

    const question =
      turn.askedQuestions.length === 0
        ? undefined
        : {
            questions: [...turn.askedQuestions],
            ...(turn.answers === undefined ? {} : { answers: turn.answers }),
          };

    const createdAt = yield* DateTime.now;
    const appended = yield* planningStore
      .appendAssistantMessage({
        planId,
        parentCommitId,
        text: turn.text,
        ...(options.interrupted ? { interrupted: true } : {}),
        ...(turn.grounding.length === 0 ? {} : { grounding: turn.grounding }),
        ...(turn.groundingScope === undefined ? {} : { groundingScope: turn.groundingScope }),
        ...(question === undefined ? {} : { question }),
        generatedBy: turn.modelSelection,
        createdAt,
      })
      .pipe(Effect.result);

    turns.delete(turn.turnId);
    yield* registry.close(planId, turn.turnId);

    if (Result.isFailure(appended)) {
      yield* Effect.logError("planning turn settle failed to commit", {
        planId,
        cause: appended.failure,
      });
    }

    yield* publishFrame(planId, { kind: "turn-settled", turnId: turn.turnId });
    yield* announceChange;
  });

  const settleMemoryAmendment = Effect.fn("PlanningAssistant.settleMemoryAmendment")(function* (
    turn: TurnRuntime,
  ) {
    if (turn.pendingMemoryAmendment === undefined) return;
    const amendment = turn.pendingMemoryAmendment;
    delete turn.pendingMemoryAmendment;
    if (turn.projectId === undefined) return;
    const prepared = yield* memoryIndex
      .prepareAmendment({ projectId: turn.projectId, turnId: turn.turnId, amendment })
      .pipe(Effect.result);
    if (Result.isFailure(prepared)) {
      const reason =
        prepared.failure._tag === "MemoryAmendmentValidationError"
          ? prepared.failure.reason
          : prepared.failure._tag === "MemoryNotDesignatedError"
            ? "This project has no designated memory."
            : "Project memory could not be prepared for review.";
      memoryAmendmentProposals.delete(turn.planId);
      yield* publishFrame(turn.planId, {
        kind: "memory-amendment-failed",
        turnId: turn.turnId,
        reason,
      });
    } else {
      memoryAmendmentProposals.set(turn.planId, prepared.success);
      yield* publishFrame(turn.planId, {
        kind: "memory-amendment-proposed",
        proposal: prepared.success,
      });
    }
    yield* announceChange;
  });

  const recordGrounding = Effect.fn("PlanningAssistant.recordGrounding")(function* (
    turn: TurnRuntime,
    event: ProviderRuntimeEvent,
  ) {
    const folded = foldGroundingEvent(event);
    if (folded === null || turn.groundingKeys.has(folded.key)) return;
    turn.groundingKeys.add(folded.key);
    if (turn.grounding.length >= MAX_GROUNDING_ITEMS) {
      // Record that the record stops here, once.
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

  const handleRuntimeEvent = Effect.fn("PlanningAssistant.handleRuntimeEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    const turn = findTurnByThread(event.threadId);
    if (turn === undefined || turn.settling) return;

    switch (event.type) {
      case "content.delta": {
        if (event.payload.streamKind !== "assistant_text") return;
        // The offset is what lets a joiner fold this idempotently against
        // its snapshot's partial text.
        const offset = turn.text.length;
        turn.text += event.payload.delta;
        yield* publishFrame(turn.planId, {
          kind: "turn-delta",
          turnId: turn.turnId,
          textDelta: event.payload.delta,
          offset,
        });
        return;
      }
      case "user-input.requested": {
        const questions = event.payload.questions.map(toPlanQuestion);
        turn.pendingQuestions = questions;
        turn.pendingRequestId =
          event.requestId === undefined
            ? undefined
            : ApprovalRequestId.make(String(event.requestId));
        turn.askedQuestions.push(...questions);
        yield* publishFrame(turn.planId, {
          kind: "turn-question",
          turnId: turn.turnId,
          questions,
        });
        yield* announceChange;
        return;
      }
      case "user-input.resolved": {
        // Usually the echo of answerQuestion, which already cleared the
        // pending state; this path covers a provider-side resolution.
        if (turn.pendingQuestions === undefined) return;
        turn.pendingQuestions = undefined;
        turn.pendingRequestId = undefined;
        turn.answers = { ...turn.answers, ...event.payload.answers };
        yield* publishFrame(turn.planId, {
          kind: "turn-question-answered",
          turnId: turn.turnId,
        });
        yield* announceChange;
        return;
      }
      case "request.opened": {
        yield* recordGrounding(turn, event);
        return;
      }
      case "turn.completed": {
        if (event.payload.state === "completed") yield* settleMemoryAmendment(turn);
        yield* settleTurn(turn, { interrupted: event.payload.state !== "completed" });
        return;
      }
      case "turn.aborted": {
        yield* settleTurn(turn, { interrupted: true });
        return;
      }
      case "session.exited": {
        // The session died under a live turn: the partial reply is what
        // there was, and the record says it was cut short.
        yield* settleTurn(turn, { interrupted: true });
        return;
      }
      default: {
        yield* recordGrounding(turn, event);
        return;
      }
    }
  });

  // One subscription for the service's lifetime; every planning turn's
  // events arrive here, keyed back to their turn by thread id.
  yield* Stream.runForEach(providerService.streamEvents, (event) =>
    handleRuntimeEvent(event).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("planning assistant runtime event failed", { cause }),
      ),
    ),
  ).pipe(Effect.forkScoped);

  const refuse = (planId: PlanId, reason: PlanTurnRefusalReason) =>
    publishFrame(planId, { kind: "turn-refused", reason });

  const repositoriesForProject = Effect.fn("PlanningAssistant.repositoriesForProject")(function* (
    projectId: MercurianProjectId,
  ) {
    const snapshot = yield* repositoryStore.getSnapshot;
    const repositoryIds = snapshot.projectRepositories
      .filter((link) => link.projectId === projectId)
      .map((link) => link.repositoryId);
    return repositoryIds.flatMap((repositoryId) => {
      const found = snapshot.repositories.find(
        (repository) => repository.repositoryId === repositoryId,
      );
      return found === undefined ? [] : [{ name: found.name, path: found.path }];
    });
  });

  const measureReconstruction: PlanningAssistant["Service"]["measureReconstruction"] = Effect.fn(
    "PlanningAssistant.measureReconstruction",
  )(function* (input) {
    const snapshot = yield* planningStore.getPlanSnapshot({ planId: input.planId });
    const repositories = yield* repositoriesForProject(snapshot.plan.projectId);
    const ancestors = yield* commits.ancestors({
      commitId: input.parentCommitId,
      visibility: "all",
    });
    const transcript = yield* projectTranscript(ancestors);
    const measured = measureTranscript(transcript);
    const appendix = planningSystemAppendix({
      planTitle: snapshot.plan.title,
      repositories,
      unreachableRepositories: [],
    });
    return {
      transcriptChars: measured.renderedEntryLengths.reduce((sum, length) => sum + length, 0),
      entryCount: measured.renderedEntryLengths.length,
      fixedReservedChars:
        appendix.length +
        measured.planSectionChars +
        measured.specSectionChars +
        TRANSCRIPT_FRAMING_MARGIN,
    };
  });

  const startTurn: PlanningAssistant["Service"]["startTurn"] = (input) =>
    Effect.gen(function* () {
      const effectiveSelection =
        input.ranUnder ?? (yield* workspaceSettings.getSnapshot).planningModel;
      const providers = yield* providerRegistry.getProviders;
      const resolution = resolvePlanningModel(effectiveSelection, providers);
      if (resolution._tag === "unset") {
        return yield* refuse(input.planId, "unset");
      }
      if (resolution._tag === "unresolved") {
        return yield* refuse(input.planId, resolution.reason);
      }
      const resolvedSelection = {
        provider: resolution.provider,
        model: resolution.model,
        ...(effectiveSelection?.options === undefined
          ? {}
          : { options: effectiveSelection.options }),
      } satisfies PlanningModelSelection;
      const snapshot = yield* planningStore.getPlanSnapshot({ planId: input.planId });
      const turnId = yield* mintTurnId;
      const placeholderThreadId = ThreadId.make(`mercurian-pending-${yield* crypto.randomUUIDv4}`);
      const claim = yield* registry
        .open({
          planId: input.planId,
          turnId,
          threadId: placeholderThreadId,
          parentCommitId: input.parentCommitId,
          tipCommitId: input.parentCommitId,
        })
        .pipe(Effect.result);
      if (Result.isFailure(claim)) {
        return yield* refuse(input.planId, "turn-active");
      }

      const turn: TurnRuntime = {
        planId: input.planId,
        turnId,
        threadId: placeholderThreadId,
        parentCommitId: input.parentCommitId,
        modelSelection: resolvedSelection,
        text: "",
        grounding: [],
        groundingKeys: new Set(),
        groundingScope: undefined,
        phase: "waiting-for-slot",
        pendingQuestions: undefined,
        pendingRequestId: undefined,
        askedQuestions: [],
        answers: undefined,
        settling: false,
        stopRequested: false,
        projectId: snapshot.plan.projectId,
      };
      turns.set(turnId, turn);

      yield* publishFrame(input.planId, {
        kind: "turn-started",
        turnId,
        parentCommitId: MercurianCommitId.make(input.parentCommitId),
        phase: "waiting-for-slot",
      });
      yield* announceChange;
      const runtimeMode = input.runtimeMode ?? "approval-required";
      const lineRootCommitId = lineRootCommitIdFor(snapshot, input.parentCommitId);
      const opened = yield* Effect.gen(function* () {
        const ensured = yield* lineRuntimeService.ensure({
          planId: input.planId,
          lineRootCommitId,
          runtimeMode,
          modelSelection: {
            instanceId: resolution.instanceId,
            model: resolution.model,
            ...(effectiveSelection?.options === undefined
              ? {}
              : { options: effectiveSelection.options }),
          },
          holder: { kind: "turn" },
        });
        if (!turns.has(turnId)) {
          yield* slotService.release(ensured.slotId, {
            kind: "turn",
            threadId: ensured.record.threadId,
          });
          return;
        }
        turn.threadId = ensured.record.threadId;
        turn.phase = "running";
        turn.groundingScope =
          ensured.record.unreachableRepositories.length === 0
            ? undefined
            : { unreachableRepositories: ensured.record.unreachableRepositories };
        yield* registry.reassignThread(input.planId, turnId, ensured.record.threadId);
        yield* publishFrame(input.planId, {
          kind: "turn-started",
          turnId,
          parentCommitId: MercurianCommitId.make(input.parentCommitId),
          phase: "running",
          ...(turn.groundingScope === undefined ? {} : { groundingScope: turn.groundingScope }),
        });
        const createdAt = DateTime.formatIso(yield* DateTime.now);
        yield* orchestration
          .dispatch({
            type: "thread.turn.start",
            commandId: yield* commandId("turn-start"),
            threadId: ensured.record.threadId,
            message: {
              messageId: MessageId.make(input.parentCommitId),
              role: "user",
              text: input.text,
              attachments: [...(input.attachments ?? [])],
            },
            modelSelection: {
              instanceId: resolution.instanceId,
              model: resolution.model,
              ...(effectiveSelection?.options === undefined
                ? {}
                : { options: effectiveSelection.options }),
            },
            runtimeMode,
            interactionMode: "default",
            createdAt,
          })
          .pipe(
            Effect.tapError(() =>
              slotService
                .release(ensured.slotId, { kind: "turn", threadId: ensured.record.threadId })
                .pipe(Effect.ignoreCause({ log: true })),
            ),
          );
      }).pipe(Effect.result);
      if (Result.isFailure(opened)) {
        // The message landed; the reply could not start. Release everything
        // and say why nothing is streaming — an empty interrupted commit
        // would claim a reply happened when none did.
        yield* Effect.logError("planning turn failed to start", {
          planId: input.planId,
          cause: opened.failure,
        });
        turns.delete(turnId);
        yield* registry.close(input.planId, turnId);
        yield* publishFrame(input.planId, { kind: "turn-settled", turnId });
        const lineBranchMissing = isLineBranchMissingError(opened.failure);
        const reason: PlanTurnRefusalReason = lineBranchMissing
          ? "line-branch-missing"
          : isRepositoryNotGitError(opened.failure)
            ? "repository-not-git"
            : "no-instance";
        if (lineBranchMissing) {
          const runtime = yield* lineRuntimes.getOrNone(input.planId, lineRootCommitId);
          if (Option.isSome(runtime)) {
            yield* lineRuntimes.recordLineBranchMissing(
              runtime.value.threadId,
              opened.failure.commitOid,
            );
          }
        }
        yield* refuse(input.planId, reason);
        yield* announceChange;
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("planning turn start failed", { planId: input.planId, cause }),
      ),
    );

  const stopTurn: PlanningAssistant["Service"]["stopTurn"] = ({ planId, turnId }) =>
    Effect.gen(function* () {
      const turn = turns.get(turnId);
      // Nothing to stop is not an error a person caused; a stale turn id from
      // a window that raced the settle is the same nothing.
      if (turn === undefined || turn.planId !== planId || turn.settling) return;
      turn.stopRequested = true;
      const shell = yield* projections
        .getThreadShellById(turn.threadId)
        .pipe(Effect.orElseSucceed(() => Option.none()));
      const activeTurn = Option.getOrUndefined(shell)?.latestTurn;
      const interrupted =
        activeTurn?.state === "running"
          ? yield* orchestration
              .dispatch({
                type: "thread.turn.interrupt",
                commandId: yield* commandId("turn-interrupt"),
                threadId: turn.threadId,
                turnId: activeTurn.turnId,
                createdAt: DateTime.formatIso(yield* DateTime.now),
              })
              .pipe(Effect.result)
          : Result.fail(new Error("orchestration turn is not running"));
      if (Result.isFailure(interrupted)) {
        // The session cannot be reached; settle what we have rather than
        // leaving the plan wedged behind a dead session.
        yield* Effect.logWarning("planning turn interrupt failed; settling directly", {
          planId,
          cause: interrupted.failure,
        });
        yield* settleTurn(turn, { interrupted: true });
        return;
      }
      // On success the adapter normally emits turn.aborted (or turn.completed
      // with an interrupted state) and the event pump settles exactly once.
      // A provider wedged mid-startup never answers, and the record must not
      // hang on its cooperation — stopping means the cut-short reply lands.
      // The grace window is only the polite wait for the adapter's own abort.
      const stoppedTurnId = turn.turnId;
      yield* Effect.sleep(STOP_SETTLE_GRACE).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const current = turns.get(stoppedTurnId);
            if (current === undefined || current.settling) {
              return;
            }
            yield* Effect.logWarning("planning turn abort unanswered; settling directly", {
              planId,
            });
            yield* settleTurn(current, { interrupted: true });
          }),
        ),
        Effect.forkDetach,
      );
    });

  const answerQuestion: PlanningAssistant["Service"]["answerQuestion"] = (input) =>
    Effect.gen(function* () {
      const turn = turns.get(input.turnId);
      if (
        turn === undefined ||
        turn.planId !== input.planId ||
        turn.settling ||
        turn.pendingQuestions === undefined ||
        turn.pendingRequestId === undefined
      ) {
        return yield* new NoPendingQuestionError({ planId: input.planId });
      }
      const requestId = turn.pendingRequestId;
      const answered = yield* orchestration
        .dispatch({
          type: "thread.user-input.respond",
          commandId: yield* commandId("user-input-respond"),
          threadId: turn.threadId,
          requestId,
          answers: input.answers as Record<string, unknown>,
          createdAt: DateTime.formatIso(yield* DateTime.now),
        })
        .pipe(Effect.result);
      if (Result.isFailure(answered)) {
        yield* Effect.logWarning("planning question answer failed to reach the provider", {
          planId: input.planId,
          cause: answered.failure,
        });
        return yield* new NoPendingQuestionError({ planId: input.planId });
      }
      turn.pendingQuestions = undefined;
      turn.pendingRequestId = undefined;
      turn.answers = { ...turn.answers, ...input.answers };
      yield* publishFrame(input.planId, {
        kind: "turn-question-answered",
        turnId: turn.turnId,
      });
      yield* announceChange;
    });

  const frames: PlanningAssistant["Service"]["frames"] = (planId) =>
    Stream.fromPubSub(framesPubSub).pipe(
      Stream.filter((published) => published.planId === planId),
      Stream.map((published) => published.frame),
    );

  const inFlightTurns: PlanningAssistant["Service"]["inFlightTurns"] = (planId) =>
    Effect.sync(() =>
      turnsOfPlan(planId)
        .filter((turn) => !turn.settling)
        .map(
          (turn) =>
            ({
              turnId: turn.turnId,
              parentCommitId: MercurianCommitId.make(turn.parentCommitId),
              text: turn.text,
              grounding: [...turn.grounding],
              phase: turn.phase,
              ...(turn.groundingScope === undefined ? {} : { groundingScope: turn.groundingScope }),
              ...(turn.pendingQuestions === undefined ? {} : { questions: turn.pendingQuestions }),
            }) satisfies PlanInFlightTurn,
        ),
    );

  const memoryAmendmentProposal: PlanningAssistant["Service"]["memoryAmendmentProposal"] = (
    planId,
  ) => Effect.sync(() => memoryAmendmentProposals.get(planId));

  const cancelMemoryAmendment: PlanningAssistant["Service"]["cancelMemoryAmendment"] = (planId) =>
    Effect.gen(function* () {
      const proposal = memoryAmendmentProposals.get(planId);
      if (proposal === undefined) return;
      memoryAmendmentProposals.delete(planId);
      yield* publishFrame(planId, {
        kind: "memory-amendment-cancelled",
        turnId: PlanTurnId.make(proposal.turnId),
      });
      yield* announceChange;
    });

  const clearMemoryAmendment: PlanningAssistant["Service"]["clearMemoryAmendment"] = (planId) =>
    Effect.sync(() => void memoryAmendmentProposals.delete(planId));

  const status: PlanningAssistant["Service"]["status"] = Effect.sync(() => {
    // One row per plan, aggregated across its concurrent turns: working while
    // any turn streams, awaiting input while any turn has a question up.
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

  const teardownPlan: PlanningAssistant["Service"]["teardownPlan"] = (input) =>
    Effect.gen(function* () {
      memoryAmendmentProposals.delete(input.planId);
      for (const turn of turnsOfPlan(input.planId)) {
        if (turn.settling) continue;
        if (input.commitPartial) {
          yield* settleTurn(turn, { interrupted: true });
        } else {
          turns.delete(turn.turnId);
          yield* registry.close(input.planId, turn.turnId);
          yield* publishFrame(input.planId, { kind: "turn-settled", turnId: turn.turnId });
          yield* announceChange;
        }
      }
      if (!input.commitPartial) {
        const runtimes = input.lineRuntimes ?? (yield* lineRuntimes.listByPlan(input.planId));
        let lastDeleteSequence: number | undefined;
        for (const runtime of runtimes) {
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
          const deleted = yield* Effect.exit(
            orchestration.dispatch({
              type: "thread.delete",
              commandId: yield* commandId("delete-line-thread"),
              threadId: runtime.threadId,
            }),
          );
          if (Exit.isSuccess(deleted)) {
            lastDeleteSequence = deleted.value.sequence;
          } else {
            yield* Effect.logWarning("Could not delete line thread during teardown.", {
              threadId: runtime.threadId,
              cause: deleted.cause,
            });
          }
        }
        if (lastDeleteSequence !== undefined) {
          yield* deletionReactor
            .drainThrough(lastDeleteSequence)
            .pipe(Effect.ignoreCause({ log: true }));
        }
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("planning teardown failed", { planId: input.planId, cause }),
      ),
    );

  const saveRevisionFromThread: PlanningAssistant["Service"]["saveRevisionFromThread"] = (input) =>
    Effect.gen(function* () {
      const claimed = yield* registry.getByThread(input.threadId);
      if (Option.isNone(claimed)) {
        return yield* new PlanningTurnNotFoundError({ threadId: input.threadId });
      }
      const turn = claimed.value;
      const createdAt = yield* DateTime.now;
      const revision = yield* planningStore
        .saveAssistantPlanRevision({
          planId: turn.planId,
          parentCommitId: turn.tipCommitId,
          text: input.text,
          createdAt,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logError("assistant plan revision failed", {
              planId: turn.planId,
              cause,
            }).pipe(Effect.andThen(new PlanningTurnNotFoundError({ threadId: input.threadId }))),
          ),
        );
      // The turn's chain stays linear: the next write parents on this one.
      yield* registry.advanceTip(turn.planId, turn.turnId, revision.commitId);
    });

  const saveSpecRevisionFromThread: PlanningAssistant["Service"]["saveSpecRevisionFromThread"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const claimed = yield* registry.getByThread(input.threadId);
      if (Option.isNone(claimed)) {
        return yield* new PlanningTurnNotFoundError({ threadId: input.threadId });
      }
      const turn = claimed.value;
      const createdAt = yield* DateTime.now;
      const revision = yield* planningStore
        .saveAssistantSpecRevision({
          planId: turn.planId,
          parentCommitId: turn.tipCommitId,
          document: input.document,
          createdAt,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logError("assistant spec revision failed", {
              planId: turn.planId,
              cause,
            }).pipe(Effect.andThen(new PlanningTurnNotFoundError({ threadId: input.threadId }))),
          ),
        );
      yield* registry.advanceTip(turn.planId, turn.turnId, revision.commitId);
    });

  const proposeMemoryAmendmentFromThread: PlanningAssistant["Service"]["proposeMemoryAmendmentFromThread"] =
    (input) =>
      Effect.gen(function* () {
        const claimed = yield* registry.getByThread(input.threadId);
        const runtime = findTurnByThread(input.threadId);
        if (Option.isNone(claimed) || runtime === undefined || runtime.settling) {
          return yield* new PlanningTurnNotFoundError({ threadId: input.threadId });
        }
        memoryAmendmentProposals.delete(runtime.planId);
        runtime.pendingMemoryAmendment = {
          title: input.title,
          notes: input.notes.map((note) => ({ ...note })),
          placements: input.placements.map((placement) => ({ ...placement })),
        };
      });

  const readPlanFromThread: PlanningAssistant["Service"]["readPlanFromThread"] = (input) =>
    Effect.gen(function* () {
      const claimed = yield* registry.getByThread(input.threadId);
      if (Option.isNone(claimed)) {
        return yield* new PlanningTurnNotFoundError({ threadId: input.threadId });
      }
      const turn = claimed.value;
      return yield* planningStore
        .getPlanTextAt({ planId: turn.planId, commitId: turn.tipCommitId })
        .pipe(
          Effect.catch((cause) =>
            Effect.logError("assistant plan read failed", { planId: turn.planId, cause }).pipe(
              Effect.andThen(new PlanningTurnNotFoundError({ threadId: input.threadId })),
            ),
          ),
        );
    });

  const readSpecFromThread: PlanningAssistant["Service"]["readSpecFromThread"] = (input) =>
    Effect.gen(function* () {
      const claimed = yield* registry.getByThread(input.threadId);
      if (Option.isNone(claimed)) {
        return yield* new PlanningTurnNotFoundError({ threadId: input.threadId });
      }
      const turn = claimed.value;
      return yield* planningStore
        .getSpecAt({ planId: turn.planId, commitId: turn.tipCommitId })
        .pipe(
          Effect.map((at) => at?.document ?? null),
          Effect.catch((cause) =>
            Effect.logError("assistant spec read failed", { planId: turn.planId, cause }).pipe(
              Effect.andThen(new PlanningTurnNotFoundError({ threadId: input.threadId })),
            ),
          ),
        );
    });

  return {
    startTurn,
    measureReconstruction,
    stopTurn,
    answerQuestion,
    frames,
    inFlightTurns,
    memoryAmendmentProposal,
    cancelMemoryAmendment,
    clearMemoryAmendment,
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
  } satisfies PlanningAssistant["Service"];
});

export const layer = Layer.effect(PlanningAssistant, make);

/**
 * PlanningAssistant — planning turns on the provider-session runtime.
 *
 * A reply in a planning space is one turn of a provider session: the human
 * message commits first, then this service generates the reply under the
 * workspace planning model, streams it as transient frames on the plan's
 * subscription, and lands exactly one message commit when the turn settles —
 * full text on completion, partial text marked interrupted on a stop or an
 * abnormal end. The commit is the record; everything here is runtime state
 * (ADR 002 §3), and a server restart rightly starts with no turns.
 *
 * The invariants this service enforces at the runtime, not in a prompt:
 *
 * - planning is mode-free and read-only. Sessions open at the most
 *   restrictive runtime mode, `interactionMode` is never passed, and every
 *   approval request is auto-answered — file reads and the two planning MCP
 *   artifact tools approved for the session, commands, file changes, and all
 *   other dynamic tools declined — so no approval ever surfaces and no
 *   filesystem write ever lands, whatever a provider tries;
 * - the assistant only ever continues from where things left off. A turn on
 *   the session's own tip rides the live session; a fork, a model change, or
 *   a dead session rebuilds a fresh session whose first turn carries the
 *   ancestor transcript. Structurally, the commit store's assistant-fork and
 *   assistant-merge refusals remain the guarantee;
 * - one turn per plan at a time, as a server fact: the {@link PlanTurnRegistry}
 *   claim is what both this service and the store's human-write guard read.
 *
 * @module PlanningAssistant
 */
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  ApprovalRequestId,
  ImplementBlockedError,
  MercurianCommitId,
  type MercurianProjectId,
  NoPendingQuestionError,
  type PlanGroundingItem,
  type PlanGroundingScope,
  type PlanId,
  type PlanImplementProposal,
  type PlanImplementReady,
  type PlanImplementVerdict,
  type PlanInFlightImplement,
  type PlanInFlightTurn,
  type PlanQuestion,
  type PlanStreamItem,
  PlanTurnActiveError,
  PlanTurnId,
  type PlanTurnRefusalReason,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  resolvePlanningModel,
  ThreadId,
  type UserInputQuestion,
} from "@t3tools/contracts";

import * as ProviderRegistry from "../../provider/Services/ProviderRegistry.ts";
import * as ProviderService from "../../provider/Services/ProviderService.ts";
import type { ProviderServiceError } from "../../provider/Errors.ts";
import type {
  ReadPlanTool,
  SaveImplementProposalTool,
  SavePlanRevisionTool,
} from "../../mcp/toolkits/planning/tools.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import { type Commit, type CommitId } from "../commitTree/schema.ts";
import {
  MessageCommitPayload,
  PlanningStore,
  PlanRevisionCommitPayload,
  type StoredPlanImplementVerdict,
  type PlanningStoreError,
} from "../planning/PlanningStore.ts";
import { PlanTurnRegistry } from "../planning/PlanTurnRegistry.ts";
import * as RepositoryStore from "../repositories/RepositoryStore.ts";
import {
  WorkspaceSettingsStore,
  type WorkspaceSettingsStoreError,
} from "../workspace/WorkspaceSettingsStore.ts";
import { foldGroundingEvent } from "./GroundingFold.ts";
import {
  composeFirstTurnInput,
  implementTurnInput,
  planningSystemAppendix,
  transcriptPreamble,
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
}

export interface TryImplementInput {
  readonly planId: PlanId;
  readonly parentCommitId?: CommitId;
}

export type TryImplementError =
  | PlanningStoreError
  | RepositoryStore.RepositoryStoreError
  | WorkspaceSettingsStoreError
  | CommitStore.CommitStoreError
  | ProviderServiceError
  | Schema.SchemaError
  | PlatformError.PlatformError
  | ImplementBlockedError;

export interface PendingImplementProposal {
  readonly repositories: ReadonlyArray<string>;
  readonly rationale?: string;
  readonly splits?: ReadonlyArray<{ readonly repository: string; readonly text: string }>;
}

export interface AnswerQuestionInput {
  readonly planId: PlanId;
  readonly answers: Readonly<Record<string, unknown>>;
}

/** A provider session bound to a plan, and the commit its context stands at. */
interface PlanSession {
  readonly threadId: ThreadId;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  /** The tip the session last settled on — what a continuation must extend. */
  readonly tipCommitId: CommitId;
}

/** The conversational state of one running turn. Mutated in place; single process. */
interface TurnRuntime {
  /** Keeps tool permissions explicit as additional one-shot turn shapes are introduced. */
  readonly flavor: "reply" | "implement";
  readonly planId: PlanId;
  readonly turnId: PlanTurnId;
  /** Mutable: a continuation whose session turned out dead moves threads. */
  threadId: ThreadId;
  readonly parentCommitId: CommitId;
  text: string;
  readonly grounding: Array<PlanGroundingItem>;
  readonly groundingKeys: Set<string>;
  /** Mutable: re-decided when a dead continuation falls back to a rebuild. */
  groundingScope: PlanGroundingScope | undefined;
  /** The question currently waiting, if any. */
  pendingQuestions: ReadonlyArray<PlanQuestion> | undefined;
  pendingRequestId: ApprovalRequestId | undefined;
  /** Every question this turn asked — the settled commit's record. */
  readonly askedQuestions: Array<PlanQuestion>;
  answers: Record<string, unknown> | undefined;
  /** Guards double settles: a stop racing the provider's own completion. */
  settling: boolean;
  /** Distinguishes a requested implement stop from an abnormal abort. */
  stopRequested: boolean;
  /** The implement MCP door's last complete proposal. */
  pendingProposal?: PendingImplementProposal;
  /** Project identity used to resolve proposal repository names at settle. */
  readonly projectId?: MercurianProjectId;
}

/**
 * Grounding beyond this is real but unrenderable; the fold stops recording
 * and the last entry says so, which keeps "what it looked at is shown"
 * honest without an unbounded wire payload.
 */
const MAX_GROUNDING_ITEMS = 200;

type PlanningMcpToolName =
  | typeof SavePlanRevisionTool.name
  | typeof SaveImplementProposalTool.name
  | typeof ReadPlanTool.name;
const APPROVED_PLANNING_MCP_TOOLS = [
  "save_plan_revision",
  "save_implement_proposal",
  "read_plan",
] as const satisfies ReadonlyArray<PlanningMcpToolName>;
const PLANNING_MCP_TOOL_PREFIXES = ["mcp__t3-code__", "t3-code_"] as const;
const decodePlanRevisionPayload = Schema.decodeUnknownEffect(PlanRevisionCommitPayload);

const normalizePlanningMcpToolName = (toolName: string): string | undefined => {
  const prefix = PLANNING_MCP_TOOL_PREFIXES.find((candidate) => toolName.startsWith(candidate));
  return prefix === undefined ? undefined : toolName.slice(prefix.length);
};

const isApprovedPlanningMcpToolName = (toolName: string): boolean => {
  const normalized = normalizePlanningMcpToolName(toolName);
  return (
    normalized !== undefined &&
    APPROVED_PLANNING_MCP_TOOLS.some((approved) => approved === normalized)
  );
};

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
    /** Analyze implementation coverage and publish a transient proposal. */
    readonly tryImplement: (input: TryImplementInput) => Effect.Effect<void, TryImplementError>;
    /**
     * Stop the streaming reply; the partial lands as a commit marked
     * interrupted. Idempotent when nothing is streaming.
     */
    readonly stopTurn: (input: { readonly planId: PlanId }) => Effect.Effect<void>;
    /** Answer the structured question the plan is waiting on. */
    readonly answerQuestion: (
      input: AnswerQuestionInput,
    ) => Effect.Effect<void, NoPendingQuestionError>;
    /**
     * The transient frames of this plan's turns. A fresh subscription per
     * access; frames are transport, never resumable (ADR 002 §3).
     */
    readonly frames: (planId: PlanId) => Stream.Stream<PlanStreamItem>;
    /** The partial turn for snapshot composition — join-mid-turn's source. */
    readonly inFlight: (planId: PlanId) => Effect.Effect<PlanInFlightTurn | undefined>;
    readonly inFlightImplement: (
      planId: PlanId,
    ) => Effect.Effect<PlanInFlightImplement | undefined>;
    readonly implementProposal: (
      planId: PlanId,
    ) => Effect.Effect<PlanImplementProposal | undefined>;
    readonly cancelImplementProposal: (planId: PlanId) => Effect.Effect<void>;
    /** Clear a landed proposal after its split commits have become the stream signal. */
    readonly clearImplementProposal: (planId: PlanId) => Effect.Effect<void>;
    /** Publish a ready verdict that the store has already made durable. */
    readonly publishImplementReady: (input: {
      readonly planId: PlanId;
      readonly ready: PlanImplementReady;
    }) => Effect.Effect<void>;
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
    readonly saveImplementProposalFromThread: (input: {
      readonly threadId: ThreadId;
      readonly repositories: ReadonlyArray<string>;
      readonly rationale?: string;
      readonly splits?: ReadonlyArray<{ readonly repository: string; readonly text: string }>;
    }) => Effect.Effect<void, PlanningTurnNotFoundError>;
    /** The MCP read door: the artifact's text at the calling turn's tip. */
    readonly readPlanFromThread: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<string, PlanningTurnNotFoundError>;
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
    }
  }
  return { entries, planText };
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
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const providerService = yield* ProviderService.ProviderService;
  const crypto = yield* Crypto.Crypto;

  const framesPubSub = yield* PubSub.unbounded<{
    readonly planId: PlanId;
    readonly frame: PlanStreamItem;
  }>();
  const changesPubSub = yield* PubSub.unbounded<void>();

  // Mutated only inside Effect.sync/gen blocks of this single service —
  // the same in-process discipline the provider adapters use for theirs.
  const turns = new Map<PlanId, TurnRuntime>();
  const sessions = new Map<PlanId, PlanSession>();
  const proposals = new Map<PlanId, PlanImplementProposal>();

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
  const mintThreadId = crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => ThreadId.make(`mercurian-plan-${uuid}`)),
  );

  const publishShortCircuit = Effect.fn("PlanningAssistant.publishShortCircuit")(function* (input: {
    readonly planId: PlanId;
    readonly parentCommitId: CommitId;
    readonly verdict: PlanImplementVerdict;
  }) {
    const proposal = {
      turnId: yield* mintTurnId,
      parentCommitId: MercurianCommitId.make(input.parentCommitId),
      verdict: input.verdict,
    } satisfies PlanImplementProposal;
    proposals.set(input.planId, proposal);
    yield* publishFrame(input.planId, { kind: "implement-analyzed", proposal });
    yield* announceChange;
  });

  /**
   * Land the turn's one message commit and release everything the turn
   * holds. Total: a failing append still frees the plan — a wedged plan
   * would be strictly worse than a lost reply, and the failure is logged.
   */
  const settleTurn = Effect.fn("PlanningAssistant.settleTurn")(function* (
    planId: PlanId,
    options: { readonly interrupted: boolean },
  ) {
    const turn = turns.get(planId);
    if (turn === undefined || turn.settling) return;
    turn.settling = true;

    const claimed = yield* registry.get(planId);
    const parentCommitId = Option.isSome(claimed) ? claimed.value.tipCommitId : turn.parentCommitId;

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
        createdAt,
      })
      .pipe(Effect.result);

    turns.delete(planId);
    yield* registry.close(planId);

    if (Result.isSuccess(appended)) {
      const session = sessions.get(planId);
      if (session?.threadId === turn.threadId) {
        sessions.set(planId, { ...session, tipCommitId: appended.success.commitId });
      }
    } else {
      // The session's context now holds a reply the history does not. Drop
      // the binding so the next turn rebuilds from the real record.
      sessions.delete(planId);
      yield* Effect.logError("planning turn settle failed to commit", {
        planId,
        cause: appended.failure,
      });
    }

    yield* publishFrame(planId, { kind: "turn-settled", turnId: turn.turnId });
    yield* announceChange;
  });

  /**
   * Validate and publish an implement result. A node exists only when its
   * content differs from its parent, so a ready answer records the side-fact
   * and never copies the plan into a new revision.
   */
  const settleImplement = Effect.fn("PlanningAssistant.settleImplement")(function* (
    planId: PlanId,
    outcome: "completed" | "stopped" | "provider-error",
  ) {
    const turn = turns.get(planId);
    if (turn === undefined || turn.flavor !== "implement" || turn.settling) return;
    turn.settling = true;

    let failureReason:
      | "no-proposal"
      | "invalid-proposal"
      | "stopped"
      | "provider-error"
      | undefined;
    let proposal: PlanImplementProposal | undefined;
    if (outcome === "stopped") {
      failureReason = "stopped";
    } else if (outcome === "provider-error" || turn.projectId === undefined) {
      failureReason = "provider-error";
    } else if (turn.pendingProposal === undefined) {
      failureReason = "no-proposal";
    } else {
      const repositorySnapshot = yield* repositoryStore.getSnapshot.pipe(Effect.result);
      if (Result.isFailure(repositorySnapshot)) {
        failureReason = "provider-error";
      } else {
        const linkedIds = new Set(
          repositorySnapshot.success.projectRepositories
            .filter((link) => link.projectId === turn.projectId)
            .map((link) => link.repositoryId),
        );
        const linkedRepositories = repositorySnapshot.success.repositories.filter((repository) =>
          linkedIds.has(repository.repositoryId),
        );
        const coverageNames = [...turn.pendingProposal.repositories];
        const uniqueCoverage = new Set(coverageNames);
        const resolvedCoverage = coverageNames.map((name) =>
          linkedRepositories.filter((repository) => repository.name === name),
        );
        if (
          coverageNames.length === 0 ||
          uniqueCoverage.size !== coverageNames.length ||
          resolvedCoverage.some((matches) => matches.length !== 1)
        ) {
          failureReason = "invalid-proposal";
        } else if (coverageNames.length === 1) {
          if ((turn.pendingProposal.splits?.length ?? 0) !== 0) {
            failureReason = "invalid-proposal";
          } else {
            const repository = resolvedCoverage[0]![0]!;
            proposal = {
              turnId: turn.turnId,
              parentCommitId: MercurianCommitId.make(turn.parentCommitId),
              verdict: {
                kind: "atomic",
                repositoryId: repository.repositoryId,
                repositoryName: repository.name,
              },
            };
          }
        } else {
          const splits = turn.pendingProposal.splits;
          const splitNames = splits?.map((split) => split.repository) ?? [];
          const splitNameSet = new Set(splitNames);
          if (
            splits === undefined ||
            splits.length !== coverageNames.length ||
            splitNameSet.size !== splits.length ||
            coverageNames.some((name) => !splitNameSet.has(name))
          ) {
            failureReason = "invalid-proposal";
          } else {
            const projected = splits.map((split) => {
              const repository = linkedRepositories.find(
                (candidate) => candidate.name === split.repository,
              )!;
              return {
                repositoryId: repository.repositoryId,
                repositoryName: repository.name,
                text: split.text,
              };
            });
            const first = projected[0]!;
            proposal = {
              turnId: turn.turnId,
              parentCommitId: MercurianCommitId.make(turn.parentCommitId),
              verdict: {
                kind: "needs-split",
                ...(turn.pendingProposal.rationale === undefined
                  ? {}
                  : { rationale: turn.pendingProposal.rationale }),
                splits: [first, ...projected.slice(1)],
              },
            };
          }
        }
      }
    }

    let ready: PlanImplementReady | undefined;
    if (proposal !== undefined && proposal.verdict.kind !== "already-covered") {
      const verdict: StoredPlanImplementVerdict =
        proposal.verdict.kind === "atomic"
          ? {
              kind: "ready",
              payload: {
                repositoryId: proposal.verdict.repositoryId,
                repositoryName: proposal.verdict.repositoryName,
              },
            }
          : {
              kind: "needs-split",
              payload: {
                repositories: [
                  {
                    repositoryId: proposal.verdict.splits[0].repositoryId,
                    repositoryName: proposal.verdict.splits[0].repositoryName,
                  },
                  ...proposal.verdict.splits.slice(1).map((split) => ({
                    repositoryId: split.repositoryId,
                    repositoryName: split.repositoryName,
                  })),
                ],
                ...(proposal.verdict.rationale === undefined
                  ? {}
                  : { rationale: proposal.verdict.rationale }),
              },
            };
      const recordedAt = yield* DateTime.now;
      const recorded = yield* planningStore
        .recordImplementVerdict({
          planId,
          commitId: turn.parentCommitId,
          verdict,
          recordedAt,
        })
        .pipe(Effect.result);
      if (Result.isFailure(recorded)) {
        yield* Effect.logError("implement verdict failed to record", {
          planId,
          cause: recorded.failure,
        });
        proposal = undefined;
        failureReason = "provider-error";
      } else if (verdict.kind === "ready") {
        ready = {
          commitId: MercurianCommitId.make(turn.parentCommitId),
          ...verdict.payload,
        };
      }
    }

    turns.delete(planId);
    sessions.delete(planId);
    yield* registry.close(planId);
    if (proposal === undefined) {
      proposals.delete(planId);
      yield* publishFrame(planId, {
        kind: "implement-failed",
        turnId: turn.turnId,
        reason: failureReason ?? "provider-error",
      });
    } else {
      proposals.set(planId, proposal);
      yield* publishFrame(planId, { kind: "implement-analyzed", proposal });
      if (ready !== undefined) {
        yield* publishFrame(planId, { kind: "implement-ready", ready });
      }
    }
    yield* providerService
      .stopSession({ threadId: turn.threadId })
      .pipe(Effect.catch(() => Effect.void));
    yield* announceChange;
  });

  /** The auto-answer policy: reads and the planning artifact door approved, all else declined. */
  const respondToApproval = Effect.fn("PlanningAssistant.respondToApproval")(function* (
    turn: TurnRuntime,
    event: ProviderRuntimeEvent & { readonly type: "request.opened" },
  ) {
    if (event.requestId === undefined) return;
    // Token refreshes are the adapter's own plumbing, not a permission ask.
    if (event.payload.requestType === "auth_tokens_refresh") return;
    const args = event.payload.args;
    const dynamicToolName =
      typeof args === "object" &&
      args !== null &&
      "toolName" in args &&
      typeof args.toolName === "string"
        ? args.toolName
        : undefined;
    const approvesPlanningMcpTool =
      event.payload.requestType === "dynamic_tool_call" &&
      dynamicToolName !== undefined &&
      isApprovedPlanningMcpToolName(dynamicToolName);
    const decision =
      event.payload.requestType === "file_read_approval" || approvesPlanningMcpTool
        ? "acceptForSession"
        : "decline";
    yield* providerService
      .respondToRequest({
        threadId: turn.threadId,
        // The runtime event's request id is the approval id on the answer path.
        requestId: ApprovalRequestId.make(String(event.requestId)),
        decision,
      })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("planning approval auto-response failed", {
            planId: turn.planId,
            requestType: event.payload.requestType,
            cause,
          }),
        ),
      );
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
        if (turn.flavor === "implement") return;
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
        if (turn.flavor === "implement") {
          if (event.requestId !== undefined) {
            yield* providerService
              .respondToUserInput({
                threadId: turn.threadId,
                requestId: ApprovalRequestId.make(String(event.requestId)),
                answers: {},
              })
              .pipe(Effect.catch(() => Effect.void));
          }
          return;
        }
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
        yield* respondToApproval(turn, event);
        yield* recordGrounding(turn, event);
        return;
      }
      case "turn.completed": {
        if (turn.flavor === "implement") {
          yield* settleImplement(
            turn.planId,
            event.payload.state === "completed" ? "completed" : "provider-error",
          );
        } else {
          yield* settleTurn(turn.planId, { interrupted: event.payload.state !== "completed" });
        }
        return;
      }
      case "turn.aborted": {
        if (turn.flavor === "implement") {
          yield* settleImplement(turn.planId, turn.stopRequested ? "stopped" : "provider-error");
        } else {
          yield* settleTurn(turn.planId, { interrupted: true });
        }
        return;
      }
      case "session.exited": {
        // The session died under a live turn: the partial reply is what
        // there was, and the record says it was cut short.
        sessions.delete(turn.planId);
        if (turn.flavor === "implement") {
          yield* settleImplement(turn.planId, turn.stopRequested ? "stopped" : "provider-error");
        } else {
          yield* settleTurn(turn.planId, { interrupted: true });
        }
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

  /**
   * Everything a fresh session needs, assembled before any provider call:
   * grounding roots narrowed to the capability, the ancestor transcript, and
   * the first turn's whole input.
   */
  const buildRebuildMaterials = Effect.fn("PlanningAssistant.buildRebuildMaterials")(
    function* (input: {
      readonly planId: PlanId;
      readonly parentCommitId: CommitId;
      readonly text: string;
      readonly planTitle: string;
      readonly projectId: MercurianProjectId;
      readonly instanceId: ProviderInstanceId;
      readonly model: string;
    }) {
      const repositoriesSnapshot = yield* repositoryStore.getSnapshot;
      const projectRepositoryIds = repositoriesSnapshot.projectRepositories
        .filter((link) => link.projectId === input.projectId)
        .map((link) => link.repositoryId);
      const repositories = projectRepositoryIds.flatMap((repositoryId) => {
        const found = repositoriesSnapshot.repositories.find(
          (repository) => repository.repositoryId === repositoryId,
        );
        return found === undefined ? [] : [{ name: found.name, path: found.path }];
      });

      const capabilities = yield* providerService.getCapabilities(input.instanceId);
      // Narrowed, and visibly so: a cwd-only provider grounds the first
      // repository alone, and the turn carries which ones were out of reach —
      // silent narrowing is exactly what "grounding is visible" forbids.
      const reachable =
        capabilities.groundingRoots === "multi" ? repositories : repositories.slice(0, 1);
      const unreachable =
        capabilities.groundingRoots === "multi"
          ? []
          : repositories.slice(1).map((repository) => repository.name);
      const groundingScope: PlanGroundingScope | undefined =
        unreachable.length === 0 ? undefined : { unreachableRepositories: unreachable };

      const ancestors = yield* commits.ancestors({
        commitId: input.parentCommitId,
        visibility: "all",
      });
      const transcript = yield* projectTranscript(ancestors);

      const appendix = planningSystemAppendix({
        planTitle: input.planTitle,
        repositories: reachable,
        unreachableRepositories: unreachable,
      });
      const preamble =
        transcript.entries.length === 0
          ? null
          : transcriptPreamble({
              entries: transcript.entries,
              planText: transcript.planText,
              reservedChars: appendix.length + input.text.length,
            });

      const threadId = yield* mintThreadId;
      return {
        threadId,
        groundingScope,
        repositories,
        cwd: reachable[0]?.path,
        additionalDirectories: reachable.slice(1).map((repository) => repository.path),
        firstTurnInput: composeFirstTurnInput({ appendix, preamble, message: input.text }),
      } satisfies RebuildMaterials;
    },
  );

  interface RebuildMaterials {
    readonly threadId: ThreadId;
    readonly groundingScope: PlanGroundingScope | undefined;
    readonly repositories: ReadonlyArray<{ readonly name: string; readonly path: string }>;
    readonly cwd: string | undefined;
    readonly additionalDirectories: ReadonlyArray<string>;
    readonly firstTurnInput: string;
  }

  /** Open the fresh session the materials describe and send its first turn. */
  const runRebuild = Effect.fn("PlanningAssistant.runRebuild")(function* (input: {
    readonly planId: PlanId;
    readonly parentCommitId: CommitId;
    readonly instanceId: ProviderInstanceId;
    readonly model: string;
    readonly materials: RebuildMaterials;
  }) {
    const { materials } = input;
    yield* providerService.startSession(materials.threadId, {
      threadId: materials.threadId,
      providerInstanceId: input.instanceId,
      ...(materials.cwd === undefined ? {} : { cwd: materials.cwd }),
      ...(materials.additionalDirectories.length === 0
        ? {}
        : { additionalDirectories: materials.additionalDirectories }),
      modelSelection: { instanceId: input.instanceId, model: input.model },
      isolateProviderSettings: true,
      // The most restrictive tier the contract has; combined with the
      // approval auto-policy this is the read-only guarantee (Design §3).
      runtimeMode: "approval-required",
    });
    yield* providerService.sendTurn({
      threadId: materials.threadId,
      input: materials.firstTurnInput,
    });
    sessions.set(input.planId, {
      threadId: materials.threadId,
      instanceId: input.instanceId,
      model: input.model,
      tipCommitId: input.parentCommitId,
    });
  });

  const startTurn: PlanningAssistant["Service"]["startTurn"] = (input) =>
    Effect.gen(function* () {
      proposals.delete(input.planId);
      const settings = yield* workspaceSettings.getSnapshot;
      const providers = yield* providerRegistry.getProviders;
      const resolution = resolvePlanningModel(settings.planningModel, providers);
      if (resolution._tag === "unset") {
        return yield* refuse(input.planId, "unset");
      }
      if (resolution._tag === "unresolved") {
        return yield* refuse(input.planId, resolution.reason);
      }

      const snapshot = yield* planningStore.getPlanSnapshot({ planId: input.planId });
      const turnId = yield* mintTurnId;

      // Decide the session strategy structurally, before any provider call:
      // the live session continues only when the new message hangs from the
      // tip that session's context stands at, under the same resolved model.
      const existing = sessions.get(input.planId);
      const parent = yield* commits.getCommit({
        commitId: input.parentCommitId,
        visibility: "all",
      });
      const parentParents = Option.isSome(parent) ? parent.value.parents : [];
      const canContinue =
        existing !== undefined &&
        existing.instanceId === resolution.instanceId &&
        existing.model === resolution.model &&
        parentParents.includes(existing.tipCommitId);

      const materials = canContinue
        ? null
        : yield* buildRebuildMaterials({
            planId: input.planId,
            parentCommitId: input.parentCommitId,
            text: input.text,
            planTitle: snapshot.plan.title,
            projectId: snapshot.plan.projectId,
            instanceId: resolution.instanceId,
            model: resolution.model,
          });

      const threadId = materials === null ? existing!.threadId : materials.threadId;

      // Claim the plan before anything reaches the provider: from here on,
      // human writes refuse and the MCP door resolves this thread to this
      // turn — a tool call racing the first delta cannot slip past.
      const claim = yield* registry
        .open({
          flavor: "reply",
          planId: input.planId,
          turnId,
          threadId,
          parentCommitId: input.parentCommitId,
          tipCommitId: input.parentCommitId,
        })
        .pipe(Effect.result);
      if (Result.isFailure(claim)) {
        return yield* refuse(input.planId, "turn-active");
      }

      const turn: TurnRuntime = {
        flavor: "reply",
        planId: input.planId,
        turnId,
        threadId,
        parentCommitId: input.parentCommitId,
        text: "",
        grounding: [],
        groundingKeys: new Set(),
        groundingScope: materials?.groundingScope,
        pendingQuestions: undefined,
        pendingRequestId: undefined,
        askedQuestions: [],
        answers: undefined,
        settling: false,
        stopRequested: false,
      };
      turns.set(input.planId, turn);

      yield* publishFrame(input.planId, {
        kind: "turn-started",
        turnId,
        parentCommitId: MercurianCommitId.make(input.parentCommitId),
        ...(materials?.groundingScope === undefined
          ? {}
          : { groundingScope: materials.groundingScope }),
      });
      yield* announceChange;

      // The provider work, with one fallback: a continuation whose session
      // turned out dead moves the turn to a fresh session.
      const opened = yield* Effect.gen(function* () {
        if (materials !== null) {
          if (existing !== undefined) {
            sessions.delete(input.planId);
            yield* providerService
              .stopSession({ threadId: existing.threadId })
              .pipe(Effect.catch(() => Effect.void));
          }
          return yield* runRebuild({
            planId: input.planId,
            parentCommitId: input.parentCommitId,
            instanceId: resolution.instanceId,
            model: resolution.model,
            materials,
          });
        }

        const continued = yield* providerService
          .sendTurn({ threadId, input: input.text })
          .pipe(Effect.result);
        if (Result.isSuccess(continued)) {
          sessions.set(input.planId, { ...existing!, tipCommitId: input.parentCommitId });
          return;
        }
        yield* Effect.logInfo("planning session continuation failed; rebuilding", {
          planId: input.planId,
          cause: continued.failure,
        });
        const fallback = yield* buildRebuildMaterials({
          planId: input.planId,
          parentCommitId: input.parentCommitId,
          text: input.text,
          planTitle: snapshot.plan.title,
          projectId: snapshot.plan.projectId,
          instanceId: resolution.instanceId,
          model: resolution.model,
        });
        // Move the turn to the new thread before the old session is torn
        // down, so its exit event no longer matches this turn.
        turn.threadId = fallback.threadId;
        turn.groundingScope = fallback.groundingScope;
        yield* registry.reassignThread(input.planId, fallback.threadId);
        sessions.delete(input.planId);
        yield* providerService.stopSession({ threadId }).pipe(Effect.catch(() => Effect.void));
        yield* runRebuild({
          planId: input.planId,
          parentCommitId: input.parentCommitId,
          instanceId: resolution.instanceId,
          model: resolution.model,
          materials: fallback,
        });
      }).pipe(Effect.result);

      if (Result.isFailure(opened)) {
        // The message landed; the reply could not start. Release everything
        // and say why nothing is streaming — an empty interrupted commit
        // would claim a reply happened when none did.
        yield* Effect.logError("planning turn failed to start", {
          planId: input.planId,
          cause: opened.failure,
        });
        turns.delete(input.planId);
        yield* registry.close(input.planId);
        yield* publishFrame(input.planId, { kind: "turn-settled", turnId });
        yield* refuse(input.planId, "no-instance");
        yield* announceChange;
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("planning turn start failed", { planId: input.planId, cause }),
      ),
    );

  const tryImplement: PlanningAssistant["Service"]["tryImplement"] = (input) =>
    Effect.gen(function* () {
      proposals.delete(input.planId);
      const context = yield* planningStore.getImplementContext({
        planId: input.planId,
        ...(input.parentCommitId === undefined ? {} : { atCommitId: input.parentCommitId }),
      });
      const verdicts = yield* planningStore.listImplementVerdicts({ planId: input.planId });
      const recorded = verdicts.find((verdict) => verdict.commitId === context.atCommitId);
      if (recorded?.verdict.kind === "ready") {
        if (Option.isSome(yield* registry.get(input.planId))) {
          return yield* new PlanTurnActiveError({ planId: input.planId });
        }
        yield* publishShortCircuit({
          planId: input.planId,
          parentCommitId: context.atCommitId,
          verdict: {
            kind: "atomic",
            ...recorded.verdict.payload,
          },
        });
        return;
      }
      if (recorded?.verdict.kind === "needs-split") {
        const children = yield* commits.children({
          commitId: context.atCommitId,
          visibility: "all",
        });
        const coveredRepositoryIds = new Set<string>();
        for (const child of children) {
          if (child.kind !== "plan-revision") continue;
          const payload = yield* decodePlanRevisionPayload(child.payload);
          if (payload.split !== undefined) {
            coveredRepositoryIds.add(payload.split.repositoryId);
          }
        }
        if (
          recorded.verdict.payload.repositories.every((repository) =>
            coveredRepositoryIds.has(repository.repositoryId),
          )
        ) {
          if (Option.isSome(yield* registry.get(input.planId))) {
            return yield* new PlanTurnActiveError({ planId: input.planId });
          }
          yield* publishShortCircuit({
            planId: input.planId,
            parentCommitId: context.atCommitId,
            verdict: {
              kind: "already-covered",
              repositories: recorded.verdict.payload.repositories,
            },
          });
          return;
        }
      }

      if (context.planText.trim().length === 0) {
        return yield* new ImplementBlockedError({ reason: "plan-empty" });
      }

      const snapshot = yield* planningStore.getPlanSnapshot({ planId: input.planId });
      const settings = yield* workspaceSettings.getSnapshot;
      const providers = yield* providerRegistry.getProviders;
      const resolution = resolvePlanningModel(settings.planningModel, providers);
      if (resolution._tag === "unset") {
        return yield* new ImplementBlockedError({ reason: "model-unset" });
      }
      if (resolution._tag === "unresolved") {
        return yield* new ImplementBlockedError({ reason: resolution.reason });
      }

      const materials = yield* buildRebuildMaterials({
        planId: input.planId,
        parentCommitId: context.atCommitId,
        text: "",
        planTitle: snapshot.plan.title,
        projectId: snapshot.plan.projectId,
        instanceId: resolution.instanceId,
        model: resolution.model,
      });
      const turnId = yield* mintTurnId;
      yield* registry.open({
        flavor: "implement",
        planId: input.planId,
        turnId,
        threadId: materials.threadId,
        parentCommitId: context.atCommitId,
        tipCommitId: context.atCommitId,
      });

      const turn: TurnRuntime = {
        flavor: "implement",
        planId: input.planId,
        turnId,
        threadId: materials.threadId,
        parentCommitId: context.atCommitId,
        text: "",
        grounding: [],
        groundingKeys: new Set(),
        groundingScope: materials.groundingScope,
        pendingQuestions: undefined,
        pendingRequestId: undefined,
        askedQuestions: [],
        answers: undefined,
        settling: false,
        stopRequested: false,
        projectId: snapshot.plan.projectId,
      };
      turns.set(input.planId, turn);

      // Implement analyses are deliberately one-shot. An idle conversational
      // session for this plan must not survive beside the fresh analysis.
      const existingSession = sessions.get(input.planId);
      if (existingSession !== undefined) {
        sessions.delete(input.planId);
        yield* providerService
          .stopSession({ threadId: existingSession.threadId })
          .pipe(Effect.catch(() => Effect.void));
      }

      yield* publishFrame(input.planId, {
        kind: "implement-started",
        implement: {
          turnId,
          parentCommitId: MercurianCommitId.make(context.atCommitId),
          grounding: [],
          ...(materials.groundingScope === undefined
            ? {}
            : { groundingScope: materials.groundingScope }),
        },
      });
      yield* announceChange;

      const opened = yield* Effect.gen(function* () {
        yield* providerService.startSession(materials.threadId, {
          threadId: materials.threadId,
          providerInstanceId: resolution.instanceId,
          ...(materials.cwd === undefined ? {} : { cwd: materials.cwd }),
          ...(materials.additionalDirectories.length === 0
            ? {}
            : { additionalDirectories: materials.additionalDirectories }),
          modelSelection: { instanceId: resolution.instanceId, model: resolution.model },
          isolateProviderSettings: true,
          runtimeMode: "approval-required",
        });
        yield* providerService.sendTurn({
          threadId: materials.threadId,
          input: implementTurnInput({
            repositories: materials.repositories.map((repository) => repository.name),
            planText: context.planText,
          }),
        });
      }).pipe(Effect.result);

      if (Result.isFailure(opened)) {
        yield* Effect.logError("implement analysis failed to start", {
          planId: input.planId,
          cause: opened.failure,
        });
        yield* settleImplement(input.planId, "provider-error");
      }
    });

  const stopTurn: PlanningAssistant["Service"]["stopTurn"] = ({ planId }) =>
    Effect.gen(function* () {
      const turn = turns.get(planId);
      // Nothing to stop is not an error a person caused.
      if (turn === undefined || turn.settling) return;
      turn.stopRequested = true;
      const interrupted = yield* providerService
        .interruptTurn({ threadId: turn.threadId })
        .pipe(Effect.result);
      if (Result.isFailure(interrupted)) {
        // The session cannot be reached; settle what we have rather than
        // leaving the plan wedged behind a dead session.
        yield* Effect.logWarning("planning turn interrupt failed; settling directly", {
          planId,
          cause: interrupted.failure,
        });
        if (turn.flavor === "implement") {
          yield* settleImplement(planId, "stopped");
        } else {
          yield* settleTurn(planId, { interrupted: true });
        }
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
            const current = turns.get(planId);
            if (current === undefined || current.turnId !== stoppedTurnId || current.settling) {
              return;
            }
            yield* Effect.logWarning("planning turn abort unanswered; settling directly", {
              planId,
            });
            if (current.flavor === "implement") {
              yield* settleImplement(planId, "stopped");
            } else {
              yield* settleTurn(planId, { interrupted: true });
            }
          }),
        ),
        Effect.forkDetach,
      );
    });

  const answerQuestion: PlanningAssistant["Service"]["answerQuestion"] = (input) =>
    Effect.gen(function* () {
      const turn = turns.get(input.planId);
      if (
        turn === undefined ||
        turn.settling ||
        turn.pendingQuestions === undefined ||
        turn.pendingRequestId === undefined
      ) {
        return yield* new NoPendingQuestionError({ planId: input.planId });
      }
      const requestId = turn.pendingRequestId;
      const answered = yield* providerService
        .respondToUserInput({
          threadId: turn.threadId,
          requestId,
          answers: input.answers as Record<string, unknown>,
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

  const inFlight: PlanningAssistant["Service"]["inFlight"] = (planId) =>
    Effect.sync(() => {
      const turn = turns.get(planId);
      if (turn === undefined || turn.flavor !== "reply" || turn.settling) return undefined;
      return {
        turnId: turn.turnId,
        parentCommitId: MercurianCommitId.make(turn.parentCommitId),
        text: turn.text,
        grounding: [...turn.grounding],
        ...(turn.groundingScope === undefined ? {} : { groundingScope: turn.groundingScope }),
        ...(turn.pendingQuestions === undefined ? {} : { questions: turn.pendingQuestions }),
      } satisfies PlanInFlightTurn;
    });

  const inFlightImplement: PlanningAssistant["Service"]["inFlightImplement"] = (planId) =>
    Effect.sync(() => {
      const turn = turns.get(planId);
      if (turn === undefined || turn.flavor !== "implement" || turn.settling) return undefined;
      return {
        turnId: turn.turnId,
        parentCommitId: MercurianCommitId.make(turn.parentCommitId),
        grounding: [...turn.grounding],
        ...(turn.groundingScope === undefined ? {} : { groundingScope: turn.groundingScope }),
      } satisfies PlanInFlightImplement;
    });

  const implementProposal: PlanningAssistant["Service"]["implementProposal"] = (planId) =>
    Effect.sync(() => proposals.get(planId));

  const cancelImplementProposal: PlanningAssistant["Service"]["cancelImplementProposal"] = (
    planId,
  ) =>
    Effect.gen(function* () {
      const proposal = proposals.get(planId);
      if (proposal === undefined) return;
      proposals.delete(planId);
      yield* publishFrame(planId, {
        kind: "implement-cancelled",
        turnId: proposal.turnId,
      });
      yield* announceChange;
    });

  const clearImplementProposal: PlanningAssistant["Service"]["clearImplementProposal"] = (planId) =>
    Effect.sync(() => void proposals.delete(planId));

  const publishImplementReady: PlanningAssistant["Service"]["publishImplementReady"] = (input) =>
    publishFrame(input.planId, { kind: "implement-ready", ready: input.ready });

  const status: PlanningAssistant["Service"]["status"] = Effect.sync(() => {
    const result = new Map<PlanId, PlanTurnStatus>();
    for (const turn of turns.values()) {
      if (turn.settling) continue;
      const waiting = turn.flavor === "reply" && turn.pendingQuestions !== undefined;
      result.set(turn.planId, { isWorking: !waiting, hasPendingInput: waiting });
    }
    return result;
  });

  const teardownPlan: PlanningAssistant["Service"]["teardownPlan"] = (input) =>
    Effect.gen(function* () {
      proposals.delete(input.planId);
      const turn = turns.get(input.planId);
      if (turn !== undefined && !turn.settling) {
        if (turn.flavor === "implement") {
          yield* settleImplement(input.planId, "stopped");
        } else if (input.commitPartial) {
          yield* settleTurn(input.planId, { interrupted: true });
        } else {
          turns.delete(input.planId);
          yield* registry.close(input.planId);
          yield* publishFrame(input.planId, { kind: "turn-settled", turnId: turn.turnId });
          yield* announceChange;
        }
      }
      const session = sessions.get(input.planId);
      if (session !== undefined) {
        sessions.delete(input.planId);
        yield* providerService
          .stopSession({ threadId: session.threadId })
          .pipe(Effect.catch(() => Effect.void));
      }
    });

  const saveRevisionFromThread: PlanningAssistant["Service"]["saveRevisionFromThread"] = (input) =>
    Effect.gen(function* () {
      const claimed = yield* registry.getByThread(input.threadId);
      if (Option.isNone(claimed) || claimed.value.flavor !== "reply") {
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
      yield* registry.advanceTip(turn.planId, revision.commitId);
    });

  const saveImplementProposalFromThread: PlanningAssistant["Service"]["saveImplementProposalFromThread"] =
    (input) =>
      Effect.gen(function* () {
        const claimed = yield* registry.getByThread(input.threadId);
        const runtime = findTurnByThread(input.threadId);
        if (
          Option.isNone(claimed) ||
          claimed.value.flavor !== "implement" ||
          runtime === undefined ||
          runtime.flavor !== "implement" ||
          runtime.settling
        ) {
          return yield* new PlanningTurnNotFoundError({ threadId: input.threadId });
        }
        runtime.pendingProposal = {
          repositories: [...input.repositories],
          ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
          ...(input.splits === undefined ? {} : { splits: [...input.splits] }),
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

  return {
    startTurn,
    tryImplement,
    stopTurn,
    answerQuestion,
    frames,
    inFlight,
    inFlightImplement,
    implementProposal,
    cancelImplementProposal,
    clearImplementProposal,
    publishImplementReady,
    status,
    teardownPlan,
    saveRevisionFromThread,
    saveImplementProposalFromThread,
    readPlanFromThread,
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies PlanningAssistant["Service"];
});

export const layer = Layer.effect(PlanningAssistant, make);

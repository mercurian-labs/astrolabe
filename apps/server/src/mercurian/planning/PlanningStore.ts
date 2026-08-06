/**
 * PlanningStore — projects, plans, and the planning space over the commit DAG.
 *
 * Two rules shape the whole surface:
 *
 * - a plan is born with its first message. Creation takes the message and
 *   writes the history's root commit in the same act, so there is no way to
 *   ask for an empty plan and no empty rows to clean up afterwards;
 * - a plan owns exactly one planning space. `plans.history_id` is unique, and
 *   the store never hands out a history that a plan does not already name.
 *
 * The plan artifact follows from those: it has no table and no column. A plan
 * revision is a commit interleaved with messages in the one history, and the
 * artifact's current text is derived from that history — which is why there is
 * no way for a second plan, or a second edit log, to exist.
 *
 * Plans compose {@link CommitStore} rather than reimplementing it: the commit
 * graph keeps its own invariants, and a refusal from it passes through
 * untranslated so a planning bug reads as exactly what it is.
 *
 * @module PlanningStore
 */
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  ChatAttachment,
  MercurianProjectId,
  MercurianProjectNotFoundError,
  PlanDeleteBlockedError,
  PlanId,
  PlanNotFoundError,
} from "@t3tools/contracts";

import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";
import * as CommitStore from "../commitTree/CommitStore.ts";
import { type Commit, CommitAuthorKind, CommitId, HistoryId } from "../commitTree/schema.ts";
import { MercurianProject, Plan, PlanSummary } from "./schema.ts";

// ===============================
// Domain
// ===============================

/**
 * What a message commit carries.
 *
 * Attachments are metadata: the bytes live beside the other attachments this
 * server holds and are read back through the assets door by id. Optional
 * because every message written before images could ride one has to keep
 * decoding — the field's absence is not a different kind of message.
 */
export const MessageCommitPayload = Schema.Struct({
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
});
export type MessageCommitPayload = typeof MessageCommitPayload.Type;

/**
 * What a plan-revision commit carries: the plan's full text after the edit.
 *
 * A snapshot rather than a diff, deliberately. The artifact at any commit is
 * then the nearest revision at or above it — O(1), no patch replay to corrupt,
 * and a fork's text is just its own path's latest snapshot. Plans are
 * human-scale documents; the storage this costs is not scarce.
 */
export const PlanRevisionCommitPayload = Schema.Struct({ text: Schema.String });
export type PlanRevisionCommitPayload = typeof PlanRevisionCommitPayload.Type;

/**
 * What every projected commit carries whatever its kind: its place in the
 * order, its edges, its attribution, and whether it is shared yet. The last
 * two are the DAG explorer's whole input — it draws the history from these
 * rather than from a second read of the graph.
 */
const PlanCommitFields = {
  commitId: CommitId,
  sequence: Schema.Number,
  parents: Schema.Array(CommitId),
  published: Schema.Boolean,
  authorKind: CommitAuthorKind,
  createdAt: Schema.DateTimeUtcFromString,
} as const;

/** One commit on the planning space's path, as the conversation renders it. */
export const PlanMessage = Schema.Struct({
  ...PlanCommitFields,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
});
export type PlanMessage = typeof PlanMessage.Type;

/**
 * A direct edit of the plan, as the history records it. Attribution and place
 * in the order; the text it produced is the artifact, read as {@link PlanDetail.planText}
 * at the tip and as {@link PlanningStore.getPlanTextAt} anywhere earlier.
 */
export const PlanRevision = Schema.Struct(PlanCommitFields);
export type PlanRevision = typeof PlanRevision.Type;

/**
 * One item of the space's history. Messages and plan revisions interleave in a
 * single ordered list, because that is what they are in the store: commits of
 * the same standing in one history. There is no separate edit log.
 */
export type PlanTimelineItem =
  | ({ readonly _tag: "message" } & PlanMessage)
  | ({ readonly _tag: "plan-revision" } & PlanRevision);

/**
 * A projected commit, ready to emit as an event. `planText` rides along only
 * when the commit changed the artifact — a revision's payload *is* the new
 * current text, so a subscriber never has to recompute it.
 */
export interface PlanTimelineEvent {
  readonly item: PlanTimelineItem;
  readonly planText?: string;
}

export interface PlanDetail {
  readonly plan: PlanSummary;
  /** Derived from the history, never stored. `""` is a real state. */
  readonly planText: string;
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  /** The highest commit sequence this snapshot accounts for; `0` for none. */
  readonly snapshotSequence: number;
}

export interface PlanningTreeSnapshot {
  readonly projects: ReadonlyArray<MercurianProject>;
  /**
   * Newest first within each project — what the tree shows without expanding.
   * Archived plans ride along carrying their `archivedAt`: one live source
   * keeps the tree and the Archived page correct in every window at once.
   */
  readonly plans: ReadonlyArray<PlanSummary>;
}

/**
 * What a delete left behind for the boundary to finish: the ids of the images
 * its messages carried. The store owns rows, not files — the ws handler unlinks
 * the bytes exactly where {@link normalizePlanAttachments} wrote them.
 */
export interface PlanDeletion {
  readonly attachmentIds: ReadonlyArray<string>;
}

export type PlanningStoreRefusal =
  | MercurianProjectNotFoundError
  | PlanNotFoundError
  | PlanDeleteBlockedError;

export type PlanningStoreError =
  | PlanningStoreRefusal
  | CommitStore.CommitStoreError
  | PersistenceSqlError
  | PersistenceDecodeError;

// ===============================
// Inputs
// ===============================

export const CreateProjectInput = Schema.Struct({
  name: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
});
export type CreateProjectInput = typeof CreateProjectInput.Type;

export const CreatePlanInput = Schema.Struct({
  projectId: MercurianProjectId,
  /** The plan's first message. Its arrival *is* the plan's creation. */
  message: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  createdAt: Schema.DateTimeUtcFromString,
});
export type CreatePlanInput = typeof CreatePlanInput.Type;

/**
 * `parentCommitId` is the commit this act continues from — where the sender
 * stood. Absent means the space's tip. Naming a commit that already has a
 * child is a fork, and appending is the only way to make one.
 */
export const AppendMessageInput = Schema.Struct({
  planId: PlanId,
  text: Schema.String,
  parentCommitId: Schema.optional(CommitId),
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  createdAt: Schema.DateTimeUtcFromString,
});
export type AppendMessageInput = typeof AppendMessageInput.Type;

export const SavePlanRevisionInput = Schema.Struct({
  planId: PlanId,
  /** The artifact's whole text after the edit. Empty is legal — clearing is an edit. */
  text: Schema.String,
  /** Which branch the edit lands on. Absent means the space's tip. */
  parentCommitId: Schema.optional(CommitId),
  createdAt: Schema.DateTimeUtcFromString,
});
export type SavePlanRevisionInput = typeof SavePlanRevisionInput.Type;

export const GetPlanInput = Schema.Struct({ planId: PlanId });
export type GetPlanInput = typeof GetPlanInput.Type;

/**
 * When the plan left the tree. Only the first archive of a plan records one —
 * archiving again keeps the original stamp, so "archived 3 days ago" stays
 * true rather than resetting on a second click.
 */
export const ArchivePlanInput = Schema.Struct({
  planId: PlanId,
  archivedAt: Schema.DateTimeUtcFromString,
});
export type ArchivePlanInput = typeof ArchivePlanInput.Type;

export const UnarchivePlanInput = Schema.Struct({ planId: PlanId });
export type UnarchivePlanInput = typeof UnarchivePlanInput.Type;

export const DeletePlanInput = Schema.Struct({ planId: PlanId });
export type DeletePlanInput = typeof DeletePlanInput.Type;

export const ListTimelineSinceInput = Schema.Struct({
  planId: PlanId,
  afterSequence: Schema.Number,
});
export type ListTimelineSinceInput = typeof ListTimelineSinceInput.Type;

export const GetPlanTextAtInput = Schema.Struct({ planId: PlanId, commitId: CommitId });
export type GetPlanTextAtInput = typeof GetPlanTextAtInput.Type;

// ===============================
// Service
// ===============================

export class PlanningStore extends Context.Service<
  PlanningStore,
  {
    readonly createProject: (
      input: CreateProjectInput,
    ) => Effect.Effect<MercurianProject, PlanningStoreError>;
    /** Every project and plan the tree renders, in one value. */
    readonly getTreeSnapshot: Effect.Effect<PlanningTreeSnapshot, PlanningStoreError>;
    /**
     * Create a plan from its first message: a history rooted at that message,
     * then the plan row naming it.
     */
    readonly createPlan: (input: CreatePlanInput) => Effect.Effect<PlanDetail, PlanningStoreError>;
    /**
     * Append a message onto the commit the sender named, or onto the space's
     * tip when they named none. A commit that already has a child is a legal
     * parent: that append *is* the fork, and it is the only way one is made.
     * A parent outside this plan's history refuses as
     * {@link CommitStore.CommitNotFoundError}.
     */
    readonly appendMessage: (
      input: AppendMessageInput,
    ) => Effect.Effect<PlanMessage, PlanningStoreError>;
    /**
     * A human's direct edit of the plan, landed as a commit of the same
     * standing as a message on the branch they were standing on.
     */
    readonly savePlanRevision: (
      input: SavePlanRevisionInput,
    ) => Effect.Effect<PlanRevision, PlanningStoreError>;
    /**
     * Take the plan out of the tree without destroying anything. Idempotent —
     * a second archive keeps the first timestamp — and total for every plan,
     * published or not: archive is every plan's disappearance, and the only
     * one a published plan has.
     *
     * `updated_at` is deliberately untouched, so a restored plan returns to
     * its old place in the newest-first order rather than jumping to the top.
     */
    readonly archivePlan: (input: ArchivePlanInput) => Effect.Effect<void, PlanningStoreError>;
    /** Put an archived plan back in its project. Idempotent on an active plan. */
    readonly unarchivePlan: (input: UnarchivePlanInput) => Effect.Effect<void, PlanningStoreError>;
    /**
     * Destroy the plan: its row, its commits, their edges, and the history
     * itself, in one act. Refuses with {@link PlanDeleteBlockedError} once any
     * commit of the history is published — before that crossing the work was
     * only ever the author's, and deleting it leaves no trace for a later
     * re-import of its origin to find.
     */
    readonly deletePlan: (
      input: DeletePlanInput,
    ) => Effect.Effect<PlanDeletion, PlanningStoreError>;
    /** The planning space whole: the artifact, its history, and a cursor. */
    readonly getPlanSnapshot: (
      input: GetPlanInput,
    ) => Effect.Effect<PlanDetail, PlanningStoreError>;
    /** What the space gained after a cursor — the subscription's event read. */
    readonly listTimelineSince: (
      input: ListTimelineSinceInput,
    ) => Effect.Effect<ReadonlyArray<PlanTimelineEvent>, PlanningStoreError>;
    /**
     * The artifact as of one commit: the last revision at or above it on the
     * path, `""` when there is none. A commit outside this plan's history does
     * not exist *for this plan* and refuses as {@link CommitStore.CommitNotFoundError}.
     */
    readonly getPlanTextAt: (
      input: GetPlanTextAtInput,
    ) => Effect.Effect<string, PlanningStoreError>;
    /** Fires once per mutation. What keeps a subscribed tree and plan fresh. */
    readonly changes: Stream.Stream<void>;
  }
>()("t3/mercurian/planning/PlanningStore") {}

// ===============================
// Rows
// ===============================

const ProjectRow = Schema.Struct({
  projectId: MercurianProjectId,
  name: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

const PlanRowFields = {
  planId: PlanId,
  projectId: MercurianProjectId,
  historyId: HistoryId,
  title: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  archivedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
} as const;

const PlanRow = Schema.Struct(PlanRowFields);

/**
 * A plan row as every read takes it: the columns, plus sqlite's answer to
 * "is any of this history published" as the 0/1 an `EXISTS` yields.
 */
const PlanSummaryRow = Schema.Struct({
  ...PlanRowFields,
  hasPublishedCommits: Schema.Number,
});

const ProjectIdRequest = Schema.Struct({ projectId: MercurianProjectId });
const PlanIdRequest = Schema.Struct({ planId: PlanId });
const HistoryIdRequest = Schema.Struct({ historyId: HistoryId });
const TouchPlanRequest = Schema.Struct({
  planId: PlanId,
  updatedAt: Schema.DateTimeUtcFromString,
});
const NoRequest = Schema.Struct({});

const PLAN_TITLE_MAX_LENGTH = 80;
const UNTITLED_PLAN = "Untitled plan";

/**
 * A legible row today, not the vault's self-titling — that is an assistant
 * behavior, and the first line of the first message is what a person would
 * recognize the plan by in the meantime.
 */
export function derivePlanTitle(message: string): string {
  const firstLine = message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) {
    return UNTITLED_PLAN;
  }
  return firstLine.length <= PLAN_TITLE_MAX_LENGTH
    ? firstLine
    : `${firstLine.slice(0, PLAN_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

const isPlanningStoreRefusal = Schema.is(
  Schema.Union([MercurianProjectNotFoundError, PlanNotFoundError, PlanDeleteBlockedError]),
);

function toPlanningStoreError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): PlanningStoreError =>
    isPlanningStoreRefusal(cause) || CommitStore.isCommitStoreRefusal(cause)
      ? cause
      : Schema.isSchemaError(cause)
        ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
        : isPersistenceError(cause)
          ? cause
          : new PersistenceSqlError({ operation: sqlOperation, cause });
}

const decodeMessagePayload = Schema.decodeUnknownEffect(MessageCommitPayload);
const decodeRevisionPayload = Schema.decodeUnknownEffect(PlanRevisionCommitPayload);

/**
 * The artifact at the end of a path: the text of the last revision on it, or
 * the empty string when there is none.
 *
 * Written as a fold over whatever the path holds rather than as a rule about
 * where revisions sit, so it stays total. A plan born blank has no revision
 * and derives `""` — the empty artifact. An imported plan whose root *is* a
 * revision derives that root. Nothing assumes a blank root.
 */
function derivePlanText(events: ReadonlyArray<PlanTimelineEvent>): string {
  let text = "";
  for (const event of events) {
    if (event.planText !== undefined) {
      text = event.planText;
    }
  }
  return text;
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const commits = yield* CommitStore.CommitStore;
  const crypto = yield* Crypto.Crypto;
  const changesPubSub = yield* PubSub.unbounded<void>();

  const announceChange = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);

  const insertProjectRow = SqlSchema.void({
    Request: ProjectRow,
    execute: (row) => sql`
      INSERT INTO projects (project_id, name, created_at, updated_at)
      VALUES (${row.projectId}, ${row.name}, ${row.createdAt}, ${row.updatedAt})
    `,
  });

  const findProjectRow = SqlSchema.findOneOption({
    Request: ProjectIdRequest,
    Result: ProjectRow,
    execute: ({ projectId }) => sql`
      SELECT
        project_id AS "projectId",
        name AS "name",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projects
      WHERE project_id = ${projectId}
    `,
  });

  const listProjectRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: ProjectRow,
    execute: () => sql`
      SELECT
        project_id AS "projectId",
        name AS "name",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projects
      ORDER BY created_at ASC, project_id ASC
    `,
  });

  /**
   * The lifecycle rule, asked of the commit graph on every read of a plan: a
   * plan is fully private exactly while no commit of its history is published.
   * There is no column to keep in step, so the answer flips the moment
   * publishing (or an imported plan's published root) lands.
   */
  const planColumns = sql`
    plan_id AS "planId",
    project_id AS "projectId",
    history_id AS "historyId",
    title AS "title",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    archived_at AS "archivedAt",
    EXISTS (
      SELECT 1 FROM commits
      WHERE commits.history_id = plans.history_id AND commits.published = 1
    ) AS "hasPublishedCommits"
  `;

  const insertPlanRow = SqlSchema.void({
    Request: PlanRow,
    execute: (row) => sql`
      INSERT INTO plans (
        plan_id, project_id, history_id, title, created_at, updated_at, archived_at
      )
      VALUES (
        ${row.planId},
        ${row.projectId},
        ${row.historyId},
        ${row.title},
        ${row.createdAt},
        ${row.updatedAt},
        ${row.archivedAt}
      )
    `,
  });

  const findPlanRow = SqlSchema.findOneOption({
    Request: PlanIdRequest,
    Result: PlanSummaryRow,
    execute: ({ planId }) => sql`
      SELECT ${planColumns}
      FROM plans
      WHERE plan_id = ${planId}
    `,
  });

  const listPlanRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: PlanSummaryRow,
    execute: () => sql`
      SELECT ${planColumns}
      FROM plans
      ORDER BY project_id ASC, updated_at DESC, plan_id ASC
    `,
  });

  const touchPlanRow = SqlSchema.void({
    Request: TouchPlanRequest,
    execute: ({ planId, updatedAt }) => sql`
      UPDATE plans SET updated_at = ${updatedAt} WHERE plan_id = ${planId}
    `,
  });

  const archivePlanRow = SqlSchema.void({
    Request: ArchivePlanInput,
    execute: ({ planId, archivedAt }) => sql`
      UPDATE plans
      SET archived_at = ${archivedAt}
      WHERE plan_id = ${planId} AND archived_at IS NULL
    `,
  });

  const unarchivePlanRow = SqlSchema.void({
    Request: PlanIdRequest,
    execute: ({ planId }) => sql`
      UPDATE plans SET archived_at = NULL WHERE plan_id = ${planId}
    `,
  });

  // Edges before commits before the history they hang from: the delete walks
  // the foreign keys inwards so nothing is ever momentarily orphaned.
  const deleteCommitParentRows = SqlSchema.void({
    Request: HistoryIdRequest,
    execute: ({ historyId }) => sql`
      DELETE FROM commit_parents
      WHERE commit_id IN (SELECT commit_id FROM commits WHERE history_id = ${historyId})
    `,
  });

  const deletePlanRow = SqlSchema.void({
    Request: PlanIdRequest,
    execute: ({ planId }) => sql`DELETE FROM plans WHERE plan_id = ${planId}`,
  });

  const deleteCommitRows = SqlSchema.void({
    Request: HistoryIdRequest,
    execute: ({ historyId }) => sql`DELETE FROM commits WHERE history_id = ${historyId}`,
  });

  const deleteHistoryRow = SqlSchema.void({
    Request: HistoryIdRequest,
    execute: ({ historyId }) => sql`
      DELETE FROM commit_histories WHERE history_id = ${historyId}
    `,
  });

  const mintId = <Id extends string>(brand: { readonly make: (value: string) => Id }) =>
    crypto.randomUUIDv4.pipe(Effect.map(brand.make));

  const toPlanSummary = (row: typeof PlanSummaryRow.Type): PlanSummary => ({
    ...row,
    hasPublishedCommits: row.hasPublishedCommits !== 0,
  });

  const requirePlan = Effect.fn("PlanningStore.requirePlan")(function* (planId: PlanId) {
    const found = yield* findPlanRow({ planId });
    if (Option.isNone(found)) {
      return yield* new PlanNotFoundError({ planId });
    }
    return toPlanSummary(found.value);
  });

  const toPlanCommitFields = (commit: Commit) => ({
    commitId: commit.commitId,
    sequence: commit.sequence,
    parents: commit.parents,
    published: commit.published,
    authorKind: commit.authorKind,
    createdAt: commit.createdAt,
  });

  const toPlanMessage = Effect.fn("PlanningStore.toPlanMessage")(function* (commit: Commit) {
    const payload = yield* decodeMessagePayload(commit.payload);
    return {
      ...toPlanCommitFields(commit),
      text: payload.text,
      ...(payload.attachments === undefined ? {} : { attachments: payload.attachments }),
    } satisfies PlanMessage;
  });

  const toPlanRevision = (commit: Commit): PlanRevision => toPlanCommitFields(commit);

  /**
   * A commit as the planning space sees it, or nothing when the space has no
   * rendering for that kind. Skipping the unknown rather than failing is what
   * lets coding-session and issue-revision commits land later without breaking
   * every reader of this surface.
   */
  const toTimelineEvent = Effect.fn("PlanningStore.toTimelineEvent")(function* (commit: Commit) {
    if (commit.kind === "message") {
      const message = yield* toPlanMessage(commit);
      return Option.some<PlanTimelineEvent>({ item: { _tag: "message", ...message } });
    }
    if (commit.kind === "plan-revision") {
      const payload = yield* decodeRevisionPayload(commit.payload);
      return Option.some<PlanTimelineEvent>({
        item: { _tag: "plan-revision", ...toPlanRevision(commit) },
        planText: payload.text,
      });
    }
    return Option.none<PlanTimelineEvent>();
  });

  const projectCommits = Effect.fn("PlanningStore.projectCommits")(function* (
    path: ReadonlyArray<Commit>,
  ) {
    const projected = yield* Effect.forEach(path, toTimelineEvent);
    return projected.filter(Option.isSome).map((event) => event.value);
  });

  /** The tip of the space: what a new commit hangs from. */
  const readTip = Effect.fn("PlanningStore.readTip")(function* (historyId: HistoryId) {
    const path = yield* commits.listCommits({ historyId, visibility: "all" });
    return path.at(-1);
  });

  const createProject: PlanningStore["Service"]["createProject"] = (input) =>
    Effect.gen(function* () {
      const projectId = yield* mintId(MercurianProjectId);
      const project = {
        projectId,
        name: input.name,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      } satisfies MercurianProject;
      yield* sql.withTransaction(insertProjectRow(project));
      yield* announceChange;
      return project;
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.createProject:query",
          "PlanningStore.createProject:encodeRequest",
        ),
      ),
    );

  const getTreeSnapshot: PlanningStore["Service"]["getTreeSnapshot"] = Effect.gen(function* () {
    const [projects, plans] = yield* Effect.all([listProjectRows({}), listPlanRows({})]);
    return { projects, plans: plans.map(toPlanSummary) } satisfies PlanningTreeSnapshot;
  }).pipe(
    Effect.mapError(
      toPlanningStoreError(
        "PlanningStore.getTreeSnapshot:query",
        "PlanningStore.getTreeSnapshot:decodeRows",
      ),
    ),
  );

  const createPlan: PlanningStore["Service"]["createPlan"] = (input) =>
    Effect.gen(function* () {
      const project = yield* findProjectRow({ projectId: input.projectId });
      if (Option.isNone(project)) {
        return yield* new MercurianProjectNotFoundError({ projectId: input.projectId });
      }

      const planId = yield* mintId(PlanId);
      const historyId = yield* mintId(HistoryId);
      const rootCommitId = yield* mintId(CommitId);

      const plan = {
        planId,
        projectId: input.projectId,
        historyId,
        title: derivePlanTitle(input.message),
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        // Born in the tree, and born private: the one is this column, the
        // other is the root commit below.
        archivedAt: null,
      } satisfies Plan;

      // The history has to exist before the plan row can name it, and the two
      // writes are one act — a savepoint keeps the nested commit-store
      // transaction inside this one.
      const root = yield* sql.withTransaction(
        Effect.gen(function* () {
          const rootCommit = yield* commits.createHistory({
            historyId,
            rootCommit: {
              commitId: rootCommitId,
              kind: "message",
              authorKind: "human",
              createdAt: input.createdAt,
              payload: {
                text: input.message,
                ...(input.attachments === undefined || input.attachments.length === 0
                  ? {}
                  : { attachments: input.attachments }),
              } satisfies MessageCommitPayload,
            },
            // Born blank is born private; an imported plan's published root
            // belongs to issue import.
            rootPublished: false,
          });
          yield* insertPlanRow(plan);
          return rootCommit;
        }),
      );

      yield* announceChange;
      // Born blank: one message, no revision, so the artifact is empty by
      // construction rather than by a special case.
      return {
        plan: { ...plan, hasPublishedCommits: false },
        planText: "",
        timeline: [{ _tag: "message", ...(yield* toPlanMessage(root)) }],
        snapshotSequence: root.sequence,
      } satisfies PlanDetail;
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.createPlan:query",
          "PlanningStore.createPlan:encodeRequest",
        ),
      ),
    );

  /**
   * Where an act hangs from: the commit it named, or the tip when it named
   * none. A commit of some other plan's history does not exist for this plan —
   * the same rule {@link PlanningStore.getPlanTextAt} reads by.
   */
  const resolveParent = Effect.fn("PlanningStore.resolveParent")(function* (
    plan: Plan,
    parentCommitId: CommitId | undefined,
  ) {
    if (parentCommitId === undefined) {
      return yield* readTip(plan.historyId);
    }
    const found = yield* commits.getCommit({ commitId: parentCommitId, visibility: "all" });
    if (Option.isNone(found) || found.value.historyId !== plan.historyId) {
      return yield* new CommitStore.CommitNotFoundError({ commitId: parentCommitId });
    }
    return found.value;
  });

  /**
   * Resolve the parent and append onto it inside one transaction, so the shape
   * of the history is decided by one reader of it rather than by two writers
   * racing.
   *
   * Nothing here knows about forks. Appending onto a commit that already has a
   * child is a fork, and the commit store is where that is legal for a human
   * and refused for an assistant — this path inherits that law rather than
   * restating it.
   */
  const appendAt = Effect.fn("PlanningStore.appendAt")(function* (input: {
    readonly plan: Plan;
    readonly parentCommitId: CommitId | undefined;
    readonly commitId: CommitId;
    readonly kind: "message" | "plan-revision";
    readonly payload: unknown;
    readonly createdAt: Commit["createdAt"];
  }) {
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const parent = yield* resolveParent(input.plan, input.parentCommitId);
        const commit = yield* commits.append({
          historyId: input.plan.historyId,
          commitId: input.commitId,
          kind: input.kind,
          // Hardcoded, never taken from the caller: the assistant's revisions
          // arrive with the assistant and its own write path.
          authorKind: "human",
          parents: parent === undefined ? [] : [parent.commitId],
          createdAt: input.createdAt,
          payload: input.payload,
        });
        yield* touchPlanRow({ planId: input.plan.planId, updatedAt: input.createdAt });
        return commit;
      }),
    );
  });

  const appendMessage: PlanningStore["Service"]["appendMessage"] = (input) =>
    Effect.gen(function* () {
      const plan = yield* requirePlan(input.planId);
      const commitId = yield* mintId(CommitId);
      const appended = yield* appendAt({
        plan,
        parentCommitId: input.parentCommitId,
        commitId,
        kind: "message",
        payload: {
          text: input.text,
          ...(input.attachments === undefined || input.attachments.length === 0
            ? {}
            : { attachments: input.attachments }),
        } satisfies MessageCommitPayload,
        createdAt: input.createdAt,
      });

      yield* announceChange;
      return yield* toPlanMessage(appended);
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.appendMessage:query",
          "PlanningStore.appendMessage:encodeRequest",
        ),
      ),
    );

  const savePlanRevision: PlanningStore["Service"]["savePlanRevision"] = (input) =>
    Effect.gen(function* () {
      const plan = yield* requirePlan(input.planId);
      const commitId = yield* mintId(CommitId);
      const appended = yield* appendAt({
        plan,
        parentCommitId: input.parentCommitId,
        commitId,
        kind: "plan-revision",
        payload: { text: input.text } satisfies PlanRevisionCommitPayload,
        createdAt: input.createdAt,
      });

      // An edit is activity: the tree's recency ordering should feel it.
      yield* announceChange;
      return toPlanRevision(appended);
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.savePlanRevision:query",
          "PlanningStore.savePlanRevision:encodeRequest",
        ),
      ),
    );

  const archivePlan: PlanningStore["Service"]["archivePlan"] = (input) =>
    Effect.gen(function* () {
      yield* requirePlan(input.planId);
      // `archived_at IS NULL` in the UPDATE is what makes this idempotent:
      // archiving an already-archived plan keeps the first stamp, so
      // "archived 3 days ago" does not reset on a second click.
      yield* archivePlanRow(input);
      yield* announceChange;
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.archivePlan:query",
          "PlanningStore.archivePlan:encodeRequest",
        ),
      ),
    );

  const unarchivePlan: PlanningStore["Service"]["unarchivePlan"] = (input) =>
    Effect.gen(function* () {
      yield* requirePlan(input.planId);
      yield* unarchivePlanRow(input);
      yield* announceChange;
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.unarchivePlan:query",
          "PlanningStore.unarchivePlan:encodeRequest",
        ),
      ),
    );

  /** The ids of every image the plan's messages carried, for the boundary to unlink. */
  const collectAttachmentIds = Effect.fn("PlanningStore.collectAttachmentIds")(function* (
    path: ReadonlyArray<Commit>,
  ) {
    const ids: Array<string> = [];
    for (const commit of path) {
      if (commit.kind !== "message") {
        continue;
      }
      const payload = yield* decodeMessagePayload(commit.payload);
      for (const attachment of payload.attachments ?? []) {
        ids.push(attachment.id);
      }
    }
    return ids as ReadonlyArray<string>;
  });

  const deletePlan: PlanningStore["Service"]["deletePlan"] = (input) =>
    Effect.gen(function* () {
      const deletion = yield* sql.withTransaction(
        Effect.gen(function* () {
          const plan = yield* requirePlan(input.planId);
          // The server is authoritative. The surface stops offering delete the
          // moment anything is published, but the rule is re-read here, inside
          // the transaction, because a publish landing between the two would
          // otherwise leave a hidden affordance as the only guard.
          if (plan.hasPublishedCommits) {
            return yield* new PlanDeleteBlockedError({ planId: input.planId });
          }

          const path = yield* commits.listCommits({
            historyId: plan.historyId,
            visibility: "all",
          });
          const attachmentIds = yield* collectAttachmentIds(path);

          yield* deleteCommitParentRows({ historyId: plan.historyId });
          yield* deletePlanRow({ planId: input.planId });
          yield* deleteCommitRows({ historyId: plan.historyId });
          yield* deleteHistoryRow({ historyId: plan.historyId });

          return { attachmentIds } satisfies PlanDeletion;
        }),
      );

      yield* announceChange;
      return deletion;
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.deletePlan:query",
          "PlanningStore.deletePlan:decodeRows",
        ),
      ),
    );

  const getPlanSnapshot: PlanningStore["Service"]["getPlanSnapshot"] = (input) =>
    Effect.gen(function* () {
      const plan = yield* requirePlan(input.planId);
      // The author's own workspace sees its drafts, so every commit counts.
      const path = yield* commits.listCommits({
        historyId: plan.historyId,
        visibility: "all",
      });
      const events = yield* projectCommits(path);
      return {
        plan,
        planText: derivePlanText(events),
        timeline: events.map((event) => event.item),
        snapshotSequence: path.at(-1)?.sequence ?? 0,
      } satisfies PlanDetail;
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.getPlanSnapshot:query",
          "PlanningStore.getPlanSnapshot:decodeRows",
        ),
      ),
    );

  const listTimelineSince: PlanningStore["Service"]["listTimelineSince"] = (input) =>
    Effect.gen(function* () {
      const plan = yield* requirePlan(input.planId);
      const since = yield* commits.listCommitsSince({
        historyId: plan.historyId,
        afterSequence: input.afterSequence,
        visibility: "all",
      });
      return yield* projectCommits(since);
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.listTimelineSince:query",
          "PlanningStore.listTimelineSince:decodeRows",
        ),
      ),
    );

  /**
   * Reading backwards from the commit rather than folding forwards: a
   * revision's payload is the artifact whole, so the first one found walking
   * down the path is the answer and nothing before it matters.
   *
   * Along a single path `sequence` order *is* path order, so last-by-sequence
   * is exact. Across a merge's several parent paths it is a tiebreak — which
   * costs nothing while merges cannot exist, and stops mattering when they can:
   * a merge's own output is a plan revision, so every post-merge path answers
   * from the merge itself.
   */
  const getPlanTextAt: PlanningStore["Service"]["getPlanTextAt"] = (input) =>
    Effect.gen(function* () {
      const plan = yield* requirePlan(input.planId);
      const found = yield* commits.getCommit({ commitId: input.commitId, visibility: "all" });
      // A commit of some other plan's history does not exist for this plan.
      if (Option.isNone(found) || found.value.historyId !== plan.historyId) {
        return yield* new CommitStore.CommitNotFoundError({ commitId: input.commitId });
      }
      const ancestry = yield* commits.ancestors({
        commitId: input.commitId,
        visibility: "all",
      });
      const path = [...ancestry, found.value];
      for (let index = path.length - 1; index >= 0; index -= 1) {
        const commit = path[index];
        if (commit !== undefined && commit.kind === "plan-revision") {
          return (yield* decodeRevisionPayload(commit.payload)).text;
        }
      }
      return "";
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.getPlanTextAt:query",
          "PlanningStore.getPlanTextAt:decodeRows",
        ),
      ),
    );

  return {
    createProject,
    getTreeSnapshot,
    createPlan,
    appendMessage,
    savePlanRevision,
    archivePlan,
    unarchivePlan,
    deletePlan,
    getPlanSnapshot,
    listTimelineSince,
    getPlanTextAt,
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies PlanningStore["Service"];
});

export const layer = Layer.effect(PlanningStore, make);

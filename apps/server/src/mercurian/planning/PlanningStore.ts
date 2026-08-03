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
  MercurianProjectId,
  MercurianProjectNotFoundError,
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
import { MercurianProject, Plan } from "./schema.ts";

// ===============================
// Domain
// ===============================

/** What a message commit carries. The only payload shape written today. */
export const MessageCommitPayload = Schema.Struct({ text: Schema.String });
export type MessageCommitPayload = typeof MessageCommitPayload.Type;

/** One commit on the planning space's path, as the conversation renders it. */
export const PlanMessage = Schema.Struct({
  commitId: CommitId,
  authorKind: CommitAuthorKind,
  text: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
});
export type PlanMessage = typeof PlanMessage.Type;

export interface PlanDetail {
  readonly plan: Plan;
  readonly messages: ReadonlyArray<PlanMessage>;
}

export interface PlanningTreeSnapshot {
  readonly projects: ReadonlyArray<MercurianProject>;
  /** Newest first within each project — what the tree shows without expanding. */
  readonly plans: ReadonlyArray<Plan>;
}

export type PlanningStoreRefusal = MercurianProjectNotFoundError | PlanNotFoundError;

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
  createdAt: Schema.DateTimeUtcFromString,
});
export type CreatePlanInput = typeof CreatePlanInput.Type;

export const AppendMessageInput = Schema.Struct({
  planId: PlanId,
  text: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
});
export type AppendMessageInput = typeof AppendMessageInput.Type;

export const GetPlanInput = Schema.Struct({ planId: PlanId });
export type GetPlanInput = typeof GetPlanInput.Type;

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
     * Append a message at the space's tip. Explicit parent selection belongs to
     * the DAG surface; while one linear path renders, the tip is the answer.
     */
    readonly appendMessage: (
      input: AppendMessageInput,
    ) => Effect.Effect<PlanMessage, PlanningStoreError>;
    readonly getPlan: (input: GetPlanInput) => Effect.Effect<PlanDetail, PlanningStoreError>;
    /** Fires once per mutation. What keeps a subscribed tree fresh. */
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

const PlanRow = Schema.Struct({
  planId: PlanId,
  projectId: MercurianProjectId,
  historyId: HistoryId,
  title: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

const ProjectIdRequest = Schema.Struct({ projectId: MercurianProjectId });
const PlanIdRequest = Schema.Struct({ planId: PlanId });
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
  Schema.Union([MercurianProjectNotFoundError, PlanNotFoundError]),
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

  const planColumns = sql`
    plan_id AS "planId",
    project_id AS "projectId",
    history_id AS "historyId",
    title AS "title",
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;

  const insertPlanRow = SqlSchema.void({
    Request: PlanRow,
    execute: (row) => sql`
      INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at)
      VALUES (
        ${row.planId},
        ${row.projectId},
        ${row.historyId},
        ${row.title},
        ${row.createdAt},
        ${row.updatedAt}
      )
    `,
  });

  const findPlanRow = SqlSchema.findOneOption({
    Request: PlanIdRequest,
    Result: PlanRow,
    execute: ({ planId }) => sql`
      SELECT ${planColumns}
      FROM plans
      WHERE plan_id = ${planId}
    `,
  });

  const listPlanRows = SqlSchema.findAll({
    Request: NoRequest,
    Result: PlanRow,
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

  const mintId = <Id extends string>(brand: { readonly make: (value: string) => Id }) =>
    crypto.randomUUIDv4.pipe(Effect.map(brand.make));

  const requirePlan = Effect.fn("PlanningStore.requirePlan")(function* (planId: PlanId) {
    const found = yield* findPlanRow({ planId });
    if (Option.isNone(found)) {
      return yield* new PlanNotFoundError({ planId });
    }
    return found.value;
  });

  const toPlanMessage = Effect.fn("PlanningStore.toPlanMessage")(function* (commit: Commit) {
    const payload = yield* decodeMessagePayload(commit.payload);
    return {
      commitId: commit.commitId,
      authorKind: commit.authorKind,
      text: payload.text,
      createdAt: commit.createdAt,
    } satisfies PlanMessage;
  });

  /**
   * Only `message` commits render as conversation. Nothing else is written
   * today, and when plan revisions and coding sessions arrive they get their
   * own projection rather than being squeezed into this one.
   */
  const listPlanMessages = Effect.fn("PlanningStore.listPlanMessages")(function* (
    historyId: HistoryId,
  ) {
    const path = yield* commits.listCommits({ historyId, visibility: "all" });
    return yield* Effect.forEach(
      path.filter((commit) => commit.kind === "message"),
      toPlanMessage,
    );
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
    return { projects, plans } satisfies PlanningTreeSnapshot;
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
              payload: { text: input.message } satisfies MessageCommitPayload,
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
      return { plan, messages: [yield* toPlanMessage(root)] } satisfies PlanDetail;
    }).pipe(
      Effect.mapError(
        toPlanningStoreError(
          "PlanningStore.createPlan:query",
          "PlanningStore.createPlan:encodeRequest",
        ),
      ),
    );

  const appendMessage: PlanningStore["Service"]["appendMessage"] = (input) =>
    Effect.gen(function* () {
      const plan = yield* requirePlan(input.planId);
      const path = yield* commits.listCommits({
        historyId: plan.historyId,
        visibility: "all",
      });
      const tip = path.at(-1);
      const commitId = yield* mintId(CommitId);

      const appended = yield* sql.withTransaction(
        Effect.gen(function* () {
          const commit = yield* commits.append({
            historyId: plan.historyId,
            commitId,
            kind: "message",
            authorKind: "human",
            parents: tip === undefined ? [] : [tip.commitId],
            createdAt: input.createdAt,
            payload: { text: input.text } satisfies MessageCommitPayload,
          });
          yield* touchPlanRow({ planId: plan.planId, updatedAt: input.createdAt });
          return commit;
        }),
      );

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

  const getPlan: PlanningStore["Service"]["getPlan"] = (input) =>
    Effect.gen(function* () {
      const plan = yield* requirePlan(input.planId);
      // The author's own workspace sees its drafts, so every commit counts.
      const messages = yield* listPlanMessages(plan.historyId);
      return { plan, messages } satisfies PlanDetail;
    }).pipe(
      Effect.mapError(
        toPlanningStoreError("PlanningStore.getPlan:query", "PlanningStore.getPlan:decodeRows"),
      ),
    );

  return {
    createProject,
    getTreeSnapshot,
    createPlan,
    appendMessage,
    getPlan,
    get changes() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies PlanningStore["Service"];
});

export const layer = Layer.effect(PlanningStore, make);

/**
 * CommitStore — the planning history's commit DAG.
 *
 * The structural guarantees the design pins are refusals here, not
 * conventions callers are trusted to follow:
 *
 * - forks and merges are human-driven only — an assistant may not open a
 *   history, may not commit onto a parent that already has a child, and may
 *   not carry more than one parent;
 * - coding-session commits are leaves — interior structure is planning, and
 *   nothing may be committed onto a coding session;
 * - a parent must already exist, so a commit can never reach itself and the
 *   graph is acyclic by construction;
 * - publishing a commit publishes its unpublished ancestors across *every*
 *   parent path, so the shared history is always complete from any published
 *   commit back to the root.
 *
 * @module CommitStore
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { PersistenceDecodeError, PersistenceSqlError } from "../../persistence/Errors.ts";
import {
  Commit,
  CommitAuthorKind,
  CommitHistory,
  CommitId,
  CommitKind,
  CommitVisibility,
  HistoryId,
  NewCommit,
} from "./schema.ts";

// ===============================
// Refusals
// ===============================

export class CommitNotFoundError extends Schema.TaggedErrorClass<CommitNotFoundError>()(
  "CommitNotFoundError",
  { commitId: CommitId },
) {
  override get message(): string {
    return `Commit ${this.commitId} does not exist`;
  }
}

export class CommitParentNotFoundError extends Schema.TaggedErrorClass<CommitParentNotFoundError>()(
  "CommitParentNotFoundError",
  { commitId: CommitId, parentId: CommitId },
) {
  override get message(): string {
    return `Commit ${this.commitId} names parent ${this.parentId}, which does not exist`;
  }
}

export class CommitParentDuplicateError extends Schema.TaggedErrorClass<CommitParentDuplicateError>()(
  "CommitParentDuplicateError",
  { commitId: CommitId, parentId: CommitId },
) {
  override get message(): string {
    return `Commit ${this.commitId} names parent ${this.parentId} more than once`;
  }
}

export class CommitParentHistoryMismatchError extends Schema.TaggedErrorClass<CommitParentHistoryMismatchError>()(
  "CommitParentHistoryMismatchError",
  {
    commitId: CommitId,
    parentId: CommitId,
    historyId: HistoryId,
    parentHistoryId: HistoryId,
  },
) {
  override get message(): string {
    return `Commit ${this.commitId} in history ${this.historyId} names parent ${this.parentId}, which belongs to history ${this.parentHistoryId}`;
  }
}

export class CodingSessionParentError extends Schema.TaggedErrorClass<CodingSessionParentError>()(
  "CodingSessionParentError",
  { commitId: CommitId, parentId: CommitId },
) {
  override get message(): string {
    return `Commit ${this.commitId} names coding-session commit ${this.parentId} as a parent; coding sessions are leaves`;
  }
}

/**
 * An assistant tried to open a new line of history: either a parentless
 * commit (opening a history is a human or import act) or a commit onto a
 * parent that already has a child.
 */
export class AssistantForkError extends Schema.TaggedErrorClass<AssistantForkError>()(
  "AssistantForkError",
  { commitId: CommitId, parentId: Schema.NullOr(CommitId) },
) {
  override get message(): string {
    return this.parentId === null
      ? `Assistant commit ${this.commitId} has no parent; only a human may open a history`
      : `Assistant commit ${this.commitId} would fork at ${this.parentId}, which already has a child; only a human may fork`;
  }
}

export class AssistantMergeError extends Schema.TaggedErrorClass<AssistantMergeError>()(
  "AssistantMergeError",
  { commitId: CommitId, parentIds: Schema.Array(CommitId) },
) {
  override get message(): string {
    return `Assistant commit ${this.commitId} has ${this.parentIds.length} parents; only a human may merge`;
  }
}

export class HistoryRootExistsError extends Schema.TaggedErrorClass<HistoryRootExistsError>()(
  "HistoryRootExistsError",
  { historyId: HistoryId, commitId: CommitId, rootCommitId: CommitId },
) {
  override get message(): string {
    return `History ${this.historyId} is already rooted at ${this.rootCommitId}; commit ${this.commitId} cannot be a second root`;
  }
}

export const CommitStoreRefusal = Schema.Union([
  CommitNotFoundError,
  CommitParentNotFoundError,
  CommitParentDuplicateError,
  CommitParentHistoryMismatchError,
  CodingSessionParentError,
  AssistantForkError,
  AssistantMergeError,
  HistoryRootExistsError,
]);
export type CommitStoreRefusal = typeof CommitStoreRefusal.Type;

export const isCommitStoreRefusal = Schema.is(CommitStoreRefusal);

export type CommitStoreError = CommitStoreRefusal | PersistenceSqlError | PersistenceDecodeError;

// ===============================
// Inputs
// ===============================

export const CreateHistoryInput = Schema.Struct({
  historyId: HistoryId,
  rootCommit: NewCommit,
  /**
   * `true` is the imported-plan case: the root is published from the start.
   * Commits appended later always start private.
   */
  rootPublished: Schema.Boolean,
});
export type CreateHistoryInput = typeof CreateHistoryInput.Type;

export const AppendCommitInput = Schema.Struct({
  ...NewCommit.fields,
  historyId: HistoryId,
  /** Ordered; empty only for a history's first commit. */
  parents: Schema.Array(CommitId),
});
export type AppendCommitInput = typeof AppendCommitInput.Type;

export const PublishCommitInput = Schema.Struct({ commitId: CommitId });
export type PublishCommitInput = typeof PublishCommitInput.Type;

export const GetHistoryInput = Schema.Struct({ historyId: HistoryId });
export type GetHistoryInput = typeof GetHistoryInput.Type;

export const GetCommitInput = Schema.Struct({
  commitId: CommitId,
  visibility: CommitVisibility,
});
export type GetCommitInput = typeof GetCommitInput.Type;

export const ListCommitsInput = Schema.Struct({
  historyId: HistoryId,
  visibility: CommitVisibility,
});
export type ListCommitsInput = typeof ListCommitsInput.Type;

/**
 * The event read: what landed in a history after a cursor. The store is
 * already the append-only log a subscription needs, so "since" is a `sequence`
 * comparison rather than a second event table.
 */
export const ListCommitsSinceInput = Schema.Struct({
  historyId: HistoryId,
  afterSequence: Schema.Number,
  visibility: CommitVisibility,
});
export type ListCommitsSinceInput = typeof ListCommitsSinceInput.Type;

export const CommitTraversalInput = Schema.Struct({
  commitId: CommitId,
  visibility: CommitVisibility,
});
export type CommitTraversalInput = typeof CommitTraversalInput.Type;

// ===============================
// Service
// ===============================

export class CommitStore extends Context.Service<
  CommitStore,
  {
    /** Create a history and its root commit in one transaction. */
    readonly createHistory: (input: CreateHistoryInput) => Effect.Effect<Commit, CommitStoreError>;
    /** Append a commit. Every structural invariant is checked here. */
    readonly append: (input: AppendCommitInput) => Effect.Effect<Commit, CommitStoreError>;
    /**
     * Publish a commit together with its unpublished ancestors across every
     * parent path. Idempotent, and one-way. Returns what it published.
     */
    readonly publish: (
      input: PublishCommitInput,
    ) => Effect.Effect<ReadonlyArray<CommitId>, CommitStoreError>;
    readonly getHistory: (
      input: GetHistoryInput,
    ) => Effect.Effect<Option.Option<CommitHistory>, CommitStoreError>;
    readonly getCommit: (
      input: GetCommitInput,
    ) => Effect.Effect<Option.Option<Commit>, CommitStoreError>;
    /** Every commit in a history, in append order. */
    readonly listCommits: (
      input: ListCommitsInput,
    ) => Effect.Effect<ReadonlyArray<Commit>, CommitStoreError>;
    /** The commits a history gained after `afterSequence`, in append order. */
    readonly listCommitsSince: (
      input: ListCommitsSinceInput,
    ) => Effect.Effect<ReadonlyArray<Commit>, CommitStoreError>;
    /** Commits naming this one as a parent. More than one means a fork. */
    readonly children: (
      input: CommitTraversalInput,
    ) => Effect.Effect<ReadonlyArray<Commit>, CommitStoreError>;
    /** Strict ancestors across every parent path, in append order. */
    readonly ancestors: (
      input: CommitTraversalInput,
    ) => Effect.Effect<ReadonlyArray<Commit>, CommitStoreError>;
  }
>()("t3/mercurian/commitTree/CommitStore") {}

// ===============================
// Rows
// ===============================

const CommitRow = Schema.Struct({
  commitId: CommitId,
  historyId: HistoryId,
  sequence: Schema.Number,
  kind: CommitKind,
  authorKind: CommitAuthorKind,
  published: Schema.Number,
  createdAt: Schema.DateTimeUtcFromString,
  payload: Schema.fromJsonString(Schema.Unknown),
});
type CommitRow = typeof CommitRow.Type;

const CommitLookupRow = Schema.Struct({
  commitId: CommitId,
  historyId: HistoryId,
  kind: CommitKind,
});

const CommitIdRow = Schema.Struct({ commitId: CommitId });

const CommitSequenceRow = Schema.Struct({ sequence: Schema.Number });

const ParentEdgeRow = Schema.Struct({
  commitId: CommitId,
  parentId: CommitId,
  parentOrder: Schema.Number,
});
type ParentEdgeRow = typeof ParentEdgeRow.Type;

const CommitHistoryRow = Schema.Struct({
  historyId: HistoryId,
  createdAt: Schema.DateTimeUtcFromString,
});

const InsertCommitRow = Schema.Struct({
  commitId: CommitId,
  historyId: HistoryId,
  kind: CommitKind,
  authorKind: CommitAuthorKind,
  published: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromString,
  payload: Schema.Unknown,
});

const InsertParentRow = Schema.Struct({
  commitId: CommitId,
  parentId: CommitId,
  parentOrder: Schema.Number,
});

const HistoryIdRequest = Schema.Struct({ historyId: HistoryId });
const CommitIdRequest = Schema.Struct({ commitId: CommitId });
const ParentIdRequest = Schema.Struct({ parentId: CommitId });
const VisibleCommitRequest = Schema.Struct({
  commitId: CommitId,
  publishedOnly: Schema.Number,
});
const VisibleHistoryRequest = Schema.Struct({
  historyId: HistoryId,
  publishedOnly: Schema.Number,
});
const VisibleHistorySinceRequest = Schema.Struct({
  historyId: HistoryId,
  afterSequence: Schema.Number,
  publishedOnly: Schema.Number,
});

/**
 * SQLite has no boolean; the filter rides as 0/1 so one prepared statement
 * serves both visibilities.
 */
const publishedOnlyFlag = (visibility: CommitVisibility): number =>
  visibility === "published" ? 1 : 0;

function toCommitStoreError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): CommitStoreError =>
    isCommitStoreRefusal(cause)
      ? cause
      : Schema.isSchemaError(cause)
        ? PersistenceDecodeError.fromSchemaError(decodeOperation, cause)
        : new PersistenceSqlError({ operation: sqlOperation, cause });
}

function toCommit(row: CommitRow, parentsByCommit: ReadonlyMap<string, ReadonlyArray<CommitId>>) {
  return {
    commitId: row.commitId,
    historyId: row.historyId,
    sequence: row.sequence,
    kind: row.kind,
    authorKind: row.authorKind,
    parents: parentsByCommit.get(row.commitId) ?? [],
    published: row.published !== 0,
    createdAt: row.createdAt,
    payload: row.payload,
  } satisfies Commit;
}

function groupParents(
  edges: ReadonlyArray<ParentEdgeRow>,
): ReadonlyMap<string, ReadonlyArray<CommitId>> {
  const grouped = new Map<string, Array<CommitId>>();
  for (const edge of [...edges].sort((left, right) => left.parentOrder - right.parentOrder)) {
    const existing = grouped.get(edge.commitId);
    if (existing === undefined) {
      grouped.set(edge.commitId, [edge.parentId]);
    } else {
      existing.push(edge.parentId);
    }
  }
  return grouped;
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const commitColumns = sql`
    commits.commit_id AS "commitId",
    commits.history_id AS "historyId",
    commits.sequence AS "sequence",
    commits.kind AS "kind",
    commits.author_kind AS "authorKind",
    commits.published AS "published",
    commits.created_at AS "createdAt",
    commits.payload_json AS "payload"
  `;

  const insertHistoryRow = SqlSchema.void({
    Request: CommitHistoryRow,
    execute: ({ historyId, createdAt }) =>
      sql`
        INSERT INTO commit_histories (history_id, created_at)
        VALUES (${historyId}, ${createdAt})
      `,
  });

  // Returns the sequence the insert assigned, so an appended commit carries
  // its cursor without a second read.
  const insertCommitRow = SqlSchema.findOne({
    Request: InsertCommitRow,
    Result: CommitSequenceRow,
    execute: (row) =>
      sql`
        INSERT INTO commits (
          commit_id,
          history_id,
          kind,
          author_kind,
          published,
          created_at,
          payload_json
        )
        VALUES (
          ${row.commitId},
          ${row.historyId},
          ${row.kind},
          ${row.authorKind},
          ${row.published ? 1 : 0},
          ${row.createdAt},
          ${JSON.stringify(row.payload ?? null)}
        )
        RETURNING sequence AS "sequence"
      `,
  });

  const insertParentRow = SqlSchema.void({
    Request: InsertParentRow,
    execute: ({ commitId, parentId, parentOrder }) =>
      sql`
        INSERT INTO commit_parents (commit_id, parent_id, parent_order)
        VALUES (${commitId}, ${parentId}, ${parentOrder})
      `,
  });

  const findCommitLookup = SqlSchema.findOneOption({
    Request: CommitIdRequest,
    Result: CommitLookupRow,
    execute: ({ commitId }) =>
      sql`
        SELECT
          commit_id AS "commitId",
          history_id AS "historyId",
          kind AS "kind"
        FROM commits
        WHERE commit_id = ${commitId}
      `,
  });

  const findAnyChild = SqlSchema.findOneOption({
    Request: ParentIdRequest,
    Result: CommitIdRow,
    execute: ({ parentId }) =>
      sql`
        SELECT commit_id AS "commitId"
        FROM commit_parents
        WHERE parent_id = ${parentId}
        LIMIT 1
      `,
  });

  const findHistoryRootRow = SqlSchema.findOneOption({
    Request: HistoryIdRequest,
    Result: CommitIdRow,
    execute: ({ historyId }) =>
      sql`
        SELECT commits.commit_id AS "commitId"
        FROM commits
        WHERE commits.history_id = ${historyId}
          AND NOT EXISTS (
            SELECT 1 FROM commit_parents
            WHERE commit_parents.commit_id = commits.commit_id
          )
        LIMIT 1
      `,
  });

  const findHistoryRow = SqlSchema.findOneOption({
    Request: HistoryIdRequest,
    Result: CommitHistoryRow,
    execute: ({ historyId }) =>
      sql`
        SELECT
          history_id AS "historyId",
          created_at AS "createdAt"
        FROM commit_histories
        WHERE history_id = ${historyId}
      `,
  });

  const findCommitRow = SqlSchema.findOneOption({
    Request: VisibleCommitRequest,
    Result: CommitRow,
    execute: ({ commitId, publishedOnly }) =>
      sql`
        SELECT ${commitColumns}
        FROM commits
        WHERE commits.commit_id = ${commitId}
          AND (${publishedOnly} = 0 OR commits.published = 1)
      `,
  });

  const listCommitRows = SqlSchema.findAll({
    Request: VisibleHistoryRequest,
    Result: CommitRow,
    execute: ({ historyId, publishedOnly }) =>
      sql`
        SELECT ${commitColumns}
        FROM commits
        WHERE commits.history_id = ${historyId}
          AND (${publishedOnly} = 0 OR commits.published = 1)
        ORDER BY commits.sequence ASC
      `,
  });

  const listCommitRowsSince = SqlSchema.findAll({
    Request: VisibleHistorySinceRequest,
    Result: CommitRow,
    execute: ({ historyId, afterSequence, publishedOnly }) =>
      sql`
        SELECT ${commitColumns}
        FROM commits
        WHERE commits.history_id = ${historyId}
          AND commits.sequence > ${afterSequence}
          AND (${publishedOnly} = 0 OR commits.published = 1)
        ORDER BY commits.sequence ASC
      `,
  });

  const listChildRows = SqlSchema.findAll({
    Request: VisibleCommitRequest,
    Result: CommitRow,
    execute: ({ commitId, publishedOnly }) =>
      sql`
        SELECT ${commitColumns}
        FROM commits
        JOIN commit_parents ON commit_parents.commit_id = commits.commit_id
        WHERE commit_parents.parent_id = ${commitId}
          AND (${publishedOnly} = 0 OR commits.published = 1)
        ORDER BY commits.sequence ASC
      `,
  });

  // Every parent path, not one path to root — the DAG generalization of a
  // walk up a tree.
  const listAncestorRows = SqlSchema.findAll({
    Request: VisibleCommitRequest,
    Result: CommitRow,
    execute: ({ commitId, publishedOnly }) =>
      sql`
        WITH RECURSIVE ancestry(commit_id) AS (
          SELECT parent_id FROM commit_parents WHERE commit_id = ${commitId}
          UNION
          SELECT commit_parents.parent_id
          FROM commit_parents
          JOIN ancestry ON ancestry.commit_id = commit_parents.commit_id
        )
        SELECT ${commitColumns}
        FROM commits
        JOIN ancestry ON ancestry.commit_id = commits.commit_id
        WHERE (${publishedOnly} = 0 OR commits.published = 1)
        ORDER BY commits.sequence ASC
      `,
  });

  const listParentEdgesByHistory = SqlSchema.findAll({
    Request: HistoryIdRequest,
    Result: ParentEdgeRow,
    execute: ({ historyId }) =>
      sql`
        SELECT
          commit_parents.commit_id AS "commitId",
          commit_parents.parent_id AS "parentId",
          commit_parents.parent_order AS "parentOrder"
        FROM commit_parents
        JOIN commits ON commits.commit_id = commit_parents.commit_id
        WHERE commits.history_id = ${historyId}
        ORDER BY commit_parents.commit_id ASC, commit_parents.parent_order ASC
      `,
  });

  const listParentEdgesByCommit = SqlSchema.findAll({
    Request: CommitIdRequest,
    Result: ParentEdgeRow,
    execute: ({ commitId }) =>
      sql`
        SELECT
          commit_id AS "commitId",
          parent_id AS "parentId",
          parent_order AS "parentOrder"
        FROM commit_parents
        WHERE commit_id = ${commitId}
        ORDER BY parent_order ASC
      `,
  });

  const publishAncestryRows = SqlSchema.findAll({
    Request: CommitIdRequest,
    Result: CommitIdRow,
    execute: ({ commitId }) =>
      sql`
        WITH RECURSIVE ancestry(commit_id) AS (
          SELECT ${commitId}
          UNION
          SELECT commit_parents.parent_id
          FROM commit_parents
          JOIN ancestry ON ancestry.commit_id = commit_parents.commit_id
        )
        UPDATE commits
        SET published = 1
        WHERE commit_id IN (SELECT commit_id FROM ancestry)
          AND published = 0
        RETURNING commit_id AS "commitId"
      `,
  });

  /**
   * The one write path. Validates every structural invariant against current
   * graph state, then inserts the commit and its parent edges. The caller
   * wraps this in a transaction, so any refusal rolls the whole thing back.
   *
   * Parents are checked to exist *before* the commit row is inserted, which is
   * what makes the graph acyclic by construction: a commit can only name
   * commits that already exist, so it can never reach itself.
   */
  const writeCommit = Effect.fn("CommitStore.writeCommit")(function* (input: {
    readonly historyId: HistoryId;
    readonly commitId: CommitId;
    readonly kind: CommitKind;
    readonly authorKind: CommitAuthorKind;
    readonly parents: ReadonlyArray<CommitId>;
    readonly published: boolean;
    readonly createdAt: Commit["createdAt"];
    readonly payload: unknown;
  }) {
    const { commitId, historyId, parents } = input;

    const seen = new Set<string>();
    for (const parentId of parents) {
      if (seen.has(parentId)) {
        return yield* new CommitParentDuplicateError({ commitId, parentId });
      }
      seen.add(parentId);
    }

    const isAssistant = input.authorKind === "assistant";
    if (isAssistant && parents.length === 0) {
      return yield* new AssistantForkError({ commitId, parentId: null });
    }
    if (isAssistant && parents.length > 1) {
      return yield* new AssistantMergeError({ commitId, parentIds: parents });
    }

    for (const parentId of parents) {
      const found = yield* findCommitLookup({ commitId: parentId });
      if (Option.isNone(found)) {
        return yield* new CommitParentNotFoundError({ commitId, parentId });
      }
      const parent = found.value;
      if (parent.historyId !== historyId) {
        return yield* new CommitParentHistoryMismatchError({
          commitId,
          parentId,
          historyId,
          parentHistoryId: parent.historyId,
        });
      }
      if (parent.kind === "coding-session") {
        return yield* new CodingSessionParentError({ commitId, parentId });
      }
      if (isAssistant) {
        const child = yield* findAnyChild({ parentId });
        if (Option.isSome(child)) {
          return yield* new AssistantForkError({ commitId, parentId });
        }
      }
    }

    if (parents.length === 0) {
      const root = yield* findHistoryRootRow({ historyId });
      if (Option.isSome(root)) {
        return yield* new HistoryRootExistsError({
          historyId,
          commitId,
          rootCommitId: root.value.commitId,
        });
      }
    }

    const inserted = yield* insertCommitRow({
      commitId,
      historyId,
      kind: input.kind,
      authorKind: input.authorKind,
      published: input.published,
      createdAt: input.createdAt,
      payload: input.payload,
    });

    for (const [parentOrder, parentId] of parents.entries()) {
      yield* insertParentRow({ commitId, parentId, parentOrder });
    }

    return {
      commitId,
      historyId,
      sequence: inserted.sequence,
      kind: input.kind,
      authorKind: input.authorKind,
      parents,
      published: input.published,
      createdAt: input.createdAt,
      payload: input.payload,
    } satisfies Commit;
  });

  const createHistory: CommitStore["Service"]["createHistory"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* insertHistoryRow({
            historyId: input.historyId,
            createdAt: input.rootCommit.createdAt,
          });
          return yield* writeCommit({
            historyId: input.historyId,
            commitId: input.rootCommit.commitId,
            kind: input.rootCommit.kind,
            authorKind: input.rootCommit.authorKind,
            parents: [],
            published: input.rootPublished,
            createdAt: input.rootCommit.createdAt,
            payload: input.rootCommit.payload,
          });
        }),
      )
      .pipe(
        Effect.mapError(
          toCommitStoreError(
            "CommitStore.createHistory:query",
            "CommitStore.createHistory:encodeRequest",
          ),
        ),
      );

  const append: CommitStore["Service"]["append"] = (input) =>
    sql
      .withTransaction(
        writeCommit({
          historyId: input.historyId,
          commitId: input.commitId,
          kind: input.kind,
          authorKind: input.authorKind,
          parents: input.parents,
          // Drafts are private by default; `publish` is the only way up.
          published: false,
          createdAt: input.createdAt,
          payload: input.payload,
        }),
      )
      .pipe(
        Effect.mapError(
          toCommitStoreError("CommitStore.append:query", "CommitStore.append:encodeRequest"),
        ),
      );

  const publish: CommitStore["Service"]["publish"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const found = yield* findCommitLookup({ commitId: input.commitId });
          if (Option.isNone(found)) {
            return yield* new CommitNotFoundError({ commitId: input.commitId });
          }
          const rows = yield* publishAncestryRows({ commitId: input.commitId });
          return rows.map((row) => row.commitId);
        }),
      )
      .pipe(
        Effect.mapError(
          toCommitStoreError("CommitStore.publish:query", "CommitStore.publish:decodeRows"),
        ),
      );

  const getHistory: CommitStore["Service"]["getHistory"] = (input) =>
    findHistoryRow(input).pipe(
      Effect.mapError(
        toCommitStoreError("CommitStore.getHistory:query", "CommitStore.getHistory:decodeRow"),
      ),
    );

  const getCommit: CommitStore["Service"]["getCommit"] = (input) =>
    Effect.gen(function* () {
      const found = yield* findCommitRow({
        commitId: input.commitId,
        publishedOnly: publishedOnlyFlag(input.visibility),
      });
      if (Option.isNone(found)) {
        return Option.none();
      }
      const edges = yield* listParentEdgesByCommit({ commitId: input.commitId });
      return Option.some(toCommit(found.value, groupParents(edges)));
    }).pipe(
      Effect.mapError(
        toCommitStoreError("CommitStore.getCommit:query", "CommitStore.getCommit:decodeRow"),
      ),
    );

  /**
   * Parent edges come from the whole history in one query: every commit a
   * traversal can return lives in the same history, and a published commit's
   * parents are always published too, so no edge needs filtering.
   */
  const withParents = Effect.fn("CommitStore.withParents")(function* (
    rows: ReadonlyArray<CommitRow>,
  ) {
    const first = rows[0];
    if (first === undefined) {
      return [];
    }
    const edges = yield* listParentEdgesByHistory({ historyId: first.historyId });
    const parentsByCommit = groupParents(edges);
    return rows.map((row) => toCommit(row, parentsByCommit));
  });

  const listCommits: CommitStore["Service"]["listCommits"] = (input) =>
    listCommitRows({
      historyId: input.historyId,
      publishedOnly: publishedOnlyFlag(input.visibility),
    }).pipe(
      Effect.flatMap(withParents),
      Effect.mapError(
        toCommitStoreError("CommitStore.listCommits:query", "CommitStore.listCommits:decodeRows"),
      ),
    );

  const listCommitsSince: CommitStore["Service"]["listCommitsSince"] = (input) =>
    listCommitRowsSince({
      historyId: input.historyId,
      afterSequence: input.afterSequence,
      publishedOnly: publishedOnlyFlag(input.visibility),
    }).pipe(
      Effect.flatMap(withParents),
      Effect.mapError(
        toCommitStoreError(
          "CommitStore.listCommitsSince:query",
          "CommitStore.listCommitsSince:decodeRows",
        ),
      ),
    );

  const children: CommitStore["Service"]["children"] = (input) =>
    listChildRows({
      commitId: input.commitId,
      publishedOnly: publishedOnlyFlag(input.visibility),
    }).pipe(
      Effect.flatMap(withParents),
      Effect.mapError(
        toCommitStoreError("CommitStore.children:query", "CommitStore.children:decodeRows"),
      ),
    );

  const ancestors: CommitStore["Service"]["ancestors"] = (input) =>
    listAncestorRows({
      commitId: input.commitId,
      publishedOnly: publishedOnlyFlag(input.visibility),
    }).pipe(
      Effect.flatMap(withParents),
      Effect.mapError(
        toCommitStoreError("CommitStore.ancestors:query", "CommitStore.ancestors:decodeRows"),
      ),
    );

  return {
    createHistory,
    append,
    publish,
    getHistory,
    getCommit,
    listCommits,
    listCommitsSince,
    children,
    ancestors,
  } satisfies CommitStore["Service"];
});

export const layer = Layer.effect(CommitStore, make);

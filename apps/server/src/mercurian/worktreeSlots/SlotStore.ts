import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  MercurianCommitId,
  MercurianProjectId,
  MercurianRepositoryId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";

import {
  isPersistenceError,
  PersistenceDecodeError,
  PersistenceSqlError,
} from "../../persistence/Errors.ts";
import { WorktreeSlot, WorktreeSlotId, WorktreeSlotMember } from "./schema.ts";

export type SlotStoreError = PersistenceSqlError | PersistenceDecodeError;

const ProjectRequest = Schema.Struct({ projectId: MercurianProjectId });
const SlotRequest = Schema.Struct({ slotId: WorktreeSlotId });
const SlotRow = Schema.Struct({
  slotId: WorktreeSlotId,
  projectId: MercurianProjectId,
  path: TrimmedNonEmptyString,
  currentLineRootCommitId: Schema.NullOr(MercurianCommitId),
  createdAt: Schema.DateTimeUtcFromString,
  lastUsedAt: Schema.DateTimeUtcFromString,
});
const MemberRow = Schema.Struct({
  slotId: WorktreeSlotId,
  ...WorktreeSlotMember.fields,
});
const AssignmentMember = Schema.Struct({
  repositoryId: MercurianRepositoryId,
  currentBranch: TrimmedNonEmptyString,
});
const Assignment = Schema.Struct({
  slotId: WorktreeSlotId,
  lineRootCommitId: MercurianCommitId,
  members: Schema.Array(AssignmentMember),
  lastUsedAt: Schema.DateTimeUtcFromString,
});
const MemberAssignment = Schema.Struct({
  slotId: WorktreeSlotId,
  repositoryId: MercurianRepositoryId,
  currentBranch: TrimmedNonEmptyString,
});

export class SlotStore extends Context.Service<
  SlotStore,
  {
    readonly list: (
      projectId: MercurianProjectId,
    ) => Effect.Effect<ReadonlyArray<WorktreeSlot>, SlotStoreError>;
    readonly listAll: Effect.Effect<ReadonlyArray<WorktreeSlot>, SlotStoreError>;
    readonly get: (
      slotId: WorktreeSlotId,
    ) => Effect.Effect<Option.Option<WorktreeSlot>, SlotStoreError>;
    readonly create: (slot: WorktreeSlot) => Effect.Effect<void, SlotStoreError>;
    readonly assign: (input: typeof Assignment.Type) => Effect.Effect<void, SlotStoreError>;
    readonly changes: Stream.Stream<void>;
  }
>()("t3/mercurian/worktreeSlots/SlotStore") {}

const toError =
  (operation: string) =>
  (cause: unknown): SlotStoreError =>
    Schema.isSchemaError(cause)
      ? PersistenceDecodeError.fromSchemaError(`${operation}:decode`, cause)
      : isPersistenceError(cause)
        ? cause
        : new PersistenceSqlError({ operation, cause });

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const changes = yield* PubSub.unbounded<void>();
  const slotColumns = sql`
    slot_id AS "slotId", project_id AS "projectId", path AS "path",
    current_line_root_commit_id AS "currentLineRootCommitId",
    created_at AS "createdAt", last_used_at AS "lastUsedAt"
  `;
  const memberColumns = sql`
    m.slot_id AS "slotId", m.repository_id AS "repositoryId",
    m.relative_path AS "relativePath", m.current_branch AS "currentBranch"
  `;
  const listRows = SqlSchema.findAll({
    Request: ProjectRequest,
    Result: SlotRow,
    execute: ({ projectId }) => sql`
      SELECT ${slotColumns} FROM worktree_slots WHERE project_id = ${projectId}
      ORDER BY slot_id ASC
    `,
  });
  const listAllRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: SlotRow,
    execute: () => sql`SELECT ${slotColumns} FROM worktree_slots ORDER BY project_id, slot_id`,
  });
  const findRow = SqlSchema.findOneOption({
    Request: SlotRequest,
    Result: SlotRow,
    execute: ({ slotId }) =>
      sql`SELECT ${slotColumns} FROM worktree_slots WHERE slot_id = ${slotId}`,
  });
  const listMembers = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: MemberRow,
    execute: () => sql`
      SELECT ${memberColumns} FROM worktree_slot_members m
      ORDER BY m.slot_id, m.relative_path, m.repository_id
    `,
  });
  const listProjectMembers = SqlSchema.findAll({
    Request: ProjectRequest,
    Result: MemberRow,
    execute: ({ projectId }) => sql`
      SELECT ${memberColumns}
      FROM worktree_slot_members m
      INNER JOIN worktree_slots s ON s.slot_id = m.slot_id
      WHERE s.project_id = ${projectId}
      ORDER BY m.slot_id, m.relative_path, m.repository_id
    `,
  });
  const findMembers = SqlSchema.findAll({
    Request: SlotRequest,
    Result: MemberRow,
    execute: ({ slotId }) => sql`
      SELECT ${memberColumns} FROM worktree_slot_members m
      WHERE m.slot_id = ${slotId}
      ORDER BY m.relative_path, m.repository_id
    `,
  });
  const insertSlot = SqlSchema.void({
    Request: SlotRow,
    execute: (row) => sql`
      INSERT INTO worktree_slots (
        slot_id, project_id, path, current_line_root_commit_id, created_at, last_used_at
      ) VALUES (
        ${row.slotId}, ${row.projectId}, ${row.path}, ${row.currentLineRootCommitId},
        ${row.createdAt}, ${row.lastUsedAt}
      )
    `,
  });
  const insertMember = SqlSchema.void({
    Request: MemberRow,
    execute: (row) => sql`
      INSERT INTO worktree_slot_members (
        slot_id, repository_id, relative_path, current_branch
      ) VALUES (${row.slotId}, ${row.repositoryId}, ${row.relativePath}, ${row.currentBranch})
    `,
  });
  const assignSlot = SqlSchema.void({
    Request: Schema.Struct({
      slotId: WorktreeSlotId,
      lineRootCommitId: MercurianCommitId,
      lastUsedAt: Schema.DateTimeUtcFromString,
    }),
    execute: ({ slotId, lineRootCommitId, lastUsedAt }) => sql`
      UPDATE worktree_slots SET
        current_line_root_commit_id = ${lineRootCommitId}, last_used_at = ${lastUsedAt}
      WHERE slot_id = ${slotId}
    `,
  });
  const assignMember = SqlSchema.void({
    Request: MemberAssignment,
    execute: ({ slotId, repositoryId, currentBranch }) => sql`
      UPDATE worktree_slot_members SET current_branch = ${currentBranch}
      WHERE slot_id = ${slotId} AND repository_id = ${repositoryId}
    `,
  });

  const map = <A, E, R>(effect: Effect.Effect<A, E, R>, operation: string) =>
    effect.pipe(Effect.mapError(toError(operation)));
  const announced = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.andThen(PubSub.publish(changes, undefined)), Effect.asVoid);
  const assemble = (
    rows: ReadonlyArray<typeof SlotRow.Type>,
    members: ReadonlyArray<typeof MemberRow.Type>,
  ): ReadonlyArray<WorktreeSlot> => {
    const bySlot = Map.groupBy(members, (member) => member.slotId);
    return rows.map((row) => ({
      ...row,
      members: (bySlot.get(row.slotId) ?? []).map(({ slotId: _slotId, ...member }) => member),
    }));
  };

  return SlotStore.of({
    list: (projectId) =>
      map(
        Effect.all([listRows({ projectId }), listProjectMembers({ projectId })]).pipe(
          Effect.map(([rows, members]) => assemble(rows, members)),
        ),
        "SlotStore.list",
      ),
    listAll: map(
      Effect.all([listAllRows({}), listMembers({})]).pipe(
        Effect.map(([rows, members]) => assemble(rows, members)),
      ),
      "SlotStore.listAll",
    ),
    get: (slotId) =>
      map(
        Effect.all([findRow({ slotId }), findMembers({ slotId })]).pipe(
          Effect.map(([row, members]) =>
            Option.map(row, (value) => assemble([value], members)[0]!),
          ),
        ),
        "SlotStore.get",
      ),
    create: (slot) =>
      map(
        announced(
          sql.withTransaction(
            Effect.gen(function* () {
              const { members, ...row } = slot;
              yield* insertSlot(row);
              yield* Effect.forEach(
                members,
                (member) => insertMember({ slotId: slot.slotId, ...member }),
                {
                  discard: true,
                },
              );
            }),
          ),
        ),
        "SlotStore.create",
      ),
    assign: (input) =>
      map(
        announced(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* assignSlot(input);
              yield* Effect.forEach(
                input.members,
                (member) =>
                  assignMember({
                    slotId: input.slotId,
                    ...member,
                  }),
                { discard: true },
              );
            }),
          ),
        ),
        "SlotStore.assign",
      ),
    get changes() {
      return Stream.fromPubSub(changes);
    },
  });
});

export const layer = Layer.effect(SlotStore, make);

import {
  CheckpointRef,
  EventId,
  MercurianCommitId,
  MessageId,
  PlanId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { runMigrations } from "../persistence/Migrations.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const planId = PlanId.make("plan");
export const threadId = ThreadId.make("thread");
export const turnId = TurnId.make("provider-turn");
export const query = MercurianCommitId.make("query");
export const now = "2026-09-05T00:00:00.000Z";
const base = (sequence: number) => ({
  sequence,
  eventId: EventId.make(`event-${sequence}`),
  aggregateKind: "thread" as const,
  aggregateId: threadId,
  occurredAt: now,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
});
export const streaming = (sequence = 2): OrchestrationEvent => ({
  ...base(sequence),
  type: "thread.message-sent",
  payload: {
    threadId,
    messageId: MessageId.make("reply"),
    role: "assistant",
    text: "delta",
    turnId,
    streaming: true,
    createdAt: now,
    updatedAt: now,
  },
});
export const start = (sequence = 1): OrchestrationEvent => ({
  ...base(sequence),
  type: "thread.turn-start-requested",
  payload: {
    threadId,
    messageId: MessageId.make(query),
    runtimeMode: "approval-required",
    interactionMode: "default",
    createdAt: now,
  },
});
export const interrupted = (sequence = 2): OrchestrationEvent => ({
  ...base(sequence),
  type: "thread.turn-interrupt-requested",
  payload: { threadId, createdAt: now },
});
export const deleted = (sequence = 4): OrchestrationEvent => ({
  ...base(sequence),
  type: "thread.deleted",
  payload: { threadId, deletedAt: now },
});
export const sessionSet = (
  sequence = 2,
  overrides: Partial<OrchestrationSession> = {},
): OrchestrationEvent => ({
  ...base(sequence),
  type: "thread.session-set",
  payload: {
    threadId,
    session: {
      threadId,
      status: "running",
      providerName: "codex",
      runtimeMode: "approval-required",
      activeTurnId: turnId,
      lastError: null,
      updatedAt: now,
      ...overrides,
    },
  },
});
export const captured = (
  sequence = 2,
  overrides: Partial<
    Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>["payload"]
  > = {},
): OrchestrationEvent => ({
  ...base(sequence),
  type: "thread.turn-diff-completed",
  payload: {
    threadId,
    turnId,
    requestMessageId: MessageId.make(query),
    captureTerminal: true,
    checkpointTurnCount: 1,
    checkpointRef: CheckpointRef.make("refs/checkpoints/1"),
    status: "ready",
    files: [],
    assistantMessageId: null,
    completedAt: now,
    summaryStatus: "ready",
    repositories: [
      {
        repositoryId: "repo",
        repositoryName: "Repo",
        beforeSnapshotOid: "before",
        afterSnapshotOid: "after",
        branchTipOid: "tip",
        captureStatus: "ready",
        summaryStatus: "ready",
        files: [],
      },
    ],
    ...overrides,
  },
});
export const seed = Effect.gen(function* () {
  yield* runMigrations();
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projects (project_id, name, created_at, updated_at) VALUES ('project', 'Project', '', '')`;
  yield* sql`INSERT INTO commit_histories (history_id, created_at) VALUES ('history', '')`;
  yield* sql`INSERT INTO plans (plan_id, project_id, history_id, title, created_at, updated_at) VALUES ('plan', 'project', 'history', 'Plan', '', '')`;
  yield* addQuery("query");
});
export const addQuery = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const json = yield* encodeJson({
      text: id,
      checkpointRequest: { threadId, lineRootCommitId: "query" },
    });
    yield* sql`INSERT INTO commits (commit_id, history_id, kind, author_kind, created_at, payload_json) VALUES (${id}, 'history', 'message', 'human', '', ${json})`;
  });
export const removeCheckpointRequest = (id = String(query)) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE commits SET payload_json = json_remove(payload_json, '$.checkpointRequest') WHERE commit_id = ${id}`;
  });
const appendReply = Effect.fn("test.appendReply")(function* (interrupted: boolean) {
  const sql = yield* SqlClient.SqlClient;
  const json = yield* encodeJson({
    text: "Reply",
    checkpointOwnerCommitId: query,
    reconstructionId: "exact-reconstruction",
    interrupted,
  });
  yield* sql`INSERT INTO commits (commit_id, history_id, kind, author_kind, created_at, payload_json) VALUES ('response', 'history', 'message', 'assistant', '', ${json})`;
});
export const appendResponse = appendReply(false);
export const appendInterruptedResponse = appendReply(true);

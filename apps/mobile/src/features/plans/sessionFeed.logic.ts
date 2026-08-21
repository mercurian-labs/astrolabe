import type {
  MessageId,
  OrchestrationCheckpointFile,
  OrchestrationCheckpointSummary,
  TurnId,
} from "@t3tools/contracts";

import type { ThreadFeedEntry } from "../../lib/threadActivity";

export interface SessionChangedFilesRow {
  readonly type: "session-changed-files";
  readonly id: string;
  readonly createdAt: string;
  readonly turnId: TurnId;
  readonly checkpoint: OrchestrationCheckpointSummary;
  readonly files: ReadonlyArray<OrchestrationCheckpointFile>;
}

export type SessionFeedEntry = ThreadFeedEntry | SessionChangedFilesRow;

export function deriveRevertTurnCountByUserMessageId(
  feed: ReadonlyArray<ThreadFeedEntry>,
  checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>,
): ReadonlyMap<MessageId, number> {
  const checkpointByAssistantMessageId = new Map<MessageId, OrchestrationCheckpointSummary>();
  for (const checkpoint of checkpoints) {
    if (checkpoint.status === "ready" && checkpoint.assistantMessageId !== null) {
      checkpointByAssistantMessageId.set(checkpoint.assistantMessageId, checkpoint);
    }
  }

  const messages = feed.filter(
    (entry): entry is Extract<ThreadFeedEntry, { readonly type: "message" }> =>
      entry.type === "message",
  );
  const targets = new Map<MessageId, number>();
  for (let index = 0; index < messages.length; index += 1) {
    const entry = messages[index];
    if (entry?.message.role !== "user") continue;
    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
      const next = messages[nextIndex];
      if (!next || next.message.role === "user") break;
      if (next.message.role !== "assistant") continue;
      const checkpoint = checkpointByAssistantMessageId.get(next.message.id);
      if (checkpoint === undefined) continue;
      targets.set(entry.message.id, Math.max(0, checkpoint.checkpointTurnCount - 1));
      break;
    }
  }
  return targets;
}

export function appendSessionChangedFilesRows(
  feed: ReadonlyArray<ThreadFeedEntry>,
  checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>,
  unsettledTurnId: TurnId | null,
): ReadonlyArray<SessionFeedEntry> {
  const checkpointByTurnId = new Map<TurnId, OrchestrationCheckpointSummary>();
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.status === "ready" &&
      checkpoint.turnId !== unsettledTurnId &&
      checkpoint.files.length > 0
    ) {
      checkpointByTurnId.set(checkpoint.turnId, checkpoint);
    }
  }

  const terminalAssistantIndexByTurnId = new Map<TurnId, number>();
  for (let index = 0; index < feed.length; index += 1) {
    const entry = feed[index];
    if (
      entry?.type === "message" &&
      entry.message.role === "assistant" &&
      !entry.message.streaming &&
      entry.message.turnId !== null
    ) {
      terminalAssistantIndexByTurnId.set(entry.message.turnId, index);
    }
  }

  const result: SessionFeedEntry[] = [];
  for (let index = 0; index < feed.length; index += 1) {
    const entry = feed[index];
    if (entry === undefined) continue;
    result.push(entry);
    if (
      entry.type !== "message" ||
      entry.message.role !== "assistant" ||
      entry.message.turnId === null ||
      terminalAssistantIndexByTurnId.get(entry.message.turnId) !== index
    ) {
      continue;
    }
    const checkpoint = checkpointByTurnId.get(entry.message.turnId);
    if (checkpoint === undefined) continue;
    result.push({
      type: "session-changed-files",
      id: `session-changed-files:${checkpoint.turnId}`,
      createdAt: checkpoint.completedAt,
      turnId: checkpoint.turnId,
      checkpoint,
      files: checkpoint.files,
    });
  }
  return result;
}

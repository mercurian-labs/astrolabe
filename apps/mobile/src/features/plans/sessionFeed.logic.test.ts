import {
  CheckpointRef,
  MessageId,
  TurnId,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import {
  appendSessionChangedFilesRows,
  deriveRevertTurnCountByUserMessageId,
} from "./sessionFeed.logic";

const message = (
  id: string,
  role: "user" | "assistant",
  turnId: string | null,
  streaming = false,
): ThreadFeedEntry => ({
  type: "message",
  id,
  createdAt: "2026-08-20T12:00:00.000Z",
  message: {
    id: MessageId.make(id),
    role,
    text: id,
    turnId: turnId === null ? null : TurnId.make(turnId),
    streaming,
    createdAt: "2026-08-20T12:00:00.000Z",
    updatedAt: "2026-08-20T12:00:01.000Z",
  },
});

const checkpoint = (
  turnId: string,
  assistantMessageId: string,
  checkpointTurnCount: number,
  status: OrchestrationCheckpointSummary["status"] = "ready",
): OrchestrationCheckpointSummary => ({
  turnId: TurnId.make(turnId),
  checkpointTurnCount,
  checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/${turnId}`),
  status,
  files: [{ path: "src/index.ts", kind: "modified", additions: 7, deletions: 2 }],
  assistantMessageId: MessageId.make(assistantMessageId),
  completedAt: "2026-08-20T12:00:02.000Z",
});

describe("session feed logic", () => {
  it("maps each user message to the next checkpointed assistant turn minus one", () => {
    const feed = [
      message("user-1", "user", "turn-1"),
      message("assistant-1", "assistant", "turn-1"),
      message("user-2", "user", "turn-2"),
      message("assistant-part", "assistant", "turn-2"),
      message("assistant-2", "assistant", "turn-2"),
      message("user-3", "user", "turn-3"),
    ];
    const targets = deriveRevertTurnCountByUserMessageId(feed, [
      checkpoint("turn-1", "assistant-1", 1),
      checkpoint("turn-2", "assistant-2", 4),
    ]);

    expect([...targets]).toEqual([
      ["user-1", 0],
      ["user-2", 3],
    ]);
    expect(targets.has(MessageId.make("user-3"))).toBe(false);
  });

  it("does not cross the next user boundary looking for a checkpoint", () => {
    const targets = deriveRevertTurnCountByUserMessageId(
      [
        message("user-1", "user", "turn-1"),
        message("assistant-1", "assistant", "turn-1"),
        message("user-2", "user", "turn-2"),
        message("assistant-2", "assistant", "turn-2"),
      ],
      [checkpoint("turn-2", "assistant-2", 2)],
    );
    expect(targets.has(MessageId.make("user-1"))).toBe(false);
    expect(targets.get(MessageId.make("user-2"))).toBe(1);
  });

  it("adds changed-files rows only for settled messages with ready checkpoints", () => {
    const ready = {
      ...checkpoint("turn-ready", "assistant-ready", 3),
      assistantMessageId: null,
    };
    const missing = checkpoint("turn-missing", "assistant-missing", 4, "missing");
    const presented = appendSessionChangedFilesRows(
      [
        message("assistant-ready", "assistant", "turn-ready"),
        message("assistant-running", "assistant", "turn-running", true),
        message("assistant-missing", "assistant", "turn-missing"),
      ],
      [ready, checkpoint("turn-running", "assistant-running", 4), missing],
      TurnId.make("turn-running"),
    );

    expect(presented.map((entry) => entry.type)).toEqual([
      "message",
      "session-changed-files",
      "message",
      "message",
    ]);
    expect(presented[1]).toMatchObject({
      type: "session-changed-files",
      files: [{ path: "src/index.ts", additions: 7, deletions: 2 }],
    });
  });
});

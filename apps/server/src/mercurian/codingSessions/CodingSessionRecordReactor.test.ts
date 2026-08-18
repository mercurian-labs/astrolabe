import { CommandId, EventId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { codingSessionBranchDrift } from "./CodingSessionRecordReactor.ts";

describe("CodingSessionRecordReactor", () => {
  it("projects branch drift from thread metadata events", () => {
    const threadId = ThreadId.make("thread");
    expect(
      codingSessionBranchDrift({
        eventId: EventId.make("event"),
        sequence: 1,
        aggregateKind: "thread",
        aggregateId: threadId,
        commandId: CommandId.make("command"),
        occurredAt: "2026-08-14T00:00:00.000Z",
        type: "thread.meta-updated",
        payload: { threadId, branch: "renamed/session", updatedAt: "2026-08-14T00:00:00.000Z" },
      } as never),
    ).toEqual({ threadId, branch: "renamed/session" });
  });

  it("ignores unrelated events and metadata updates without a branch", () => {
    const projectId = ProjectId.make("project");
    expect(
      codingSessionBranchDrift({
        eventId: EventId.make("event"),
        sequence: 1,
        aggregateKind: "project",
        aggregateId: projectId,
        commandId: CommandId.make("command"),
        occurredAt: "2026-08-14T00:00:00.000Z",
        type: "project.created",
        payload: {
          projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          createdAt: "2026-08-14T00:00:00.000Z",
        },
      } as never),
    ).toBeNull();
  });
});

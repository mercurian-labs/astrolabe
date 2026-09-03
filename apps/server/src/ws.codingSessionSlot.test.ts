import { MercurianRepositoryId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";

import {
  codingSessionSlotMetadataChanged,
  updateCodingSessionSlotMetadataIfChanged,
} from "./ws.ts";

describe("codingSessionSlotMetadataChanged", () => {
  it("dispatches once to upgrade a shell, then skips an unchanged second acquisition", () => {
    const desired = {
      branch: "feature/session",
      worktreePath: "/tmp/slot/server",
      workspaceMembers: [
        {
          repositoryId: MercurianRepositoryId.make("repository-server"),
          worktreePath: "/tmp/slot/server",
        },
        {
          repositoryId: MercurianRepositoryId.make("repository-web"),
          worktreePath: "/tmp/slot/web",
        },
      ],
    };
    let shell: Parameters<typeof codingSessionSlotMetadataChanged>[0] = {
      branch: desired.branch,
      worktreePath: desired.worktreePath,
    };
    let dispatches = 0;

    for (let acquisition = 0; acquisition < 2; acquisition += 1) {
      Effect.runSync(
        updateCodingSessionSlotMetadataIfChanged(
          shell,
          desired,
          Effect.sync(() => {
            dispatches += 1;
            shell = desired;
          }),
        ),
      );
    }

    expect(dispatches).toBe(1);
  });

  it("detects a changed path or member", () => {
    const repositoryId = MercurianRepositoryId.make("repository-server");
    const desired = {
      branch: "feature/session",
      worktreePath: "/tmp/slot/server",
      workspaceMembers: [{ repositoryId, worktreePath: "/tmp/slot/server" }],
    };

    expect(
      codingSessionSlotMetadataChanged(
        {
          ...desired,
          worktreePath: "/tmp/old/server",
        },
        desired,
      ),
    ).toBe(true);
    expect(
      codingSessionSlotMetadataChanged(
        {
          ...desired,
          workspaceMembers: [{ repositoryId, worktreePath: "/tmp/old/server" }],
        },
        desired,
      ),
    ).toBe(true);
  });
});

import { MercurianRepositoryId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveCodingSessionMember } from "./RepositorySwitcher";

describe("resolveCodingSessionMember", () => {
  it("selects the requested repository and falls back to the first member", () => {
    const members = [
      {
        repositoryId: MercurianRepositoryId.make("repository-server"),
        worktreePath: "/slot/server",
      },
      {
        repositoryId: MercurianRepositoryId.make("repository-web"),
        worktreePath: "/slot/web",
      },
    ];

    expect(resolveCodingSessionMember(members, "repository-web")?.worktreePath).toBe("/slot/web");
    expect(resolveCodingSessionMember(members, "unknown")?.worktreePath).toBe("/slot/server");
    expect(resolveCodingSessionMember([], null)).toBeNull();
  });
});

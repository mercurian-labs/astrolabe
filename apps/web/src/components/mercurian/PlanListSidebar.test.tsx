import { MercurianCommitId, MercurianRepositoryId, ThreadId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SidebarCodingSessionRows } from "./PlanListSidebar";

const session = {
  commitId: MercurianCommitId.make("session"),
  repositoryId: MercurianRepositoryId.make("repository"),
  threadId: ThreadId.make("thread"),
  branch: "mercurian/ship-12345678",
  worktreePath: "/tmp/session",
  baseRef: "main",
  startedAt: "2026-08-18T00:00:00.000Z",
  endedAt: null,
  outcome: null,
  prUrl: null,
} as const;

describe("PlanListSidebar coding-session details", () => {
  it("adds running and ended sessions to the detail rows", () => {
    const markup = renderToStaticMarkup(
      <SidebarCodingSessionRows
        sessions={[
          session,
          {
            ...session,
            commitId: MercurianCommitId.make("ended-session"),
            branch: "renamed/session",
            endedAt: "2026-08-18T01:00:00.000Z",
            outcome: "completed",
          },
        ]}
      />,
    );
    expect(markup).toContain("Running · mercurian/ship-12345678");
    expect(markup).toContain("Ended · renamed/session");
    expect(markup).toContain("lucide-git-branch");
  });

  it("renders no added detail markup for a plan without sessions", () => {
    expect(renderToStaticMarkup(<SidebarCodingSessionRows sessions={[]} />)).toBe("");
  });
});

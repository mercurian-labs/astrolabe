import { MercurianCommitId, MercurianRepositoryId, ThreadId } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      ...props
    }: Omit<ComponentProps<"a">, "href"> & {
      readonly to: string;
      readonly params?: Readonly<Record<string, string>>;
    }) => (
      <a {...props} href={to.replace(/\$(\w+)/g, (_match, key: string) => params?.[key] ?? "")} />
    ),
  };
});

import { SidebarCodingSessionRows, SidebarPlanHoverCardContent } from "./PlanListSidebar";

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
    expect(markup).toContain('href="/sessions/thread"');
  });

  it("keeps the plan popover content when a plan has no sessions", () => {
    const markup = renderToStaticMarkup(
      <SidebarPlanHoverCardContent title="Plan without sessions">
        <span>Project astrolabe</span>
        <SidebarCodingSessionRows sessions={[]} />
      </SidebarPlanHoverCardContent>,
    );

    expect(markup).toContain("Plan without sessions");
    expect(markup).toContain("Project astrolabe");
    expect(markup).not.toContain("/sessions/");
  });
});

import {
  MercurianRepositoryId,
  ProviderDriverKind,
  type PlanCodingSessionRecord,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { planCodingSessionRecord } from "../../test/fixtures/sessionsAndSplits";
import { codingSessionLeaf, message, planRevision } from "../../test/fixtures/timeline";

import { condensePlanGraph } from "./PlanCheckpoints.logic";
import { buildPlanGraph } from "./PlanGraph.logic";
import { PlanNodePopoverContent } from "./PlanNodePopover";

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

const renderContent = ({
  timeline,
  nodeId,
  codingSessions = [],
  stalePlan = false,
  staleSpec = false,
}: {
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  readonly nodeId: string;
  readonly codingSessions?: ReadonlyArray<PlanCodingSessionRecord>;
  readonly stalePlan?: boolean;
  readonly staleSpec?: boolean;
}) => {
  const commitGraph = buildPlanGraph(timeline);
  const node = condensePlanGraph(commitGraph).byId.get(nodeId)!;
  return renderToStaticMarkup(
    <PlanNodePopoverContent
      codingSessions={codingSessions}
      commitGraph={commitGraph}
      node={node}
      providers={[]}
      stalePlan={stalePlan}
      staleSpec={staleSpec}
      suppressUnanswered={false}
      onClose={vi.fn()}
      onEditAndBranch={vi.fn()}
    />,
  );
};

describe("PlanNodePopoverContent", () => {
  it("renders one complete checkpoint reading in the shared row grammar", () => {
    const markup = renderContent({
      nodeId: "response",
      stalePlan: true,
      staleSpec: true,
      timeline: [
        message("old-query", {
          published: true,
          createdAt: "2026-08-18T00:00:00.000Z",
          text: "Earlier turn",
          ranUnder: { provider: ProviderDriverKind.make("claudeAgent"), model: "sonnet" },
        }),
        message("query", {
          sequence: 2,
          parents: ["old-query"],
          createdAt: "2026-08-18T00:01:00.000Z",
          text: "Update the graph",
          ranUnder: { provider: ProviderDriverKind.make("codex"), model: "gpt-5" },
        }),
        planRevision("revision", {
          sequence: 3,
          parents: ["query"],
          authorKind: "assistant",
          createdAt: "2026-08-18T00:02:00.000Z",
        }),
        message("response", {
          sequence: 4,
          parents: ["revision"],
          authorKind: "assistant",
          createdAt: "2026-08-18T00:03:00.000Z",
          text: "The graph now uses checkpoint dots.",
          generatedBy: { provider: ProviderDriverKind.make("codex"), model: "gpt-5" },
        }),
      ],
    });

    expect(markup).toContain("You");
    expect(markup).toContain("Assistant");
    expect(markup.match(/Codex · gpt-5/g)).toHaveLength(1);
    expect(markup).toMatch(/>You<\/span><svg[^>]*-scale-x-100/);
    expect(markup).toMatch(/>Assistant<\/span><span[^>]*>Codex · gpt-5<\/span>/);
    expect(markup).toContain("Switched from");
    expect(markup).toContain("Claude · sonnet");
    expect(markup).toContain("Update the graph");
    expect(markup).toContain("The graph now uses checkpoint dots.");
    expect(markup).toContain("Plan updated");
    expect(markup).toContain("Spec stale");
    expect(markup).toContain("Plan may be stale");
    expect(markup).toContain("Fork here");
  });

  it("renders coding-session facts and links the recorded session", () => {
    const session = codingSessionLeaf("session", {
      sequence: 2,
      parents: ["plan"],
      createdAt: "2026-08-18T00:01:00.000Z",
      repositoryId: "repo-web",
      repositoryName: "web",
      planRevisionCommitId: "plan",
    });
    const record = planCodingSessionRecord("session", {
      repositoryId: "repo-web",
      threadId: "thread",
      branch: "feature/checkpoint-graph",
      worktreePath: "/tmp/worktree",
      baseRef: "main",
      startedAt: "2026-08-18T00:01:00.000Z",
      endedAt: null,
      outcome: null,
      prUrl: "https://example.com/pr/1",
      branchMovement: { kind: "added", count: 2 },
      departedRef: "feature/detour",
    });
    const markup = renderContent({
      nodeId: "session",
      codingSessions: [record],
      timeline: [
        planRevision("plan", {
          createdAt: "2026-08-18T00:00:00.000Z",
        }),
        session,
      ],
    });

    expect(markup).toContain("Coding session in web");
    expect(markup).toContain("Running");
    expect(markup).toContain("feature/checkpoint-graph");
    expect(markup).toContain("2 commits added");
    expect(markup).toContain("Departed to");
    expect(markup).toContain("feature/detour");
    expect(markup).toContain("Pull request");
    expect(markup).toContain("Open line");
    expect(markup).toContain('href="/sessions/thread"');
    expect(markup).not.toContain("Fork here");
  });

  it("renders every repository and pull request for a project-scoped session", () => {
    const session = codingSessionLeaf("session-multi", {
      sequence: 2,
      parents: ["plan"],
      repositoryId: null,
      planRevisionCommitId: "plan",
    });
    const record = planCodingSessionRecord("session-multi", {
      repositoryId: null,
      threadId: "thread-multi",
      repositories: [
        {
          repositoryId: MercurianRepositoryId.make("repo-server"),
          repositoryName: "server",
          snapshotOid: "server-snapshot",
          snapshotKind: "settled",
          branchTipOid: "server-oid",
          departedRef: null,
          branchMovement: { kind: "added", count: 1 },
          prUrl: "https://example.com/server/pr/1",
        },
        {
          repositoryId: MercurianRepositoryId.make("repo-web"),
          repositoryName: "web",
          snapshotOid: null,
          snapshotKind: null,
          branchTipOid: null,
          departedRef: null,
          branchMovement: null,
          prUrl: "https://example.com/web/pr/2",
        },
      ],
    });
    const markup = renderContent({
      nodeId: "session-multi",
      codingSessions: [record],
      timeline: [planRevision("plan"), session],
    });

    expect(markup).toContain("server · 1 commit added");
    expect(markup).toContain("web · not yet built");
    expect(markup).toContain('href="https://example.com/server/pr/1"');
    expect(markup).toContain('href="https://example.com/web/pr/2"');
    expect(markup).not.toContain("Repository</span><span");
  });

  it("uses mirrored and unmirrored bubbles for standalone human and assistant messages", () => {
    const timeline: ReadonlyArray<PlanTimelineItem> = [
      planRevision("left", {
        createdAt: "2026-08-18T00:00:00.000Z",
      }),
      planRevision("right", {
        sequence: 2,
        createdAt: "2026-08-18T00:01:00.000Z",
      }),
      message("human-merge", {
        sequence: 3,
        parents: ["left", "right"],
        createdAt: "2026-08-18T00:02:00.000Z",
        text: "Reconcile both plans",
      }),
      message("assistant", {
        sequence: 4,
        parents: ["human-merge"],
        authorKind: "assistant",
        createdAt: "2026-08-18T00:03:00.000Z",
        text: "Both plans are reconciled.",
      }),
    ];

    const humanMarkup = renderContent({ nodeId: "human-merge", timeline });
    const assistantMarkup = renderContent({ nodeId: "assistant", timeline });

    expect(humanMarkup).toContain("lucide-message-square");
    expect(humanMarkup).toContain("-scale-x-100");
    expect(assistantMarkup).toContain("lucide-message-square");
    expect(assistantMarkup).not.toContain("-scale-x-100");
    expect(assistantMarkup).not.toContain("lucide-git-branch");
  });

  it("names a repository projection and explains when planning continued past it", () => {
    const markup = renderContent({
      nodeId: "repository-plan",
      timeline: [
        message("parent", {
          createdAt: "2026-08-18T00:00:00.000Z",
          text: "Plan the work",
        }),
        planRevision("repository-plan", {
          sequence: 2,
          parents: ["parent"],
          createdAt: "2026-08-18T00:01:00.000Z",
          split: {
            repositoryId: "repo-web",
            repositoryName: "web",
          },
        }),
        message("continued", {
          sequence: 3,
          parents: ["parent"],
          createdAt: "2026-08-18T00:02:00.000Z",
          text: "Keep planning",
        }),
      ],
    });

    expect(markup).toContain("Plan for web");
    expect(markup).toContain("Planning has moved past this plan for web");
    expect(markup).not.toMatch(/split/i);
  });
});

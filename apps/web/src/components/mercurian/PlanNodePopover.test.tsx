import {
  MercurianCommitId,
  MercurianRepositoryId,
  ProviderDriverKind,
  type PlanCodingSessionRecord,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { condensePlanGraph } from "./PlanCheckpoints.logic";
import { buildPlanGraph } from "./PlanGraph.logic";
import { PlanNodePopoverContent } from "./PlanNodePopover";

const id = (value: string) => MercurianCommitId.make(value);

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
      ready={{
        commitId: node.commitId,
        repositoryId: MercurianRepositoryId.make("repo-web"),
        repositoryName: "web",
      }}
      stalePlan={stalePlan}
      staleSpec={staleSpec}
      suppressUnanswered={false}
      onClose={vi.fn()}
      onEditAndBranch={vi.fn()}
      onImplementFrom={vi.fn()}
      onSelect={vi.fn()}
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
        {
          _tag: "message",
          commitId: id("old-query"),
          sequence: 1,
          parents: [],
          published: true,
          authorKind: "human",
          createdAt: "2026-08-18T00:00:00.000Z",
          text: "Earlier turn",
          ranUnder: { provider: ProviderDriverKind.make("claudeAgent"), model: "sonnet" },
        },
        {
          _tag: "message",
          commitId: id("query"),
          sequence: 2,
          parents: [id("old-query")],
          published: false,
          authorKind: "human",
          createdAt: "2026-08-18T00:01:00.000Z",
          text: "Update the graph",
          ranUnder: { provider: ProviderDriverKind.make("codex"), model: "gpt-5" },
        },
        {
          _tag: "plan-revision",
          commitId: id("revision"),
          sequence: 3,
          parents: [id("query")],
          published: false,
          authorKind: "assistant",
          createdAt: "2026-08-18T00:02:00.000Z",
        },
        {
          _tag: "message",
          commitId: id("response"),
          sequence: 4,
          parents: [id("revision")],
          published: false,
          authorKind: "assistant",
          createdAt: "2026-08-18T00:03:00.000Z",
          text: "The graph now uses checkpoint dots.",
          generatedBy: { provider: ProviderDriverKind.make("codex"), model: "gpt-5" },
        },
      ],
    });

    expect(markup).toContain("You");
    expect(markup).toContain("Assistant");
    expect(markup).toContain("Codex · gpt-5");
    expect(markup).toContain("Switched from");
    expect(markup).toContain("Claude · sonnet");
    expect(markup).toContain("Update the graph");
    expect(markup).toContain("The graph now uses checkpoint dots.");
    expect(markup).toContain("Plan updated");
    expect(markup).toContain("Spec stale");
    expect(markup).toContain("Plan may be stale");
    expect(markup).toContain("Ready to implement");
    expect(markup).toContain("covers web");
    expect(markup).toContain("Continue from here");
    expect(markup).toContain("Edit and branch");
    expect(markup).toContain("Implement from here");
  });

  it("renders coding-session facts and limits the leaf to Continue", () => {
    const session: PlanTimelineItem = {
      _tag: "coding-session",
      commitId: id("session"),
      sequence: 2,
      parents: [id("plan")],
      published: false,
      authorKind: "human",
      createdAt: "2026-08-18T00:01:00.000Z",
      repositoryId: MercurianRepositoryId.make("repo-web"),
      repositoryName: "web",
      planRevisionCommitId: id("plan"),
    };
    const record: PlanCodingSessionRecord = {
      commitId: id("session"),
      repositoryId: MercurianRepositoryId.make("repo-web"),
      threadId: "thread" as PlanCodingSessionRecord["threadId"],
      branch: "feature/checkpoint-graph",
      worktreePath: "/tmp/worktree",
      baseRef: "main",
      startedAt: "2026-08-18T00:01:00.000Z",
      endedAt: null,
      outcome: null,
      prUrl: "https://example.com/pr/1",
    };
    const markup = renderContent({
      nodeId: "session",
      codingSessions: [record],
      timeline: [
        {
          _tag: "plan-revision",
          commitId: id("plan"),
          sequence: 1,
          parents: [],
          published: false,
          authorKind: "human",
          createdAt: "2026-08-18T00:00:00.000Z",
        },
        session,
      ],
    });

    expect(markup).toContain("Coding session in web");
    expect(markup).toContain("Running");
    expect(markup).toContain("feature/checkpoint-graph");
    expect(markup).toContain("Pull request");
    expect(markup).toContain("Continue from here");
    expect(markup).not.toContain("Edit and branch");
    expect(markup).not.toContain("Implement from here");
  });

  it("uses mirrored and unmirrored bubbles for standalone human and assistant messages", () => {
    const timeline: ReadonlyArray<PlanTimelineItem> = [
      {
        _tag: "plan-revision",
        commitId: id("left"),
        sequence: 1,
        parents: [],
        published: false,
        authorKind: "human",
        createdAt: "2026-08-18T00:00:00.000Z",
      },
      {
        _tag: "plan-revision",
        commitId: id("right"),
        sequence: 2,
        parents: [],
        published: false,
        authorKind: "human",
        createdAt: "2026-08-18T00:01:00.000Z",
      },
      {
        _tag: "message",
        commitId: id("human-merge"),
        sequence: 3,
        parents: [id("left"), id("right")],
        published: false,
        authorKind: "human",
        createdAt: "2026-08-18T00:02:00.000Z",
        text: "Reconcile both plans",
      },
      {
        _tag: "message",
        commitId: id("assistant"),
        sequence: 4,
        parents: [id("human-merge")],
        published: false,
        authorKind: "assistant",
        createdAt: "2026-08-18T00:03:00.000Z",
        text: "Both plans are reconciled.",
      },
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
        {
          _tag: "message",
          commitId: id("parent"),
          sequence: 1,
          parents: [],
          published: false,
          authorKind: "human",
          createdAt: "2026-08-18T00:00:00.000Z",
          text: "Plan the work",
        },
        {
          _tag: "plan-revision",
          commitId: id("repository-plan"),
          sequence: 2,
          parents: [id("parent")],
          published: false,
          authorKind: "human",
          createdAt: "2026-08-18T00:01:00.000Z",
          split: {
            repositoryId: MercurianRepositoryId.make("repo-web"),
            repositoryName: "web",
          },
        },
        {
          _tag: "message",
          commitId: id("continued"),
          sequence: 3,
          parents: [id("parent")],
          published: false,
          authorKind: "human",
          createdAt: "2026-08-18T00:02:00.000Z",
          text: "Keep planning",
        },
      ],
    });

    expect(markup).toContain("Plan for web");
    expect(markup).toContain("Planning has moved past this plan for web");
    expect(markup).not.toMatch(/split/i);
  });
});

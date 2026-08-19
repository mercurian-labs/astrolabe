import {
  MercurianCommitId,
  MercurianRepositoryId,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../../hooks/useLocalStorage";
import { DagExplorer, EXPLORER_VIEW_STORAGE_KEY, ExplorerView } from "./DagExplorer";
import { buildPlanGraph } from "./PlanGraph.logic";

const root = MercurianCommitId.make("root");
const planStaleTip = MercurianCommitId.make("plan-stale-tip");
const specStaleTip = MercurianCommitId.make("spec-stale-tip");
const timeline: ReadonlyArray<PlanTimelineItem> = [
  {
    _tag: "message",
    commitId: root,
    sequence: 1,
    parents: [],
    published: false,
    authorKind: "human",
    createdAt: "2026-08-14T00:00:00.000Z",
    text: "Review the branch",
  },
  {
    _tag: "message",
    commitId: planStaleTip,
    sequence: 2,
    parents: [root],
    published: false,
    authorKind: "human",
    createdAt: "2026-08-14T00:01:00.000Z",
    text: "Plan freshness branch",
  },
  {
    _tag: "message",
    commitId: specStaleTip,
    sequence: 3,
    parents: [root],
    published: false,
    authorKind: "human",
    createdAt: "2026-08-14T00:02:00.000Z",
    text: "Spec freshness branch",
  },
];

const checkpointTimeline: ReadonlyArray<PlanTimelineItem> = [
  {
    _tag: "message",
    commitId: MercurianCommitId.make("query"),
    sequence: 1,
    parents: [],
    published: false,
    authorKind: "human",
    createdAt: "2026-08-14T00:00:00.000Z",
    text: "Group this turn",
  },
  {
    _tag: "plan-revision",
    commitId: MercurianCommitId.make("plan-revision"),
    sequence: 2,
    parents: [MercurianCommitId.make("query")],
    published: false,
    authorKind: "assistant",
    createdAt: "2026-08-14T00:01:00.000Z",
  },
  {
    _tag: "spec-revision",
    commitId: MercurianCommitId.make("spec-revision"),
    sequence: 3,
    parents: [MercurianCommitId.make("plan-revision")],
    published: false,
    authorKind: "assistant",
    cause: "direct",
    createdAt: "2026-08-14T00:02:00.000Z",
  },
  {
    _tag: "message",
    commitId: MercurianCommitId.make("response"),
    sequence: 4,
    parents: [MercurianCommitId.make("spec-revision")],
    published: false,
    authorKind: "assistant",
    createdAt: "2026-08-14T00:03:00.000Z",
    text: "Grouped and ready",
  },
];

const renderExplorer = (
  items: ReadonlyArray<PlanTimelineItem>,
  anchoredCommitId: MercurianCommitId | null = null,
) =>
  renderToStaticMarkup(
    <DagExplorer
      anchoredCommitId={anchoredCommitId}
      graph={buildPlanGraph(items)}
      readyCommits={new Map()}
      stalePlanCommitIds={new Set()}
      staleSpecCommitIds={new Set()}
      onColumnsWidthCapChange={vi.fn()}
      onSelect={vi.fn()}
    />,
  );

describe("DagExplorer", () => {
  it("surfaces plan freshness separately from a stale spec branch", () => {
    const markup = renderToStaticMarkup(
      <DagExplorer
        anchoredCommitId={planStaleTip}
        graph={buildPlanGraph(timeline)}
        readyCommits={
          new Map([
            [
              planStaleTip,
              {
                commitId: planStaleTip,
                repositoryId: MercurianRepositoryId.make("repo-web"),
                repositoryName: "web",
              },
            ],
          ])
        }
        stalePlanCommitIds={new Set([planStaleTip])}
        staleSpecCommitIds={new Set([specStaleTip])}
        onColumnsWidthCapChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(markup).toContain("1 stale spec branch");
    expect(markup).toContain("1 plan may be stale");
    expect(markup).toContain("Plan may be stale");
    expect(markup).toContain("Ready to implement");
    expect(markup).toContain("The spec changed after the plan was last revised");
  });

  it("uses a terminal glyph and repository summary for a coding-session leaf", () => {
    const session: PlanTimelineItem = {
      _tag: "coding-session",
      commitId: MercurianCommitId.make("session"),
      sequence: 2,
      parents: [root],
      published: false,
      authorKind: "human",
      createdAt: "2026-08-14T00:01:00.000Z",
      repositoryId: MercurianRepositoryId.make("repo-web"),
      repositoryName: "web",
      planRevisionCommitId: root,
    };
    const markup = renderToStaticMarkup(
      <DagExplorer
        anchoredCommitId={session.commitId}
        graph={buildPlanGraph([timeline[0]!, session])}
        readyCommits={new Map()}
        stalePlanCommitIds={new Set()}
        staleSpecCommitIds={new Set()}
        onColumnsWidthCapChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    expect(markup).toContain("Coding session in web");
    expect(markup).toContain("lucide-square-terminal");
  });

  it("renders a checkpoint as authored query, effects, and response at the terminal id", () => {
    const markup = renderExplorer(checkpointTimeline, MercurianCommitId.make("plan-revision"));

    expect(markup).toContain("Group this turn");
    expect(markup).toContain("You");
    expect(markup).toContain("Plan updated");
    expect(markup).toContain("Spec updated");
    expect(markup).toContain("Grouped and ready");
    expect(markup).toContain("Assistant");
    expect(markup).toContain("-scale-x-100");
    expect(markup).toContain('aria-label="You: Group this turn; Assistant: Grouped and ready"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain('data-commit-id="response"');
  });

  it("does not call an actively streaming query unanswered", () => {
    const query = MercurianCommitId.make("streaming-query");
    const anchor = MercurianCommitId.make("streaming-revision");
    const markup = renderToStaticMarkup(
      <DagExplorer
        anchoredCommitId={anchor}
        graph={buildPlanGraph([
          {
            _tag: "message",
            commitId: query,
            sequence: 1,
            parents: [],
            published: false,
            authorKind: "human",
            createdAt: "2026-08-14T00:00:00.000Z",
            text: "Answering now",
          },
          {
            _tag: "plan-revision",
            commitId: anchor,
            sequence: 2,
            parents: [query],
            published: false,
            authorKind: "assistant",
            createdAt: "2026-08-14T00:01:00.000Z",
          },
        ])}
        inFlightAnchorCommitId={anchor}
        readyCommits={new Map()}
        stalePlanCommitIds={new Set()}
        staleSpecCommitIds={new Set()}
        onColumnsWidthCapChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(markup).toContain("Answering now");
    expect(markup).not.toContain("Unanswered");
  });

  it("mirrors an individual human message glyph and names its author", () => {
    const left = MercurianCommitId.make("left");
    const right = MercurianCommitId.make("right");
    const merge = MercurianCommitId.make("merge-message");
    const markup = renderExplorer(
      [
        {
          _tag: "plan-revision",
          commitId: left,
          sequence: 1,
          parents: [],
          published: false,
          authorKind: "human",
          createdAt: "2026-08-14T00:00:00.000Z",
        },
        {
          _tag: "spec-revision",
          commitId: right,
          sequence: 2,
          parents: [],
          published: false,
          authorKind: "human",
          cause: "import",
          createdAt: "2026-08-14T00:01:00.000Z",
        },
        {
          _tag: "message",
          commitId: merge,
          sequence: 3,
          parents: [left, right],
          published: false,
          authorKind: "human",
          createdAt: "2026-08-14T00:02:00.000Z",
          text: "Merge these paths",
        },
      ],
      merge,
    );

    expect(markup).toContain("-scale-x-100");
    expect(markup).toContain('aria-label="You: Merge these paths"');
  });

  it("draws the checkpoint turn glyph and double ring in Graph view", () => {
    const previous = getLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, ExplorerView);
    setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, "graph", ExplorerView);
    try {
      const markup = renderExplorer(checkpointTimeline);
      expect(markup).toContain("lucide-messages-square");
      expect(markup).toContain("checkpoint-ring");
      expect(markup).toContain('aria-label="You: Group this turn; Assistant: Grouped and ready"');
      expect(markup).toContain('data-commit-id="response"');
    } finally {
      if (previous === null) removeLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY);
      else setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, previous, ExplorerView);
    }
  });

  it("does not call an in-flight forming checkpoint unanswered in Graph view", () => {
    const previous = getLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, ExplorerView);
    const anchor = MercurianCommitId.make("forming-spec-revision");
    setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, "graph", ExplorerView);
    try {
      const markup = renderToStaticMarkup(
        <DagExplorer
          anchoredCommitId={anchor}
          graph={buildPlanGraph([
            {
              _tag: "message",
              commitId: MercurianCommitId.make("forming-query"),
              sequence: 1,
              parents: [],
              published: false,
              authorKind: "human",
              createdAt: "2026-08-14T00:00:00.000Z",
              text: "Still answering",
            },
            {
              _tag: "plan-revision",
              commitId: MercurianCommitId.make("forming-plan-revision"),
              sequence: 2,
              parents: [MercurianCommitId.make("forming-query")],
              published: false,
              authorKind: "assistant",
              createdAt: "2026-08-14T00:01:00.000Z",
            },
            {
              _tag: "spec-revision",
              commitId: anchor,
              sequence: 3,
              parents: [MercurianCommitId.make("forming-plan-revision")],
              published: false,
              authorKind: "assistant",
              cause: "direct",
              createdAt: "2026-08-14T00:02:00.000Z",
            },
          ])}
          inFlightAnchorCommitId={anchor}
          readyCommits={new Map()}
          stalePlanCommitIds={new Set()}
          staleSpecCommitIds={new Set()}
          onColumnsWidthCapChange={vi.fn()}
          onSelect={vi.fn()}
        />,
      );

      expect(markup).toContain("Still answering");
      expect(markup).toContain('data-commit-id="forming-spec-revision"');
      expect(markup).not.toContain("Unanswered");
    } finally {
      if (previous === null) removeLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY);
      else setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, previous, ExplorerView);
    }
  });
});

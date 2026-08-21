import {
  MercurianRepositoryId,
  type MercurianCommitId,
  type PlanTimelineItem,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  codingSessionLeaf,
  commitId,
  message,
  planRevision,
  specRevision,
} from "../../test/fixtures/timeline";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "../../hooks/useLocalStorage";
import {
  DagExplorer,
  DagExplorerDisplaySettingsControls,
  DagExplorerWarningsContent,
  EXPLORER_VIEW_STORAGE_KEY,
  ExplorerView,
  graphNodePopoverInteraction,
} from "./DagExplorer";
import { DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS } from "./DagExplorer.logic";
import { buildPlanGraph } from "./PlanGraph.logic";
import type { PlanNodePopoverController } from "./PlanNodePopover";
import { PlanPaneToggle } from "./PlanningSpace";

const root = commitId("root");
const planStaleTip = commitId("plan-stale-tip");
const specStaleTip = commitId("spec-stale-tip");
const timeline: ReadonlyArray<PlanTimelineItem> = [
  message("root", {
    createdAt: "2026-08-14T00:00:00.000Z",
    text: "Review the branch",
  }),
  message("plan-stale-tip", {
    sequence: 2,
    parents: ["root"],
    createdAt: "2026-08-14T00:01:00.000Z",
    text: "Plan freshness branch",
  }),
  message("spec-stale-tip", {
    sequence: 3,
    parents: ["root"],
    createdAt: "2026-08-14T00:02:00.000Z",
    text: "Spec freshness branch",
  }),
];

const checkpointTimeline: ReadonlyArray<PlanTimelineItem> = [
  message("query", {
    createdAt: "2026-08-14T00:00:00.000Z",
    text: "Group this turn",
  }),
  planRevision("plan-revision", {
    sequence: 2,
    parents: ["query"],
    authorKind: "assistant",
    createdAt: "2026-08-14T00:01:00.000Z",
  }),
  specRevision("spec-revision", {
    sequence: 3,
    parents: ["plan-revision"],
    authorKind: "assistant",
    createdAt: "2026-08-14T00:02:00.000Z",
  }),
  message("response", {
    sequence: 4,
    parents: ["spec-revision"],
    authorKind: "assistant",
    createdAt: "2026-08-14T00:03:00.000Z",
    text: "Grouped and ready",
  }),
];

const sharedExplorerProps = {
  codingSessions: [],
  providers: [],
  onEditAndBranch: vi.fn(),
  onImplementFrom: vi.fn(),
} as const;

const popoverController = () =>
  ({
    state: null,
    open: vi.fn(),
    linger: vi.fn(),
    cancelClose: vi.fn(),
    scheduleClose: vi.fn(),
    close: vi.fn(),
  }) satisfies PlanNodePopoverController;

const renderExplorer = (
  items: ReadonlyArray<PlanTimelineItem>,
  anchoredCommitId: MercurianCommitId | null = null,
) =>
  renderToStaticMarkup(
    <DagExplorer
      {...sharedExplorerProps}
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
  it("continues immediately for Graph node click and keyboard activation", () => {
    const popover = popoverController();
    const calls: Array<string> = [];
    popover.close.mockImplementation(() => calls.push("close"));
    const onSelect = vi.fn(() => calls.push("select"));
    const interaction = graphNodePopoverInteraction({
      acts: ["continue", "implement"],
      commitId: root,
      popover,
      onSelect,
    });
    const anchor = {} as Element;

    interaction.activate(anchor);
    interaction.activate(anchor);

    expect(popover.open).not.toHaveBeenCalled();
    expect(popover.close).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, root);
    expect(onSelect).toHaveBeenNthCalledWith(2, root);
    expect(calls).toEqual(["close", "select", "close", "select"]);
  });

  it("opens details when a future Graph node cannot continue", () => {
    const popover = popoverController();
    const onSelect = vi.fn();
    const interaction = graphNodePopoverInteraction({
      acts: [],
      commitId: root,
      popover,
      onSelect,
    });
    const anchor = {} as Element;

    interaction.activate(anchor);

    expect(popover.open).toHaveBeenCalledWith(root, anchor);
    expect(popover.close).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shares linger and delayed close between Graph hover and focus", () => {
    const popover = popoverController();
    const interaction = graphNodePopoverInteraction({
      acts: ["continue"],
      commitId: root,
      popover,
      onSelect: vi.fn(),
    });
    const anchor = {} as Element;

    interaction.linger(anchor);
    interaction.linger(anchor);
    interaction.scheduleClose();
    interaction.scheduleClose();

    expect(popover.linger).toHaveBeenNthCalledWith(1, root, anchor);
    expect(popover.linger).toHaveBeenNthCalledWith(2, root, anchor);
    expect(popover.scheduleClose).toHaveBeenCalledTimes(2);
  });

  it("names the pane and exposes row details without commit-level controls", () => {
    const markup = renderExplorer(checkpointTimeline);
    const settings = renderToStaticMarkup(
      <DagExplorerDisplaySettingsControls
        settings={DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS}
        onSettingsChange={vi.fn()}
      />,
    );
    const toggle = renderToStaticMarkup(
      <PlanPaneToggle
        state={{ open: true, view: "explorer", artifact: "plan" }}
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Checkpoint Graph");
    expect(markup).not.toContain('aria-label="Checkpoint Graph warnings"');
    expect(markup).toContain(
      'aria-label="Details for You: Group this turn; Assistant: Grouped and ready"',
    );
    expect(toggle).toContain('aria-label="Checkpoint Graph"');
    expect(settings).toContain("Display layout");
    expect(settings).toContain("Node size");
    expect(settings).toContain("Line thickness");
    expect(settings).not.toMatch(/Detail|Commits/);
  });

  it("surfaces plan freshness separately from a stale spec branch", () => {
    const markup = renderToStaticMarkup(
      <DagExplorer
        {...sharedExplorerProps}
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

    const warningContent = renderToStaticMarkup(
      <DagExplorerWarningsContent stalePlanCount={1} staleSpecCount={1} />,
    );

    expect(markup).toContain('aria-label="Checkpoint Graph warnings"');
    expect(markup).toContain("lucide-triangle-alert");
    expect(markup).not.toContain("1 stale spec branch");
    expect(markup).not.toContain("1 plan may be stale");
    expect(markup).toContain("Plan may be stale");
    expect(markup).toContain("Ready to implement");
    expect(warningContent).toContain("1 stale spec branch");
    expect(warningContent).toContain("spec changed since the branch&#x27;s base");
    expect(warningContent).toContain("1 plan may be stale");
    expect(warningContent).toContain("The spec changed after the plan was last revised");
  });

  it("uses a terminal glyph and repository summary for a coding-session leaf", () => {
    const session = codingSessionLeaf("session", {
      sequence: 2,
      parents: ["root"],
      createdAt: "2026-08-14T00:01:00.000Z",
      repositoryId: "repo-web",
      repositoryName: "web",
      planRevisionCommitId: "root",
    });
    const markup = renderToStaticMarkup(
      <DagExplorer
        {...sharedExplorerProps}
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
    const markup = renderExplorer(checkpointTimeline, commitId("plan-revision"));

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
    expect(markup).not.toContain('data-commit-id="query"');
    expect(markup).not.toContain('data-commit-id="plan-revision"');
    expect(markup).not.toContain('data-commit-id="spec-revision"');
  });

  it("does not call an actively streaming query unanswered", () => {
    const anchor = commitId("streaming-revision");
    const markup = renderToStaticMarkup(
      <DagExplorer
        {...sharedExplorerProps}
        anchoredCommitId={anchor}
        graph={buildPlanGraph([
          message("streaming-query", {
            createdAt: "2026-08-14T00:00:00.000Z",
            text: "Answering now",
          }),
          planRevision("streaming-revision", {
            sequence: 2,
            parents: ["streaming-query"],
            authorKind: "assistant",
            createdAt: "2026-08-14T00:01:00.000Z",
          }),
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
    const merge = commitId("merge-message");
    const markup = renderExplorer(
      [
        planRevision("left", {
          createdAt: "2026-08-14T00:00:00.000Z",
        }),
        specRevision("right", {
          sequence: 2,
          cause: "import",
          createdAt: "2026-08-14T00:01:00.000Z",
        }),
        message("merge-message", {
          sequence: 3,
          parents: ["left", "right"],
          createdAt: "2026-08-14T00:02:00.000Z",
          text: "Merge these paths",
        }),
      ],
      merge,
    );

    expect(markup).toContain("-scale-x-100");
    expect(markup).toContain('aria-label="You: Merge these paths"');
  });

  it("draws accessible monochrome Graph nodes with glyphs and no text", () => {
    const previous = getLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, ExplorerView);
    setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, "graph", ExplorerView);
    try {
      const markup = renderExplorer(checkpointTimeline);
      const start = markup.indexOf('<svg class="size-full cursor-grab');
      const graphSvg = markup.slice(
        start,
        markup.indexOf('<div class="absolute right-2 top-2', start),
      );
      expect(start).toBeGreaterThanOrEqual(0);
      expect(graphSvg).not.toContain("<text");
      expect(graphSvg).toContain("lucide-messages-square");
      expect(graphSvg).toContain("checkpoint-ring");
      expect(graphSvg).toContain("fill-background stroke-muted-foreground");
      expect(graphSvg).toContain("current-position-ring fill-none stroke-primary");
      expect(graphSvg).not.toContain("node-status-dot");
      expect(markup).toContain('aria-label="You: Group this turn; Assistant: Grouped and ready"');
      expect(markup).toContain('aria-haspopup="dialog"');
      expect(markup).toContain('data-commit-id="response"');
    } finally {
      if (previous === null) removeLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY);
      else setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, previous, ExplorerView);
    }
  });

  it("stacks readiness and stale-status dots outward from a Graph node", () => {
    const previous = getLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, ExplorerView);
    setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, "graph", ExplorerView);
    try {
      const response = commitId("response");
      const markup = renderToStaticMarkup(
        <DagExplorer
          {...sharedExplorerProps}
          anchoredCommitId={response}
          graph={buildPlanGraph(checkpointTimeline)}
          readyCommits={
            new Map([
              [
                response,
                {
                  commitId: response,
                  repositoryId: MercurianRepositoryId.make("repo-web"),
                  repositoryName: "web",
                },
              ],
            ])
          }
          stalePlanCommitIds={new Set([response])}
          staleSpecCommitIds={new Set([response])}
          onColumnsWidthCapChange={vi.fn()}
          onSelect={vi.fn()}
        />,
      );
      const start = markup.indexOf('<svg class="size-full cursor-grab');
      const graphSvg = markup.slice(
        start,
        markup.indexOf('<div class="absolute right-2 top-2', start),
      );
      const statusDots = [
        ...graphSvg.matchAll(/<circle[^>]*class="[^"]*node-status-dot[^"]*"[^>]*>/g),
      ].map(([tag]) => tag);
      const xPositions = statusDots.map((tag) => Number(tag.match(/cx="([^"]+)"/)?.[1]));

      expect(statusDots).toHaveLength(3);
      expect(statusDots[0]).toContain('data-status="ready"');
      expect(statusDots[0]).toContain("fill-emerald-500");
      expect(statusDots[1]).toContain('data-status="stale-spec"');
      expect(statusDots[1]).toContain("fill-amber-500");
      expect(statusDots[2]).toContain('data-status="stale-plan"');
      expect(statusDots[2]).toContain("fill-orange-500");
      expect(xPositions[1]).toBeGreaterThan(xPositions[0]!);
      expect(xPositions[2]).toBeGreaterThan(xPositions[1]!);
    } finally {
      if (previous === null) removeLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY);
      else setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, previous, ExplorerView);
    }
  });

  it("does not call an in-flight forming checkpoint unanswered in Graph view", () => {
    const previous = getLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, ExplorerView);
    const anchor = commitId("forming-spec-revision");
    setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, "graph", ExplorerView);
    try {
      const markup = renderToStaticMarkup(
        <DagExplorer
          {...sharedExplorerProps}
          anchoredCommitId={anchor}
          graph={buildPlanGraph([
            message("forming-query", {
              createdAt: "2026-08-14T00:00:00.000Z",
              text: "Still answering",
            }),
            planRevision("forming-plan-revision", {
              sequence: 2,
              parents: ["forming-query"],
              authorKind: "assistant",
              createdAt: "2026-08-14T00:01:00.000Z",
            }),
            specRevision("forming-spec-revision", {
              sequence: 3,
              parents: ["forming-plan-revision"],
              authorKind: "assistant",
              createdAt: "2026-08-14T00:02:00.000Z",
            }),
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

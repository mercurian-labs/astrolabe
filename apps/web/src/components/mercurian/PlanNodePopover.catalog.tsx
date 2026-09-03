import { ProviderDriverKind } from "@t3tools/contracts";
import type { ComponentProps } from "react";

import type { CatalogEntry } from "../../design-system/catalog";
import { planCodingSessionRecord } from "../../test/fixtures/sessionsAndSplits";
import { codingSessionLeaf, message, planRevision, timeline } from "../../test/fixtures/timeline";
import { condensePlanGraph } from "./PlanCheckpoints.logic";
import { buildPlanGraph } from "./PlanGraph.logic";
import { PlanNodePopoverContent } from "./PlanNodePopover";

const popoverArgs = (
  items: Parameters<typeof buildPlanGraph>[0],
  nodeId: string,
): ComponentProps<typeof PlanNodePopoverContent> => {
  const commitGraph = buildPlanGraph(items);
  const node = condensePlanGraph(commitGraph).byId.get(nodeId);
  if (node === undefined) throw new Error(`Missing catalog node: ${nodeId}`);
  return {
    codingSessions: [],
    commitGraph,
    node,
    providers: [],
    stalePlan: false,
    staleSpec: false,
    suppressUnanswered: false,
    onClose: () => undefined,
    onEditAndBranch: () => undefined,
    onImplementFrom: () => undefined,
    onSelect: () => undefined,
  };
};

const modelSwitchTimeline = timeline(
  message("previous-query", {
    published: true,
    text: "Sketch the first pass",
    ranUnder: { provider: ProviderDriverKind.make("claudeAgent"), model: "sonnet" },
  }),
  message("switch-query", {
    sequence: 2,
    parents: ["previous-query"],
    text: "Update the graph",
    ranUnder: { provider: ProviderDriverKind.make("codex"), model: "gpt-5" },
  }),
  planRevision("switch-revision", {
    sequence: 3,
    parents: ["switch-query"],
    authorKind: "assistant",
  }),
  message("switch-response", {
    sequence: 4,
    parents: ["switch-revision"],
    authorKind: "assistant",
    text: "The graph now uses checkpoint dots.",
    generatedBy: { provider: ProviderDriverKind.make("codex"), model: "gpt-5" },
  }),
);

const sessionTimeline = timeline(
  planRevision("session-plan"),
  codingSessionLeaf("session", {
    sequence: 2,
    parents: ["session-plan"],
    repositoryId: "repo-web",
    repositoryName: "web",
    planRevisionCommitId: "session-plan",
  }),
);

export const PLAN_NODE_POPOVER_CATALOG_ENTRIES = [
  {
    id: "plan-node-popover-turn-with-a-model-switch",
    section: "checkpoint-graph",
    group: "PlanNodePopover",
    title: "Turn with a model switch",
    description: "Checkpoint detail for a turn that crossed provider and model boundaries.",
    sourcePath: "src/components/mercurian/PlanNodePopover.tsx",
    render: () => (
      <PlanNodePopoverContent
        {...popoverArgs(modelSwitchTimeline, "switch-response")}
        stalePlan
        staleSpec
      />
    ),
    layout: "preview",
    preferredCanvas: "compact",
  },
  {
    id: "plan-node-popover-coding-session-leaf",
    section: "checkpoint-graph",
    group: "PlanNodePopover",
    title: "Coding-session leaf",
    description: "Checkpoint detail for a completed coding-session branch.",
    sourcePath: "src/components/mercurian/PlanNodePopover.tsx",
    render: () => (
      <PlanNodePopoverContent
        {...popoverArgs(sessionTimeline, "session")}
        codingSessions={[
          planCodingSessionRecord("session", {
            repositoryId: "repo-web",
            threadId: "identity-catalog-session",
            branch: "venk/m-143-story-catalog",
            baseRef: "main",
            prUrl: "https://example.com/pull/143",
          }),
        ]}
      />
    ),
    layout: "preview",
    preferredCanvas: "compact",
  },
] satisfies ReadonlyArray<CatalogEntry>;

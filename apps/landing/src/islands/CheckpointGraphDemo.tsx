import { DagExplorer } from "~/components/mercurian/DagExplorer";
import { buildPlanGraph } from "~/components/mercurian/PlanGraph.logic";
import { message, planRevision, specRevision, timeline } from "~/test/fixtures/timeline";

const history = timeline(
  message("foundation-query", {
    text: "Shape the marketing site foundation",
  }),
  planRevision("foundation-plan", {
    sequence: 2,
    parents: ["foundation-query"],
    authorKind: "assistant",
  }),
  specRevision("foundation-spec", {
    sequence: 3,
    parents: ["foundation-plan"],
    authorKind: "assistant",
  }),
  message("foundation-response", {
    sequence: 4,
    parents: ["foundation-spec"],
    authorKind: "assistant",
    text: "The foundation is ready to develop.",
  }),
  message("component-branch-query", {
    sequence: 5,
    parents: ["foundation-response"],
    text: "Bring the product component onto the page",
  }),
  message("static-branch-query", {
    sequence: 6,
    parents: ["foundation-response"],
    text: "Keep the static shell free of client scripts",
  }),
  planRevision("component-branch-plan", {
    sequence: 7,
    parents: ["component-branch-query"],
    authorKind: "assistant",
  }),
  specRevision("static-branch-spec", {
    sequence: 8,
    parents: ["static-branch-query"],
    authorKind: "assistant",
  }),
  message("component-branch-response", {
    sequence: 9,
    parents: ["component-branch-plan"],
    authorKind: "assistant",
    text: "The Checkpoint Graph now runs as a React island.",
  }),
  message("static-branch-response", {
    sequence: 10,
    parents: ["static-branch-spec"],
    authorKind: "assistant",
    text: "The landing page remains static.",
  }),
  message("merge-query", {
    sequence: 11,
    parents: ["component-branch-response", "static-branch-response"],
    text: "Bring both paths back together",
  }),
  planRevision("merge-plan", {
    sequence: 12,
    parents: ["merge-query"],
    authorKind: "assistant",
  }),
  specRevision("merge-spec", {
    sequence: 13,
    parents: ["merge-plan"],
    authorKind: "assistant",
  }),
  message("merge-response", {
    sequence: 14,
    parents: ["merge-spec"],
    authorKind: "assistant",
    text: "The live demo and static site now share one foundation.",
  }),
);

const graph = buildPlanGraph(history);
const anchoredCommitId = history[13]!.commitId;

const baseProps = {
  graph,
  anchoredCommitId,
  providers: [],
  codingSessions: [],
  readyCommits: new Map(),
  stalePlanCommitIds: new Set<string>(),
  staleSpecCommitIds: new Set<string>(),
  onColumnsWidthCapChange: () => undefined,
  onEditAndBranch: () => undefined,
  onImplementFrom: () => undefined,
  onSelect: () => undefined,
} as const;

export default function CheckpointGraphDemo() {
  return <DagExplorer {...baseProps} />;
}

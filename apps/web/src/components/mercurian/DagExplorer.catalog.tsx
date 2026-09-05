import type { CatalogAxeException, CatalogEntry } from "../../design-system/catalog";
import { setLocalStorageItem } from "../../hooks/useLocalStorage";
import { message, planRevision, specRevision, timeline } from "../../test/fixtures/timeline";
import {
  DagExplorer,
  EXPLORER_VIEW_STORAGE_KEY,
  ExplorerView,
  type ExplorerView as ExplorerViewType,
} from "./DagExplorer";
import { buildPlanGraph } from "./PlanGraph.logic";

const history = timeline(
  message("identity-query", { text: "Catalog the identity surfaces" }),
  planRevision("identity-plan", {
    sequence: 2,
    parents: ["identity-query"],
    authorKind: "assistant",
  }),
  specRevision("identity-spec", {
    sequence: 3,
    parents: ["identity-plan"],
    authorKind: "assistant",
  }),
  message("identity-response", {
    sequence: 4,
    parents: ["identity-spec"],
    authorKind: "assistant",
    text: "The shared catalog is ready to inspect.",
  }),
  message("web-query", {
    sequence: 5,
    parents: ["identity-response"],
    text: "Refine the web surface",
  }),
  message("mobile-query", {
    sequence: 6,
    parents: ["identity-response"],
    text: "Explore the mobile surface",
  }),
  message("web-response", {
    sequence: 7,
    parents: ["web-query"],
    authorKind: "assistant",
    text: "The web surface is refined.",
  }),
  message("mobile-response", {
    sequence: 8,
    parents: ["mobile-query"],
    authorKind: "assistant",
    text: "The mobile surface is mapped.",
  }),
);

const graph = buildPlanGraph(history);
const webResponse = history[6]!.commitId;
const mobileResponse = history[7]!.commitId;

const setupExplorerView = (view: ExplorerViewType) => () => {
  const previous = window.localStorage.getItem(EXPLORER_VIEW_STORAGE_KEY);
  setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, view, ExplorerView);
  return () => {
    if (previous === null) window.localStorage.removeItem(EXPLORER_VIEW_STORAGE_KEY);
    else window.localStorage.setItem(EXPLORER_VIEW_STORAGE_KEY, previous);
  };
};

const inheritedPaletteA11y: ReadonlyArray<CatalogAxeException> = [
  {
    ruleId: "color-contrast",
    reason: "ADR 004 fences changes to the inherited t3code palette until hard-fork cut-over.",
  },
];

const baseProps = {
  graph,
  anchoredCommitId: mobileResponse,
  historyWalkViewsEnabled: true,
  providers: [],
  codingSessions: [],
  stalePlanCommitIds: new Set<string>(),
  staleSpecCommitIds: new Set<string>(),
  onEditAndBranch: () => undefined,
  onSelect: () => undefined,
} as const;

export const DAG_EXPLORER_CATALOG_ENTRIES = [
  {
    id: "dag-explorer-thread-view",
    section: "checkpoint-graph",
    group: "DagExplorer",
    title: "Thread view",
    description: "Checkpoint history read as the selected root-to-tip thread.",
    sourcePath: "src/components/mercurian/DagExplorer.tsx",
    render: () => <DagExplorer {...baseProps} />,
    layout: "document",
    preferredCanvas: "wide",
    setup: setupExplorerView("thread"),
    axeExceptions: inheritedPaletteA11y,
  },
  {
    id: "dag-explorer-columns-at-a-fork",
    section: "checkpoint-graph",
    group: "DagExplorer",
    title: "Columns at a fork",
    description: "Checkpoint history with branch decisions held open as columns.",
    sourcePath: "src/components/mercurian/DagExplorer.tsx",
    render: () => <DagExplorer {...baseProps} />,
    layout: "document",
    preferredCanvas: "wide",
    setup: setupExplorerView("columns"),
    axeExceptions: inheritedPaletteA11y,
  },
  {
    id: "dag-explorer-graph-map",
    section: "checkpoint-graph",
    group: "DagExplorer",
    title: "Graph map",
    description: "Checkpoint history rendered as a spatial graph map.",
    sourcePath: "src/components/mercurian/DagExplorer.tsx",
    render: () => <DagExplorer {...baseProps} />,
    layout: "document",
    preferredCanvas: "wide",
    setup: setupExplorerView("graph"),
  },
  {
    id: "dag-explorer-stale-artifacts-flagged",
    section: "checkpoint-graph",
    group: "DagExplorer",
    title: "Stale artifacts flagged",
    description: "Thread history with stale plan and spec markers.",
    sourcePath: "src/components/mercurian/DagExplorer.tsx",
    render: () => (
      <DagExplorer
        {...baseProps}
        stalePlanCommitIds={new Set([webResponse])}
        staleSpecCommitIds={new Set([mobileResponse])}
      />
    ),
    layout: "document",
    preferredCanvas: "wide",
    setup: setupExplorerView("thread"),
    axeExceptions: inheritedPaletteA11y,
  },
] satisfies ReadonlyArray<CatalogEntry>;

import { MercurianRepositoryId } from "@t3tools/contracts";
import type { Decorator, Meta, StoryObj } from "@storybook/react";

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

const withExplorerView =
  (view: ExplorerViewType): Decorator =>
  (Story) => {
    setLocalStorageItem(EXPLORER_VIEW_STORAGE_KEY, view, ExplorerView);
    return <Story />;
  };

const meta = {
  title: "Mercurian/Checkpoint Graph/Dag Explorer",
  component: DagExplorer,
  parameters: { layout: "fullscreen" },
  args: {
    graph,
    anchoredCommitId: mobileResponse,
    providers: [],
    codingSessions: [],
    readyCommits: new Map(),
    stalePlanCommitIds: new Set(),
    staleSpecCommitIds: new Set(),
    onColumnsWidthCapChange: () => undefined,
    onEditAndBranch: () => undefined,
    onImplementFrom: () => undefined,
    onSelect: () => undefined,
  },
} satisfies Meta<typeof DagExplorer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreadView: Story = {
  name: "Thread view",
  decorators: [withExplorerView("thread")],
};

export const ColumnsAtAFork: Story = {
  name: "Columns at a fork",
  decorators: [withExplorerView("columns")],
};

export const GraphMap: Story = {
  name: "Graph map",
  decorators: [withExplorerView("graph")],
};

export const StaleArtifactsFlagged: Story = {
  name: "Stale artifacts flagged",
  decorators: [withExplorerView("thread")],
  args: {
    readyCommits: new Map([
      [
        webResponse,
        {
          commitId: webResponse,
          repositoryId: MercurianRepositoryId.make("repo-web"),
          repositoryName: "web",
        },
      ],
    ]),
    stalePlanCommitIds: new Set([webResponse]),
    staleSpecCommitIds: new Set([mobileResponse]),
  },
};

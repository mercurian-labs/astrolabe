import type { MemoryDashboard } from "@t3tools/contracts";
import { useState } from "react";

import type { CatalogEntry } from "../../design-system/catalog";
import type { MemorySelection } from "../../memoryPanelStore";
import { MemoryTabView, type MemoryBrowseState, type MemoryTabViewProps } from "./MemoryTab";
import {
  MEMORY_FIXTURE_ASSET_ONLY_DASHBOARD,
  MEMORY_FIXTURE_CATALOG,
  MEMORY_FIXTURE_DASHBOARD,
  MEMORY_FIXTURE_EMPTY_DASHBOARD,
  MEMORY_FIXTURE_MAP_ONLY_DASHBOARD,
} from "./MemoryTab.fixtures";
import type { MemoryDashboardState, MemoryMergeState } from "./MemoryTab.logic";

const noop = () => undefined;
const settled = async () => null;
const LATEST: MemoryTabViewProps["reading"] = { kind: "latest" };
const IDLE_MERGE: MemoryMergeState = { kind: "idle" };
const IDLE_BROWSE: MemoryBrowseState = { kind: "idle" };

/** Selection and graph state stay local so the catalog exercises the tab without the thread store. */
function CatalogMemoryTab({
  state,
  reading = LATEST,
  activeTurn = false,
  merge = IDLE_MERGE,
  browse = IDLE_BROWSE,
  graphOpen = true,
  initialSelection = null,
  historical = false,
}: {
  readonly state: MemoryDashboardState;
  readonly reading?: MemoryTabViewProps["reading"];
  readonly activeTurn?: boolean;
  readonly merge?: MemoryMergeState;
  readonly browse?: MemoryBrowseState;
  readonly graphOpen?: boolean;
  readonly initialSelection?: MemorySelection | null;
  readonly historical?: boolean;
}) {
  const [selection, setSelection] = useState<MemorySelection | null>(initialSelection);
  const [open, setOpen] = useState(graphOpen);
  const [browseState, setBrowseState] = useState<MemoryBrowseState>(browse);
  return (
    <div className="flex h-[40rem] max-h-[80vh] overflow-hidden rounded-lg border border-border">
      <MemoryTabView
        activeTurn={activeTurn}
        browse={browseState}
        graphOpen={open}
        merge={merge}
        reading={reading}
        selection={selection}
        state={state}
        onAppendDraft={noop}
        onBrowse={() => setBrowseState({ kind: "ready", catalog: MEMORY_FIXTURE_CATALOG })}
        onConfirmMerge={noop}
        onDismissMerge={noop}
        onGraphOpenChange={setOpen}
        onMarkReviewed={settled}
        onOpenDocument={noop}
        onOpenSettings={noop}
        onPrepareMerge={noop}
        onRevert={settled}
        onReturnToLatest={historical ? noop : undefined}
        onSelect={setSelection}
        onViewChanges={noop}
      />
    </div>
  );
}

const ready = (dashboard: MemoryDashboard): MemoryDashboardState => ({ kind: "ready", dashboard });

export const MEMORY_TAB_CATALOG_ENTRIES = [
  {
    id: "mercurian/memory-tab",
    section: "mercurian-grammar",
    group: "MemoryTab",
    title: "Memory needs review",
    description:
      "The line's dashboard: position notice, unreviewed amendments, the local graph of changed notes, and documents with rename, delete, restore, and revert history.",
    sourcePath: "src/components/mercurian/MemoryTab.tsx",
    render: () => (
      <CatalogMemoryTab
        initialSelection={{ kind: "document", id: "doc-composer" }}
        state={ready(MEMORY_FIXTURE_DASHBOARD)}
      />
    ),
    layout: "preview",
    preferredCanvas: "wide",
    viewportTags: ["desktop", "narrow"],
  },
  {
    id: "mercurian/memory-tab-merge-review",
    section: "mercurian-grammar",
    group: "MemoryTab",
    title: "Memory merge review prepared",
    description:
      "A prepared merge-home review with remaining unreviewed changes and parser warnings; confirmation stays disabled until everything is reviewed and prepared fresh.",
    sourcePath: "src/components/mercurian/MemoryTab.tsx",
    render: () => (
      <CatalogMemoryTab
        graphOpen={false}
        merge={{
          kind: "review",
          stale: false,
          review: {
            version: "3f1c",
            headOid: MEMORY_FIXTURE_DASHBOARD.position.headOid,
            snapshotOid: MEMORY_FIXTURE_DASHBOARD.position.snapshotOid,
            treeOid: MEMORY_FIXTURE_DASHBOARD.position.treeOid,
            homeOid: MEMORY_FIXTURE_DASHBOARD.position.baseCommitOid,
            homeRef: "refs/heads/main",
            unmarkedId: MEMORY_FIXTURE_DASHBOARD.amendments[3]!.id,
            unreviewedIds: MEMORY_FIXTURE_DASHBOARD.amendments
              .filter((amendment) => !amendment.reviewed)
              .map((amendment) => amendment.id),
            warnings: ["Product.skillmap.md declares an unknown edge type: informs."],
          },
        }}
        state={ready(MEMORY_FIXTURE_DASHBOARD)}
      />
    ),
    layout: "preview",
    preferredCanvas: "wide",
    viewportTags: ["desktop", "narrow"],
  },
  {
    id: "mercurian/memory-tab-historical",
    section: "mercurian-grammar",
    group: "MemoryTab",
    title: "Memory at an earlier checkpoint",
    description:
      "Reading captured memory at a route-selected checkpoint: review and revert are disabled and Back to now returns to the latest position.",
    sourcePath: "src/components/mercurian/MemoryTab.tsx",
    render: () => (
      <CatalogMemoryTab
        graphOpen={false}
        historical
        reading={{
          kind: "checkpoint",
          commitId: MEMORY_FIXTURE_DASHBOARD.position.lineRootCommitId,
        }}
        state={ready(MEMORY_FIXTURE_DASHBOARD)}
      />
    ),
    layout: "preview",
    preferredCanvas: "wide",
    viewportTags: ["desktop"],
  },
  {
    id: "mercurian/memory-tab-map-only",
    section: "mercurian-grammar",
    group: "MemoryTab",
    title: "Memory map-only change",
    description:
      "Only a skill map changed: it stays reviewable as a document while the graph explains that maps are never nodes.",
    sourcePath: "src/components/mercurian/MemoryTab.tsx",
    render: () => <CatalogMemoryTab activeTurn state={ready(MEMORY_FIXTURE_MAP_ONLY_DASHBOARD)} />,
    layout: "preview",
    preferredCanvas: "wide",
    viewportTags: ["desktop"],
  },
  {
    id: "mercurian/memory-tab-asset-only",
    section: "mercurian-grammar",
    group: "MemoryTab",
    title: "Memory asset-only amendment",
    description:
      "An amendment that changed no memory documents stays listed and reviewable, and the graph says why it draws nothing.",
    sourcePath: "src/components/mercurian/MemoryTab.tsx",
    render: () => <CatalogMemoryTab state={ready(MEMORY_FIXTURE_ASSET_ONLY_DASHBOARD)} />,
    layout: "preview",
    preferredCanvas: "wide",
    viewportTags: ["desktop"],
  },
  {
    id: "mercurian/memory-tab-empty",
    section: "mercurian-grammar",
    group: "MemoryTab",
    title: "Memory with nothing changed",
    description:
      "A line that has not touched memory offers Browse memory over the captured catalog.",
    sourcePath: "src/components/mercurian/MemoryTab.tsx",
    render: () => (
      <CatalogMemoryTab
        browse={{ kind: "ready", catalog: MEMORY_FIXTURE_CATALOG }}
        graphOpen={false}
        state={ready(MEMORY_FIXTURE_EMPTY_DASHBOARD)}
      />
    ),
    layout: "preview",
    preferredCanvas: "wide",
    viewportTags: ["desktop", "narrow"],
  },
  {
    id: "mercurian/memory-tab-unavailable",
    section: "mercurian-grammar",
    group: "MemoryTab",
    title: "Memory not designated",
    description:
      "The unavailable states: no designation with the settings door, missing history, and read errors.",
    sourcePath: "src/components/mercurian/MemoryTab.tsx",
    render: () => (
      <div className="grid gap-3 md:grid-cols-3">
        <CatalogMemoryTab state={ready({ kind: "unavailable", reason: "not-designated" })} />
        <CatalogMemoryTab
          historical
          reading={{
            kind: "checkpoint",
            commitId: MEMORY_FIXTURE_DASHBOARD.position.lineRootCommitId,
          }}
          state={ready({ kind: "unavailable", reason: "checkpoint-missing" })}
        />
        <CatalogMemoryTab
          state={{
            kind: "error",
            message: "The memory repository is not registered on this environment.",
          }}
        />
      </div>
    ),
    layout: "preview",
    preferredCanvas: "wide",
    viewportTags: ["desktop"],
  },
] satisfies ReadonlyArray<CatalogEntry>;

import { ProjectDocumentsPanel, useProjectDocumentsPanel } from "./ProjectDocumentsPanel";
import { useStorageSources } from "../../state/mercurianStorage";
/** Owned by the panel lane of M-197 (plan §6). Fills the right-panel surface slots of ChatView for a plan line. */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { MercurianCommitId, PlanCheckpointRecord, PlanDetail } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import { useDiffPanelStore } from "../../diffPanelStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { useMercurianTree } from "../../state/mercurian";
import { usePlanningModel } from "../../state/mercurianWorkspace";
import { navigateToThreadRoute } from "../../threadRoutes";
import { DagExplorer } from "./DagExplorer";
import { MemoryTab } from "./MemoryTab";
import { memoryReadingPositionFor } from "./MemoryTab.logic";
import { resolveLineInFlightTurn } from "./ThreadSpaceChrome.logic";
import { LATEST, positionAfterPick, resolveHead } from "./PlanPosition.logic";
import { stalePlanLeafIds, staleSpecLeafIds } from "./SpecArtifact.logic";
import { useThreadSpace } from "./ThreadSpaceContext";
import { lineThreadIdForCommit, resolveLineTip } from "./planLineOwnership.logic";
import { useContinueFromCheckpoint, useForkHere } from "./useForkHere";
import { useLineMemoryDashboard } from "./useLineMemoryDashboard";

export type ThreadSpaceSurfaces = Readonly<{
  planPanel?: ReactNode;
  planUnavailableReason?: string;
  memoryPanel?: ReactNode;
  /** Unreviewed memory changes; badges the Memory tab whether or not it is mounted. */
  memoryBadgeCount?: number;
  checkpointsPanel?: ReactNode;
}>;

const EMPTY_IN_FLIGHT_TURNS: PlanDetail["inFlightTurns"] = [];
const EMPTY_CODING_SESSIONS: PlanDetail["codingSessions"] = [];
const EMPTY_CHECKPOINT_RECORDS: ReadonlyArray<PlanCheckpointRecord> = [];

export function useThreadSpaceSurfaces(): ThreadSpaceSurfaces {
  const { planId, projectId, threadId, environmentId, detail, graph, search } = useThreadSpace();
  const router = useRouter();
  const { snapshot: storage } = useStorageSources();
  const documentPanel = useProjectDocumentsPanel();
  const planningModel = usePlanningModel();
  const { snapshot: tree } = useMercurianTree();
  const forkHere = useForkHere();
  const continueFromCheckpoint = useContinueFromCheckpoint();
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );

  useEffect(() => {
    useRightPanelStore.getState().seedMercurianLinePanel(threadRef);
  }, [threadRef]);

  const runtime = detail?.lineRuntimes.find((candidate) => candidate.threadId === threadId) ?? null;
  const lineTip = resolveLineTip(detail, graph, runtime, tree.threadPlanLinks);
  const position = useMemo(
    () =>
      search.at !== undefined
        ? positionAfterPick(graph, search.at)
        : lineTip !== null
          ? positionAfterPick(graph, lineTip)
          : LATEST,
    [graph, lineTip, search.at],
  );
  const head = resolveHead(graph, position);
  const viewingPast = search.at !== undefined && head !== lineTip;
  const backToNow = useCallback(() => {
    if (planId === null) return;
    void navigateToThreadRoute(router, { kind: "server", threadRef, planId });
  }, [planId, router, threadRef]);
  const staleSpecLeaves = useMemo(() => staleSpecLeafIds(graph), [graph]);
  const stalePlanLeaves = useMemo(() => stalePlanLeafIds(graph), [graph]);
  const selectCheckpoint = useCallback(
    (commitId: MercurianCommitId) => {
      if (planId === null) return;
      const lineThreadId =
        detail === null
          ? null
          : lineThreadIdForCommit({
              commitId,
              detail,
              graph,
              threadPlanLinks: tree.threadPlanLinks,
            });
      const targetRef = scopeThreadRef(environmentId, lineThreadId ?? threadId);
      void navigateToThreadRoute(router, {
        kind: "server",
        threadRef: targetRef,
        planId,
        ...(lineThreadId === null ? { line: null } : {}),
        at: commitId,
      });
    },
    [detail, environmentId, graph, planId, router, threadId, tree.threadPlanLinks],
  );
  const editAndBranch = useCallback(
    (query: Extract<PlanDetail["timeline"][number], { readonly _tag: "message" }>) => {
      const parentCommitId = graph.byId.get(query.commitId)?.parents[0];
      if (parentCommitId === undefined) return;
      void forkHere({ parentCommitId, seedText: query.text });
    },
    [forkHere, graph.byId],
  );
  const memoryReading = useMemo(
    () => memoryReadingPositionFor({ viewingPast, head }),
    [head, viewingPast],
  );
  const memory = useLineMemoryDashboard({
    environmentId,
    projectId,
    threadId,
    reading: memoryReading,
  });
  const memoryActiveTurn =
    resolveLineInFlightTurn(detail, graph, runtime, tree.threadPlanLinks) !== undefined;
  const projectName = tree.projects.find((project) => project.projectId === projectId)?.name ?? "";
  const memoryUnreviewedCount =
    memory.state.kind === "ready" && memory.state.dashboard.kind === "available"
      ? memory.state.dashboard.unreviewedCount
      : 0;

  const openChanges = useCallback(
    (record: PlanCheckpointRecord, repositoryId: string) => {
      useDiffPanelStore.getState().selectCheckpoint(threadRef, {
        planId: record.planId,
        ownerCommitId: record.ownerCommitId,
        repositoryId,
      });
      useRightPanelStore.getState().open(threadRef, "diff");
    },
    [threadRef],
  );
  const continueFrom = useCallback(
    (record: PlanCheckpointRecord) => {
      void continueFromCheckpoint(record);
    },
    [continueFromCheckpoint],
  );

  const inFlightTurns = detail?.inFlightTurns ?? EMPTY_IN_FLIGHT_TURNS;
  const codingSessions = detail?.codingSessions ?? EMPTY_CODING_SESSIONS;
  return {
    planPanel: <ProjectDocumentsPanel state={documentPanel} />,
    ...(storage.sources.some(
      (source) => source.projectId === documentPanel.projectId && source.kind !== "memory",
    ) ||
    (documentPanel.result === null && documentPanel.error === null) ||
    documentPanel.result?.hasHistory ||
    (documentPanel.result?.problems.length ?? 0) > 0
      ? {}
      : { planUnavailableReason: "Choose a location for plans or specs in project settings." }),
    memoryPanel:
      planId === null ? (
        <div className="px-3 py-6 text-sm text-muted-foreground">Reading this line's memory…</div>
      ) : (
        <MemoryTab
          activeTurn={memoryActiveTurn}
          environmentId={environmentId}
          invalidationTick={memory.invalidationTick}
          projectId={projectId}
          projectName={projectName}
          reading={memoryReading}
          refresh={memory.refresh}
          state={memory.state}
          threadRef={threadRef}
          onReturnToLatest={viewingPast ? backToNow : undefined}
        />
      ),
    memoryBadgeCount: memoryUnreviewedCount,
    checkpointsPanel: (
      <DagExplorer
        checkpointRecords={detail?.checkpoints ?? EMPTY_CHECKPOINT_RECORDS}
        onOpenChanges={openChanges}
        onContinueFromCheckpoint={continueFrom}
        anchoredCommitId={head}
        codingSessions={codingSessions}
        graph={graph}
        inFlightAnchorCommitIds={inFlightTurns.map((turn) => turn.parentCommitId)}
        providers={planningModel.providers}
        stalePlanCommitIds={stalePlanLeaves}
        staleSpecCommitIds={staleSpecLeaves}
        onEditAndBranch={editAndBranch}
        onSelect={selectCheckpoint}
      />
    ),
  };
}

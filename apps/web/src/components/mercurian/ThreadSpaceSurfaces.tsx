/** Owned by the panel lane of M-197 (plan §6). Fills the right-panel surface slots of ChatView for a plan line. */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { MercurianCommitId, PlanDetail, PlanSpecAt } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useRightPanelStore } from "../../rightPanelStore";
import { useGetPlanTextAt, useGetSpecAt, useMercurianTree } from "../../state/mercurian";
import { usePlanningModel } from "../../state/mercurianWorkspace";
import { navigateToThreadRoute } from "../../threadRoutes";
import { Button } from "../ui/button";
import { DagExplorer } from "./DagExplorer";
import { MemoryTab } from "./MemoryTab";
import { PlanArtifact } from "./PlanArtifact";
import { snapshotTextIsForPath } from "./PlanArtifact.logic";
import { ancestorClosure } from "./PlanGraph.logic";
import { LATEST, positionAfterPick, resolveHead } from "./PlanPosition.logic";
import { SpecArtifact } from "./SpecArtifact";
import { snapshotSpecIsForPath, stalePlanLeafIds, staleSpecLeafIds } from "./SpecArtifact.logic";
import { useThreadSpace } from "./ThreadSpaceContext";
import { lineThreadIdForCommit, resolveLineTip } from "./planLineOwnership.logic";
import { useForkHere } from "./useForkHere";

export type ThreadSpaceSurfaces = Readonly<{
  planPanel?: ReactNode;
  specPanel?: ReactNode;
  memoryPanel?: ReactNode;
  checkpointsPanel?: ReactNode;
}>;

const EMPTY_IN_FLIGHT_TURNS: PlanDetail["inFlightTurns"] = [];
const EMPTY_CODING_SESSIONS: PlanDetail["codingSessions"] = [];
const EMPTY_TIMELINE: PlanDetail["timeline"] = [];

function HistoricalArtifactPlaceholder({ children }: { readonly children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 px-3 py-6 sm:px-4">
      <p className="text-sm text-muted-foreground/70">{children}</p>
    </div>
  );
}

export function useThreadSpaceSurfaces(): ThreadSpaceSurfaces {
  const { planId, threadId, environmentId, detail, graph, search } = useThreadSpace();
  const router = useRouter();
  const getPlanTextAt = useGetPlanTextAt();
  const getSpecAt = useGetSpecAt();
  const planningModel = usePlanningModel();
  const { snapshot: tree } = useMercurianTree();
  const forkHere = useForkHere();
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );

  useEffect(() => {
    useRightPanelStore.getState().seedMercurianLinePanel(threadRef);
  }, [threadRef]);

  const timeline = detail?.timeline ?? EMPTY_TIMELINE;
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
  const visibleTimeline = useMemo(() => {
    if (head === null) return timeline;
    const ancestry = ancestorClosure(graph, head);
    return timeline.filter((item) => ancestry.has(item.commitId));
  }, [graph, head, timeline]);
  const staleSpecLeaves = useMemo(() => staleSpecLeafIds(graph), [graph]);
  const stalePlanLeaves = useMemo(() => stalePlanLeafIds(graph), [graph]);
  const needsPathText = head !== null && !snapshotTextIsForPath(timeline, visibleTimeline);
  const needsPathSpec = head !== null && !snapshotSpecIsForPath(timeline, visibleTimeline);
  const [pathText, setPathText] = useState<{
    readonly commitId: MercurianCommitId;
    readonly value: string;
  } | null>(null);
  const [pathSpec, setPathSpec] = useState<{
    readonly commitId: MercurianCommitId;
    readonly value: PlanSpecAt | null;
  } | null>(null);

  useEffect(() => {
    if (planId === null || !needsPathText || head === null) return;
    let cancelled = false;
    void getPlanTextAt(planId, head).then((result) => {
      if (!cancelled && result !== null) {
        setPathText({ commitId: head, value: result.planText });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [getPlanTextAt, head, needsPathText, planId]);

  useEffect(() => {
    if (planId === null || !needsPathSpec || head === null) return;
    let cancelled = false;
    void getSpecAt(planId, head).then((result) => {
      if (!cancelled && result !== null) {
        setPathSpec({ commitId: head, value: result.spec });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [getSpecAt, head, needsPathSpec, planId]);

  const backToNow = useCallback(() => {
    if (planId === null) return;
    void navigateToThreadRoute(router, { kind: "server", threadRef, planId });
  }, [planId, router, threadRef]);
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
  const reconcileMemory = useCallback(
    (message: string) => {
      const drafts = useComposerDraftStore.getState();
      const prompt = drafts.getComposerDraft(threadRef)?.prompt ?? "";
      drafts.setPrompt(threadRef, prompt.length === 0 ? message : `${prompt}\n\n${message}`);
    },
    [threadRef],
  );

  const artifactText =
    planId === null
      ? ""
      : needsPathText
        ? pathText?.commitId === head
          ? pathText.value
          : null
        : (detail?.planText ?? null);
  const artifactSpec =
    planId === null
      ? null
      : needsPathSpec
        ? pathSpec?.commitId === head
          ? pathSpec.value
          : undefined
        : detail?.spec;
  const readOnlyAction = viewingPast ? (
    <Button size="sm" variant="ghost" onClick={backToNow}>
      Back to now
    </Button>
  ) : undefined;
  const inFlightTurns = detail?.inFlightTurns ?? EMPTY_IN_FLIGHT_TURNS;
  const codingSessions = detail?.codingSessions ?? EMPTY_CODING_SESSIONS;
  return {
    planPanel:
      artifactText === null ? (
        <HistoricalArtifactPlaceholder>
          {viewingPast ? "Reading the plan as of then…" : "Reading the plan…"}
        </HistoricalArtifactPlaceholder>
      ) : (
        <PlanArtifact
          planText={artifactText}
          {...(readOnlyAction === undefined ? {} : { readOnlyAction })}
        />
      ),
    specPanel:
      artifactSpec === undefined ? (
        <HistoricalArtifactPlaceholder>
          {viewingPast ? "Reading the spec as of then…" : "Reading the spec…"}
        </HistoricalArtifactPlaceholder>
      ) : (
        <SpecArtifact
          spec={artifactSpec}
          {...(detail?.origin === undefined ? {} : { origin: detail.origin })}
          {...(readOnlyAction === undefined ? {} : { readOnlyAction })}
        />
      ),
    memoryPanel:
      planId === null ? (
        <HistoricalArtifactPlaceholder>Reading this line's memory…</HistoricalArtifactPlaceholder>
      ) : viewingPast ? (
        <HistoricalArtifactPlaceholder>
          Memory review is available at the latest position. Return to now to curate this line.
        </HistoricalArtifactPlaceholder>
      ) : (
        <MemoryTab
          environmentId={environmentId}
          line={{ threadId }}
          onReconcile={reconcileMemory}
          worktreePath={runtime?.worktreePath ?? null}
        />
      ),
    checkpointsPanel: (
      <DagExplorer
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

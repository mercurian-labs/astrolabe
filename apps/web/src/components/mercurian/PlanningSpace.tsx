import {
  resolvePlanningModel,
  type EnvironmentId,
  MercurianCommitId,
  type MercurianProjectId,
  type MemoryNote,
  type PlanId,
  type PlanInFlightTurn,
  type PlanSpecAt,
  type PlanTimelineItem,
  type PlanReconstructionMeasure,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ChevronDownIcon,
  CircleDotIcon,
  ClockIcon,
  FileTextIcon,
  SquareTerminalIcon,
  WaypointsIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useAssetUrls } from "../../assets/assetUrls";
import { useExperiments } from "../../lib/experiments";
import { randomUUID } from "../../lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { cn } from "../../lib/utils";
import {
  EMPTY_PLAN_COMPOSER_DRAFT,
  usePlanComposerStore,
  type PlanComposerAttachment,
} from "../../planComposerStore";
import { usePlanDraftStore } from "../../planDraftStore";
import { useCodingSessionDraftStore } from "../../codingSessionDraftStore";
import { usePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../../state/environments";
import {
  useAnswerPlanningQuestion,
  useAppendPlanMessage,
  useCreatePlan,
  useGetPlanTextAt,
  useGetSpecAt,
  useMeasurePlanReconstruction,
  usePlanDetail,
  useRecreateLineBranch,
  useStopPlanningTurn,
  useVisitPlan,
} from "../../state/mercurian";
import { usePlanningModel } from "../../state/mercurianWorkspace";
import { useReadMemoryNote } from "../../state/mercurianMemory";
import { WORKSPACE_PANE_TITLE_BAR_CLASS } from "../../workspaceTitlebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DagExplorer,
  DEFAULT_EXPLORER_VIEW,
  EXPLORER_VIEW_STORAGE_KEY,
  ExplorerView,
} from "./DagExplorer";
import { ImportIssueDialog } from "./ImportIssueDialog";
import { PlanArtifact } from "./PlanArtifact";
import { snapshotTextIsForPath } from "./PlanArtifact.logic";
import {
  PlanComposer,
  toPlanComposerAttachment,
  type PlanComposerSubmission,
} from "./PlanComposer";
import {
  memoryAmendmentFailureNotice,
  planningModelGateNotice,
  turnRefusalNotice,
} from "./PlanComposer.logic";
import { condensePlanGraph } from "./PlanCheckpoints.logic";
import { usePlanMentionCandidates } from "./PlanMentionSources";
import { ancestorClosure, buildPlanGraph, effectivePlanExplorerView } from "./PlanGraph.logic";
import { standingModelChoice } from "./PlanModelChoice.logic";
import { PlanModelPicker } from "./PlanModelPicker";
import { PlanReconstructionMeter } from "./PlanReconstructionMeter";
import { PlanTraitsPicker } from "./PlanTraitsPicker";
import { resolveImplementFrom } from "./PlanNodePopover.logic";
import {
  advance,
  isViewingPast,
  LATEST,
  positionAfterPick,
  resolveHead,
  resolveActingHead,
  type PlanPosition,
} from "./PlanPosition.logic";
import { PlanTimeline } from "./PlanTimeline";
import { MemoryNoteReader } from "./MemoryNoteReader";
import { MemoryAmendmentSheet } from "./MemoryAmendmentSheet";
import { SpecArtifact } from "./SpecArtifact";
import { snapshotSpecIsForPath, stalePlanLeafIds, staleSpecLeafIds } from "./SpecArtifact.logic";
import { CodingSessionDraftSheet } from "./CodingSessionDraftSheet";
import {
  createCodingSessionDraft,
  seedCodingSessionModelSelection,
} from "./codingSessionDraft.logic";

const RIGHT_PANE_WIDTH_STORAGE_KEY = "mercurian:plan-right-pane-width:v1";
const RIGHT_PANE_DEFAULT_WIDTH = 480;
const RIGHT_PANE_MIN_WIDTH = 280;
const RIGHT_PANE_MAX_WIDTH = 900;
const RIGHT_PANE_THREAD_MAX_WIDTH = 560;
const CONVERSATION_MIN_WIDTH = 480;

const RIGHT_PANE_STORAGE_KEY = "mercurian:plan-right-pane:v2";
const RightPaneState = Schema.Struct({
  open: Schema.Boolean,
  view: Schema.Literals(["artifact", "explorer"]),
  artifact: Schema.Literals(["plan", "spec"]),
});
type RightPaneState = typeof RightPaneState.Type;

/**
 * A plan opens with its plan visible and its Checkpoint Graph one toggle away. The
 * preference is not keyed by plan on purpose: which view you prefer is a fact
 * about you, not about the issue, so it follows you across plans.
 */
const DEFAULT_RIGHT_PANE: RightPaneState = { open: true, view: "artifact", artifact: "plan" };

/** One identity for "nothing yet", so the derived graph is not rebuilt for it. */
const EMPTY_TIMELINE: ReadonlyArray<PlanTimelineItem> = [];
const EMPTY_IN_FLIGHT_TURNS: ReadonlyArray<PlanInFlightTurn> = [];
type PlanHumanMessage = Extract<PlanTimelineItem, { readonly _tag: "message" }>;

function implementDisabledReason(input: {
  readonly turnActive: boolean;
  readonly planTextEmpty: boolean;
}): string | null {
  if (input.turnActive) return "Wait for the current plan turn to finish.";
  if (input.planTextEmpty) return "Write a plan before implementing it.";
  return null;
}

interface PendingEditAndBranch {
  readonly query: PlanHumanMessage;
  readonly parentCommitId: MercurianCommitId;
}

/**
 * The planning space: the conversation as the main content, with the plan's
 * two standing views — the artifact and the DAG explorer — sharing the right
 * pane, chosen from the icons in the top-right corner.
 *
 * Nothing here holds plan state. The artifact, the conversation, and the
 * explorer are three readings of one subscription over the plan's commits, so
 * a commit landing anywhere shows up in all three at once.
 */
export function PlanningSpace({ planId }: { readonly planId: PlanId }) {
  const { detail, isPending, error, turnRefusal, memoryAmendmentFailure } = usePlanDetail(planId);
  const appendMessage = useAppendPlanMessage();
  const getPlanTextAt = useGetPlanTextAt();
  const getSpecAt = useGetSpecAt();
  const measurePlanReconstruction = useMeasurePlanReconstruction();
  const visitPlan = useVisitPlan();
  const stopTurn = useStopPlanningTurn();
  const answerQuestion = useAnswerPlanningQuestion();
  const [memoryAmendmentSheetOpen, setMemoryAmendmentSheetOpen] = useState(false);
  const [dismissedMemoryAmendmentFailure, setDismissedMemoryAmendmentFailure] = useState<
    string | null
  >(null);
  const [pendingEditAndBranch, setPendingEditAndBranch] = useState<PendingEditAndBranch | null>(
    null,
  );
  const [sessionDraftId, setSessionDraftId] = useState<string | null>(null);
  const [missingLineBranchDoor, setMissingLineBranchDoor] = useState<{
    readonly commitId: MercurianCommitId;
  } | null>(null);
  // The same resolution the server runs, read here so sending gates with the
  // reason stated instead of failing silently. The two can only disagree for
  // the width of a race, which `turn-refused` covers.
  const planningModel = usePlanningModel();
  const settings = usePrimarySettings();
  const environmentId = usePrimaryEnvironmentId();
  const recreateLineBranch = useRecreateLineBranch();
  const openSessionDraft = useCodingSessionDraftStore((state) => state.openDraft);
  const lastSessionModel = useCodingSessionDraftStore((state) => state.lastModelSelection);
  const materializeSessionDraft = useCallback(
    (parentCommitId: MercurianCommitId) => {
      const modelSelection = seedCodingSessionModelSelection(
        planningModel.providers,
        settings,
        lastSessionModel,
      );
      if (modelSelection === null) return null;
      const draftId = randomUUID();
      const draft = openSessionDraft(
        createCodingSessionDraft({
          draftId,
          planId,
          parentCommitId,
          modelSelection,
          createdAt: new Date().toISOString(),
        }),
      );
      return draft.draftId;
    },
    [lastSessionModel, openSessionDraft, planId, planningModel.providers, settings],
  );
  const [pane, setPane] = useLocalStorage(
    RIGHT_PANE_STORAGE_KEY,
    DEFAULT_RIGHT_PANE,
    RightPaneState,
  );
  const [explorerView] = useLocalStorage(
    EXPLORER_VIEW_STORAGE_KEY,
    DEFAULT_EXPLORER_VIEW,
    ExplorerView,
  );
  const [experiments] = useExperiments();
  const timeline = detail?.timeline ?? EMPTY_TIMELINE;
  const graph = useMemo(() => buildPlanGraph(timeline), [timeline]);
  const explorerGraph = useMemo(() => condensePlanGraph(graph), [graph]);
  const staleSpecLeaves = useMemo(() => staleSpecLeafIds(graph), [graph]);
  const stalePlanLeaves = useMemo(() => stalePlanLeafIds(graph), [graph]);
  const memoryAmendmentProposal = detail?.memoryAmendmentProposal;
  const effectiveExplorerView = effectivePlanExplorerView(
    explorerGraph,
    explorerView,
    experiments.historyWalkViews,
  );
  const [columnsWidthCap, setColumnsWidthCap] = useState(0);
  const planningSpaceRef = useRef<HTMLDivElement>(null);
  const [planningSpaceWidth, setPlanningSpaceWidth] = useState<number | null>(null);
  const rightPaneViewCap =
    pane.view === "artifact" || effectiveExplorerView === "graph"
      ? RIGHT_PANE_MAX_WIDTH
      : effectiveExplorerView === "thread"
        ? RIGHT_PANE_THREAD_MAX_WIDTH
        : columnsWidthCap;
  const rightPaneMaxWidth = Math.max(
    RIGHT_PANE_MIN_WIDTH,
    Math.min(rightPaneViewCap, planningSpaceWidth ?? rightPaneViewCap),
  );
  const { width, handlers } = useResizableWidth({
    storageKey: RIGHT_PANE_WIDTH_STORAGE_KEY,
    defaultWidth: RIGHT_PANE_DEFAULT_WIDTH,
    minWidth: RIGHT_PANE_MIN_WIDTH,
    // The columns model and root measurement report after their first layout.
    // Until then the pane's ordinary minimum is still a usable drag range.
    maxWidth: rightPaneMaxWidth,
    // Right-anchored: the handle is on the pane's left edge, and dragging it
    // leftward grows the pane.
    edge: "left",
  });
  const usesSideBySideLayout = useMediaQuery("sm");

  useLayoutEffect(() => {
    const element = planningSpaceRef.current;
    if (element === null) return;

    const updateWidth = (nextWidth: number) => {
      setPlanningSpaceWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    updateWidth(element.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) updateWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const [position, setPosition] = useState<PlanPosition>(LATEST);
  const [pathText, setPathText] = useState<string | null>(null);
  const [pathSpec, setPathSpec] = useState<PlanSpecAt | null | undefined>(undefined);
  const [reconstructionMeasure, setReconstructionMeasure] =
    useState<PlanReconstructionMeasure | null>(null);
  const setDraftText = usePlanComposerStore((state) => state.setDraftText);
  const addDraftAttachments = usePlanComposerStore((state) => state.addAttachments);
  const removeDraftAttachment = usePlanComposerStore((state) => state.removeAttachment);
  const clearDraft = usePlanComposerStore((state) => state.clearDraft);
  const setDraftModelChoice = usePlanComposerStore((state) => state.setModelChoice);
  const followDraftGrowth = usePlanComposerStore((state) => state.followGrowth);
  const adoptLegacyDraft = usePlanComposerStore((state) => state.adoptLegacyDraft);
  // The plan's project is what says which code this space can mention. With no
  // repository set, there is nothing to offer and the menu stays closed.
  const mentions = usePlanMentionCandidates(detail?.plan.projectId ?? null);
  const readMemoryNote = useReadMemoryNote();
  const [memoryReader, setMemoryReader] = useState<{ readonly stack: string[] }>({ stack: [] });
  const [memoryNote, setMemoryNote] = useState<MemoryNote | null>(null);
  const [memoryNoteLoading, setMemoryNoteLoading] = useState(false);
  const [memoryNoteError, setMemoryNoteError] = useState<string | null>(null);
  const currentMemoryNoteName = memoryReader.stack.at(-1) ?? null;
  const openMemoryNote = useCallback((name: string) => {
    setMemoryReader((current) => ({ stack: [...current.stack, name] }));
  }, []);

  useEffect(() => {
    const projectId = detail?.plan.projectId;
    if (currentMemoryNoteName === null || projectId === undefined) return;
    let active = true;
    setMemoryNoteLoading(true);
    setMemoryNoteError(null);
    setMemoryNote(null);
    void readMemoryNote({ projectId, name: currentMemoryNoteName }).then((result) => {
      if (!active) return;
      if (result.ok) setMemoryNote(result.value);
      else setMemoryNoteError(memoryReadError(result.error));
      setMemoryNoteLoading(false);
    });
    return () => {
      active = false;
    };
  }, [currentMemoryNoteName, detail?.plan.projectId, memoryReader.stack.length, readMemoryNote]);

  useEffect(() => {
    if (currentMemoryNoteName === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMemoryReader({ stack: [] });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentMemoryNoteName]);

  // Another plan is another history: whatever you were looking at there does
  // not name anything here.
  useEffect(() => {
    setPosition(LATEST);
    setPendingEditAndBranch(null);
    setMemoryReader({ stack: [] });
    setMemoryAmendmentSheetOpen(false);
    setDismissedMemoryAmendmentFailure(null);
  }, [planId]);

  /**
   * Being here is seeing it: opening the plan clears its unseen dot, and
   * activity that lands while you watch is marked seen as it arrives — which
   * is what keeps your own sends from flashing your own row.
   *
   * Deliberately unguarded. Guarding would need the tree row's `visitedAt`,
   * which this surface has no business reading; the server already refuses to
   * write — or announce — a visit that changes nothing.
   */
  const planUpdatedAt = detail?.plan.updatedAt;
  useEffect(() => {
    if (planUpdatedAt === undefined) return;
    void visitPlan(planId);
  }, [planId, planUpdatedAt, visitPlan]);

  /**
   * Standing somewhere live means riding that branch forward: a commit landing
   * on this line moves the surface onto it, and a commit landing anywhere else
   * in the DAG moves nothing. Looking back never moves at all.
   */
  useEffect(() => setPosition((current) => advance(graph, current)), [graph]);

  /**
   * Live drafts ride their branch exactly the way a live position does — the
   * same advance, then the session-leaf step-back — so the unsent message is
   * still in the composer after a reply settles under it. Deterministic and
   * idempotent, so windows racing the same growth converge.
   */
  useEffect(() => {
    followDraftGrowth(planId, (headId) => {
      const commitId = headId as MercurianCommitId;
      if (!graph.byId.has(commitId)) return null;
      return resolveActingHead(
        graph,
        resolveHead(graph, advance(graph, { _tag: "at", commitId, live: true })),
      );
    });
  }, [followDraftGrowth, graph, planId]);

  const head = resolveHead(graph, position);
  const actingHead = resolveActingHead(graph, head);
  const viewingSessionLeaf = actingHead !== head;
  const draft = usePlanComposerStore((state) =>
    actingHead === null
      ? EMPTY_PLAN_COMPOSER_DRAFT
      : (state.draftsByPlan[planId]?.[actingHead] ?? EMPTY_PLAN_COMPOSER_DRAFT),
  );
  /**
   * Whether a draft written here should ride the branch as it grows. Standing
   * live at a tip: yes. Looking back at an interior commit — or continuing
   * from a session leaf's parent — the draft waits at the fork it would open.
   */
  const draftLive = !viewingSessionLeaf && (position._tag === "latest" || position.live);
  // A draft from before drafts were branch-scoped meets its first known head.
  useEffect(() => {
    if (actingHead !== null) adoptLegacyDraft(planId, actingHead);
  }, [actingHead, adoptLegacyDraft, planId]);
  const itemsById = useMemo(
    () => new Map(timeline.map((item) => [item.commitId, item] as const)),
    [timeline],
  );
  const standingChoice = useMemo(
    () => standingModelChoice(graph, itemsById, actingHead),
    [actingHead, graph, itemsById],
  );
  const modelChoice = draft.modelChoice ?? standingChoice ?? planningModel.setting;
  const effectiveModelResolution = resolvePlanningModel(modelChoice, planningModel.providers);

  useEffect(() => {
    if (actingHead === null) {
      setReconstructionMeasure(null);
      return;
    }
    let cancelled = false;
    setReconstructionMeasure(null);
    void measurePlanReconstruction(planId, actingHead).then((result) => {
      if (!cancelled) setReconstructionMeasure(result);
    });
    return () => {
      cancelled = true;
    };
  }, [actingHead, measurePlanReconstruction, planId]);
  const providerStatus =
    effectiveModelResolution._tag === "resolved"
      ? planningModel.providers.find(
          (provider) => provider.instanceId === effectiveModelResolution.instanceId,
        )
      : undefined;
  const viewingPast = isViewingPast(graph, position);
  const effectiveRightPaneWidth = width;
  const rightPaneOverlays =
    usesSideBySideLayout &&
    planningSpaceWidth !== null &&
    planningSpaceWidth - effectiveRightPaneWidth < CONVERSATION_MIN_WIDTH;

  /**
   * The conversation is always one path, never the whole history: the commits
   * leading to wherever you stand. A branch you are not on is a different
   * conversation, not more of this one.
   *
   * Checkpoints above a commit are immutable, so looking back needs no liveness of
   * its own: new commits keep folding into the subscription, and the
   * projection through an earlier commit cannot change.
   */
  const visibleTimeline = useMemo(() => {
    if (head === null) return timeline;
    const closure = ancestorClosure(graph, head);
    return timeline.filter((item) => closure.has(item.commitId));
  }, [graph, head, timeline]);

  /**
   * Each streaming reply belongs to one path: the one its human message is
   * on. Standing on a branch shows that branch's own reply — replies landing
   * on other branches stream there, not here — and standing in the past
   * shows the history you chose.
   */
  const inFlightTurns = detail?.inFlightTurns ?? EMPTY_IN_FLIGHT_TURNS;
  const visibleInFlight = useMemo(() => {
    if (inFlightTurns.length === 0) return undefined;
    if (head === null) return inFlightTurns[0];
    const closure = ancestorClosure(graph, head);
    return inFlightTurns.find((turn) => closure.has(turn.parentCommitId));
  }, [graph, head, inFlightTurns]);

  useEffect(() => {
    if (memoryAmendmentProposal !== undefined) setMemoryAmendmentSheetOpen(true);
  }, [memoryAmendmentProposal]);

  const gateNotice = planningModelGateNotice(modelChoice, effectiveModelResolution);

  /**
   * The artifact's text along *this* path is the one fact the client cannot
   * derive: revisions travel without their bodies. The snapshot's `planText`
   * answers for the whole history, which is the same answer only while the
   * last revision on this path is the last one anywhere — so the read happens
   * exactly when it is not, which on a linear history is never.
   */
  const needsPathText = head !== null && !snapshotTextIsForPath(timeline, visibleTimeline);
  const needsPathSpec = head !== null && !snapshotSpecIsForPath(timeline, visibleTimeline);

  useEffect(() => {
    if (!needsPathText || head === null) {
      setPathText(null);
      return;
    }
    let cancelled = false;
    setPathText(null);
    void getPlanTextAt(planId, head).then((result) => {
      if (!cancelled && result !== null) setPathText(result.planText);
    });
    return () => {
      cancelled = true;
    };
  }, [getPlanTextAt, head, needsPathText, planId]);

  useEffect(() => {
    if (!needsPathSpec || head === null) {
      setPathSpec(undefined);
      return;
    }
    let cancelled = false;
    setPathSpec(undefined);
    void getSpecAt(planId, head).then((result) => {
      if (!cancelled && result !== null) setPathSpec(result.spec);
    });
    return () => {
      cancelled = true;
    };
  }, [getSpecAt, head, needsPathSpec, planId]);

  /**
   * Sending says where it stands. From a branch tip that continues the
   * conversation; from a commit that already led somewhere it opens a fork,
   * and this message is the fork's first commit — which is the only way one
   * is made.
   *
   * The surface then stands live on what it just wrote, so the window follows
   * the line it extended rather than whichever branch is newest.
   */
  const send = useCallback(
    async ({ text, attachments }: PlanComposerSubmission) => {
      const sent = await appendMessage({
        planId,
        text,
        ...(actingHead === null ? {} : { parentCommitId: actingHead }),
        ...(attachments.length === 0 ? {} : { attachments }),
        ...(modelChoice === null ? {} : { modelChoice }),
      });
      if (sent === null) return false;
      // The stream delivers the message back; there is nothing to refresh.
      setPosition({ _tag: "at", commitId: sent.commitId, live: true });
      // Only the sending branch's draft leaves; every other branch keeps its own.
      if (actingHead !== null) clearDraft(planId, actingHead);
      return true;
    },
    [actingHead, appendMessage, clearDraft, modelChoice, planId],
  );

  const select = useCallback(
    (commitId: MercurianCommitId) => setPosition(positionAfterPick(graph, commitId)),
    [graph],
  );

  const editAndBranch = useCallback(
    (query: PlanHumanMessage) => {
      const parentCommitId = graph.byId.get(query.commitId)?.parents[0];
      if (parentCommitId === undefined) return;
      // Staged at the fork it would open, anchored there: an edited message
      // is a reply at its original's parent, not something that rides a tip.
      setDraftText(planId, parentCommitId, query.text, false);
      if (
        query.attachments === undefined ||
        query.attachments.length === 0 ||
        environmentId === null
      ) {
        select(parentCommitId);
        return;
      }
      setPendingEditAndBranch({ query, parentCommitId });
    },
    [environmentId, graph.byId, planId, select, setDraftText],
  );
  const completeEditAndBranch = useCallback(
    (parentCommitId: MercurianCommitId, attachments: ReadonlyArray<PlanComposerAttachment>) => {
      addDraftAttachments(planId, parentCommitId, attachments, false);
      select(parentCommitId);
      setPendingEditAndBranch(null);
    },
    [addDraftAttachments, planId, select],
  );

  const backToNow = useCallback(() => setPosition(LATEST), []);

  const beginImplementFrom = useCallback(
    (fromCommitId: MercurianCommitId | null) => {
      const resolved = resolveImplementFrom(graph, fromCommitId);
      if (resolved === null) return;
      const draftId = materializeSessionDraft(resolved);
      if (draftId !== null) setSessionDraftId(draftId);
    },
    [graph, materializeSessionDraft],
  );

  const beginImplement = useCallback(() => beginImplementFrom(head), [beginImplementFrom, head]);

  if (error !== null) {
    return (
      <PlanningSurface>
        <PlanningHeader title="Plan" />
        <Empty className="flex-1">
          <EmptyHeader className="max-w-md">
            <EmptyTitle className="text-foreground text-xl">Couldn’t open this plan</EmptyTitle>
            <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
              {error}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </PlanningSurface>
    );
  }

  const artifactText = needsPathText ? pathText : (detail?.planText ?? null);
  const artifactSpec = needsPathSpec ? pathSpec : detail?.spec;
  const implementReason = implementDisabledReason({
    turnActive: visibleInFlight !== undefined,
    planTextEmpty: artifactText === null || artifactText.trim().length === 0,
  });
  const missingLineBranch = missingLineBranchDoor;
  const memoryFailureKey =
    memoryAmendmentFailure === null
      ? null
      : `${memoryAmendmentFailure.turnId}\0${memoryAmendmentFailure.reason}`;
  const memoryFailureNotice =
    memoryAmendmentFailure === null || memoryFailureKey === dismissedMemoryAmendmentFailure
      ? null
      : memoryAmendmentFailureNotice(memoryAmendmentFailure);
  const paneCornerControl = usesSideBySideLayout ? (
    <PlanPaneToggle state={pane} onChange={setPane} />
  ) : null;

  return (
    <PlanningSurface>
      {pendingEditAndBranch === null || environmentId === null ? null : (
        <EditAndBranchAttachmentLoader
          environmentId={environmentId}
          key={pendingEditAndBranch.query.commitId}
          query={pendingEditAndBranch.query}
          onReady={(attachments) =>
            completeEditAndBranch(pendingEditAndBranch.parentCommitId, attachments)
          }
        />
      )}
      {usesSideBySideLayout ? null : (
        <PlanningHeader
          actions={detail === null ? null : <PlanPaneToggle state={pane} onChange={setPane} />}
          title={detail?.plan.title ?? (isPending ? "Loading…" : "Plan")}
        />
      )}
      {/* Below `sm` the two stack, pane above conversation — same content, no
          second surface to keep in step. */}
      <div
        className="relative flex min-h-0 flex-1 flex-col-reverse sm:flex-row"
        ref={planningSpaceRef}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {usesSideBySideLayout ? (
            <PlanningHeader
              actions={
                detail === null || pane.open ? null : (
                  <PlanPaneToggle state={pane} onChange={setPane} />
                )
              }
              title={detail?.plan.title ?? (isPending ? "Loading…" : "Plan")}
            />
          ) : null}
          <PlanTimeline
            codingSessions={detail?.codingSessions ?? []}
            inFlight={visibleInFlight}
            providers={planningModel.providers}
            {...(providerStatus === undefined ? {} : { skills: providerStatus.skills })}
            timeline={visibleTimeline}
            onOpenNote={openMemoryNote}
            onAnswerQuestion={(answers) => {
              if (visibleInFlight !== undefined) {
                void answerQuestion(planId, visibleInFlight.turnId, answers);
              }
            }}
          />
          {/* One live search per repository in the project's set. Renders
              nothing; it is what makes `@` reach real files. */}
          {mentions.sources}
          {missingLineBranch === null ? null : (
            <div className="px-3 pt-2 sm:px-5">
              <div
                role="alert"
                className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive-foreground"
              >
                <span className="min-w-0 flex-1">
                  The line's branch no longer exists in a linked repository.
                </span>
                <Button
                  size="xs"
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void recreateLineBranch({
                      planId,
                      commitId: missingLineBranch.commitId,
                    }).then((result) => {
                      if (result !== null) setMissingLineBranchDoor(null);
                    })
                  }
                >
                  Recreate branch
                </Button>
              </div>
            </div>
          )}
          {memoryFailureNotice === null ? null : (
            <div className="px-3 pt-2 sm:px-5">
              <div
                role="alert"
                className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive-foreground"
              >
                <span className="min-w-0 flex-1">{memoryFailureNotice}</span>
                <Button
                  aria-label="Dismiss memory amendment failure"
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                  onClick={() => setDismissedMemoryAmendmentFailure(memoryFailureKey)}
                >
                  <XIcon aria-hidden className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
          <PlanComposer
            attachments={draft.attachments}
            {...(providerStatus === undefined
              ? {}
              : {
                  provider: providerStatus.driver,
                  slashCommands: providerStatus.slashCommands,
                  skills: providerStatus.skills,
                })}
            // Standing at an earlier point does not take the composer away —
            // it changes what sending means, and the banner says so.
            banner={
              viewingSessionLeaf ? (
                <SessionLeafBanner />
              ) : viewingPast ? (
                <ViewingEarlierBanner onBack={backToNow} />
              ) : null
            }
            gateNotice={gateNotice}
            mentionCandidates={mentions.candidates}
            meter={
              <PlanReconstructionMeter
                draftChars={draft.text.length}
                measure={reconstructionMeasure}
                providers={planningModel.providers}
                resolution={effectiveModelResolution}
                selection={modelChoice}
              />
            }
            modelPicker={
              <>
                <PlanModelPicker
                  disabled={visibleInFlight !== undefined}
                  providers={planningModel.providers}
                  selection={modelChoice}
                  onChange={(selection) => {
                    if (actingHead !== null) {
                      setDraftModelChoice(planId, actingHead, selection, draftLive);
                    }
                  }}
                />
                <PlanTraitsPicker
                  disabled={visibleInFlight !== undefined}
                  prompt={draft.text}
                  providers={planningModel.providers}
                  resolution={effectiveModelResolution}
                  selection={modelChoice}
                  onChange={(selection) => {
                    if (actingHead !== null) {
                      setDraftModelChoice(planId, actingHead, selection, draftLive);
                    }
                  }}
                  onPromptChange={(text) => {
                    if (actingHead !== null) {
                      setDraftText(planId, actingHead, text, draftLive);
                    }
                  }}
                />
              </>
            }
            implementDisabledReason={implementReason}
            notice={turnRefusal === null ? null : turnRefusalNotice(modelChoice, turnRefusal)}
            placeholder="Message this plan"
            text={draft.text}
            // One turn at a time per branch: Stop wears the send button only
            // while this branch's own reply streams. A reply on another
            // branch never gates sending here.
            turnActive={visibleInFlight !== undefined}
            onAddAttachments={(added) => {
              if (actingHead !== null) addDraftAttachments(planId, actingHead, added, draftLive);
            }}
            onChangeText={(text) => {
              if (actingHead !== null) setDraftText(planId, actingHead, text, draftLive);
            }}
            onMentionQueryChange={mentions.onMentionQueryChange}
            onRemoveAttachment={(localId) => {
              if (actingHead !== null) removeDraftAttachment(planId, actingHead, localId);
            }}
            onSend={send}
            onStop={() => {
              if (visibleInFlight !== undefined) void stopTurn(planId, visibleInFlight.turnId);
            }}
            onImplement={beginImplement}
          />
        </div>
        {detail === null || !pane.open ? null : (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              className={cn(
                "group relative hidden w-0 shrink-0 select-none sm:block",
                rightPaneOverlays && "absolute inset-y-0 z-30",
              )}
              style={rightPaneOverlays ? { right: effectiveRightPaneWidth } : undefined}
            >
              <div className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize" {...handlers}>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60"
                />
              </div>
            </div>
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col border-b border-border bg-background sm:w-(--plan-pane-width) sm:max-w-full sm:flex-none sm:border-b-0 sm:border-l",
                rightPaneOverlays && "absolute inset-y-0 right-0 z-20 shadow-lg",
              )}
              style={
                {
                  "--plan-pane-width": `${effectiveRightPaneWidth}px`,
                } as CSSProperties
              }
            >
              {pane.view === "explorer" ? (
                // The highlight is wherever the composer acts from, so
                // following a branch shows in the explorer as it happens.
                <DagExplorer
                  anchoredCommitId={head}
                  codingSessions={detail.codingSessions}
                  graph={graph}
                  inFlightAnchorCommitIds={inFlightTurns.map((turn) => turn.parentCommitId)}
                  providers={planningModel.providers}
                  stalePlanCommitIds={stalePlanLeaves}
                  staleSpecCommitIds={staleSpecLeaves}
                  cornerControl={paneCornerControl}
                  onColumnsWidthCapChange={setColumnsWidthCap}
                  onEditAndBranch={editAndBranch}
                  onImplementFrom={beginImplementFrom}
                  onSelect={select}
                />
              ) : pane.artifact === "plan" && artifactText === null ? (
                // The plan as of then is still on its way. An empty artifact
                // and an unread one look alike, and saying nothing is better
                // than saying the plan was blank.
                <div className="flex min-h-0 flex-1 flex-col">
                  <div
                    className={cn(
                      WORKSPACE_PANE_TITLE_BAR_CLASS,
                      "gap-2 border-b border-border px-3 sm:px-4",
                    )}
                  >
                    <ArtifactPicker
                      value={pane.artifact}
                      onChange={(artifact) => setPane({ ...pane, artifact })}
                    />
                    <span className="min-w-0 flex-1" />
                    {paneCornerControl}
                  </div>
                  <div className="min-h-0 flex-1 px-3 py-6 sm:px-4">
                    <p className="text-sm text-muted-foreground/70">Reading the plan as of then…</p>
                  </div>
                </div>
              ) : pane.artifact === "spec" && artifactSpec === undefined ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div
                    className={cn(
                      WORKSPACE_PANE_TITLE_BAR_CLASS,
                      "gap-2 border-b border-border px-3 sm:px-4",
                    )}
                  >
                    <ArtifactPicker
                      value={pane.artifact}
                      onChange={(artifact) => setPane({ ...pane, artifact })}
                    />
                    <span className="min-w-0 flex-1" />
                    {paneCornerControl}
                  </div>
                  <div className="min-h-0 flex-1 px-3 py-6 sm:px-4">
                    <p className="text-sm text-muted-foreground/70">Reading the spec as of then…</p>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  {pane.artifact === "plan" ? (
                    <PlanArtifact
                      // An edit lands on the branch you are standing on. Editing
                      // is only offered live, so a revision can never be the thing
                      // that opens a fork: a fork opens with a message.
                      {...(actingHead === null ? {} : { parentCommitId: actingHead })}
                      planId={planId}
                      planText={artifactText ?? ""}
                      readOnly={viewingPast || viewingSessionLeaf}
                      turnActive={visibleInFlight !== undefined}
                      readOnlyAction={
                        <Button size="sm" variant="ghost" onClick={backToNow}>
                          Back to now
                        </Button>
                      }
                      cornerControl={paneCornerControl}
                      titleControl={
                        <ArtifactPicker
                          value={pane.artifact}
                          onChange={(artifact) => setPane({ ...pane, artifact })}
                        />
                      }
                      timeline={visibleTimeline}
                    />
                  ) : (
                    <SpecArtifact
                      {...(actingHead === null ? {} : { parentCommitId: actingHead })}
                      {...(detail.origin === undefined ? {} : { origin: detail.origin })}
                      planId={planId}
                      readOnly={viewingPast || viewingSessionLeaf}
                      readOnlyAction={
                        <Button size="sm" variant="ghost" onClick={backToNow}>
                          Back to now
                        </Button>
                      }
                      cornerControl={paneCornerControl}
                      spec={artifactSpec ?? null}
                      titleControl={
                        <ArtifactPicker
                          value={pane.artifact}
                          onChange={(artifact) => setPane({ ...pane, artifact })}
                        />
                      }
                      timeline={visibleTimeline}
                      turnActive={visibleInFlight !== undefined}
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}
        {currentMemoryNoteName === null ? null : (
          <div className="absolute inset-y-0 right-0 z-30 max-w-full shadow-lg">
            <MemoryNoteReader
              error={memoryNoteError}
              loading={memoryNoteLoading}
              note={memoryNote}
              onOpenNote={openMemoryNote}
              onClose={() => setMemoryReader({ stack: [] })}
              {...(memoryReader.stack.length > 1
                ? {
                    onBack: () =>
                      setMemoryReader((current) => ({ stack: current.stack.slice(0, -1) })),
                  }
                : {})}
            />
          </div>
        )}
      </div>
      {memoryAmendmentProposal === undefined ? null : (
        <MemoryAmendmentSheet
          onOpenChange={setMemoryAmendmentSheetOpen}
          open={memoryAmendmentSheetOpen}
          parentCommitId={actingHead}
          planId={planId}
          proposal={memoryAmendmentProposal}
          turnActive={visibleInFlight !== undefined}
        />
      )}
      <CodingSessionDraftSheet
        draftId={sessionDraftId}
        open={sessionDraftId !== null}
        onOpenChange={(open) => {
          if (!open) setSessionDraftId(null);
        }}
        onLineBranchMissing={({ commitId }) =>
          setMissingLineBranchDoor({ commitId: MercurianCommitId.make(commitId) })
        }
      />
    </PlanningSurface>
  );
}

function memoryReadError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not read this memory note.";
}

/**
 * Re-materialize recorded image metadata through the environment's asset door.
 * The position moves only after every available image has become a composer
 * attachment, so the branch draft appears as one deliberate act.
 */
function EditAndBranchAttachmentLoader({
  environmentId,
  query,
  onReady,
}: {
  readonly environmentId: EnvironmentId;
  readonly query: PlanHumanMessage;
  readonly onReady: (attachments: ReadonlyArray<PlanComposerAttachment>) => void;
}) {
  const attachments = query.attachments ?? [];
  const urls = useAssetUrls(
    environmentId,
    attachments.map((attachment) => ({
      _tag: "attachment",
      attachmentId: attachment.id,
    })),
  );

  useEffect(() => {
    if (urls.some((url) => url === null)) return;
    let cancelled = false;
    void Promise.all(
      attachments.map(async (attachment, index) => {
        const url = urls[index];
        if (url === null || url === undefined) return null;
        try {
          const response = await fetch(url);
          if (!response.ok) return null;
          const blob = await response.blob();
          return await toPlanComposerAttachment(
            new File([blob], attachment.name, { type: attachment.mimeType }),
          );
        } catch {
          return null;
        }
      }),
    ).then((materialized) => {
      if (!cancelled) onReady(materialized.filter((item) => item !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [attachments, onReady, urls]);

  return null;
}

/**
 * The corner's two icons: the plan artifact and the DAG explorer. One of them
 * is the pane's content; pressing the pressed one closes the pane and leaves
 * the conversation full-width.
 */
export function PlanPaneToggle({
  state,
  onChange,
}: {
  readonly state: RightPaneState;
  readonly onChange: (next: RightPaneState) => void;
}) {
  return (
    <ToggleGroup
      className="shrink-0"
      size="xs"
      value={state.open ? [state.view] : []}
      variant="ghost"
      onValueChange={(next) => {
        const chosen = next[0];
        // Deselecting the active icon is how the pane closes — and the view it
        // was showing is remembered for the next time it opens.
        if (chosen === undefined) {
          onChange({ ...state, open: false });
          return;
        }
        if (chosen === "artifact" || chosen === "explorer") {
          onChange({ ...state, open: true, view: chosen });
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger render={<Toggle aria-label="Plan" value="artifact" />}>
          <FileTextIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Plan</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Toggle aria-label="Checkpoint Graph" value="explorer" />}>
          <WaypointsIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Checkpoint Graph</TooltipPopup>
      </Tooltip>
    </ToggleGroup>
  );
}

function ArtifactPicker({
  value,
  onChange,
}: {
  readonly value: "plan" | "spec";
  readonly onChange: (value: "plan" | "spec") => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Select planning artifact"
        className="-ml-1 inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent"
      >
        {value === "spec" ? "Spec" : "Plan"}
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-(--anchor-width)">
        <MenuRadioGroup
          value={value}
          onValueChange={(selected) => {
            if (selected === "plan" || selected === "spec") onChange(selected);
          }}
        >
          <MenuRadioItem closeOnClick value="spec">
            Spec
          </MenuRadioItem>
          <MenuRadioItem closeOnClick value="plan">
            Plan
          </MenuRadioItem>
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * What the composer says while you are standing at an earlier point.
 *
 * The composer still acts — that is the whole point of standing somewhere —
 * but what it does from here is open a branch rather than continue this
 * conversation, so the surface says that before you press send, and keeps the
 * way back beside it.
 */
// The t3code composer-notification treatment: a muted card capping the
// composer bubble, so standing on a session leaf reads as a state the
// composer is in rather than a stray line of text.
function SessionLeafBanner() {
  return (
    <div className="rounded-t-[19px] border-b border-border/65 bg-muted/20">
      <div className="px-4 py-3.5 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <SquareTerminalIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm text-muted-foreground">
            New planning continues from the checkpoint before this coding session.
          </span>
        </div>
      </div>
    </div>
  );
}

function ViewingEarlierBanner({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border/65 bg-muted/20 px-3 py-2">
      <ClockIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
      {/* Wraps rather than truncates: what sending does from here is the one
          thing that must not get cut off in a narrow window. */}
      <span className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
        Viewing an earlier point — sending starts a new branch from here
      </span>
      <Button className="shrink-0" size="xs" variant="outline" onClick={onBack}>
        Back to now
      </Button>
    </div>
  );
}

/**
 * The draft variant: the creator's open composer and nothing else. No row
 * exists in the tree yet, because no plan exists yet — the first message is
 * the plan's birth, and only then does it appear.
 */
export function PlanningSpaceDraft({ draftId }: { readonly draftId: string }) {
  const navigate = useNavigate();
  const draft = usePlanDraftStore((state) => state.draftsById[draftId]);
  const setDraftText = usePlanDraftStore((state) => state.setDraftText);
  const setDraftModelChoice = usePlanDraftStore((state) => state.setModelChoice);
  const discardDraft = usePlanDraftStore((state) => state.discardDraft);
  const createPlan = useCreatePlan();
  // The birth message starts a reply like any other, so the gate is the
  // same here: the plan can still be born, but the composer says up front
  // that no assistant will answer on this machine.
  const planningModel = usePlanningModel();
  const modelChoice = draft?.modelChoice ?? planningModel.setting;
  const effectiveModelResolution = resolvePlanningModel(modelChoice, planningModel.providers);
  const providerStatus =
    effectiveModelResolution._tag === "resolved"
      ? planningModel.providers.find(
          (provider) => provider.instanceId === effectiveModelResolution.instanceId,
        )
      : undefined;
  const draftPlanningModelNotice = planningModelGateNotice(modelChoice, effectiveModelResolution);
  const [isImportOpen, setIsImportOpen] = useState(false);
  /**
   * The unborn plan's images. Held here rather than in `planDraftStore`
   * because there is no plan to key them by yet and the draft they belong to
   * lives exactly as long as this view does — the text is what survives
   * leaving, and it already did before this issue.
   */
  const [attachments, setAttachments] = useState<ReadonlyArray<PlanComposerAttachment>>([]);
  // The birth message composes with the same powers as every later one, and
  // the project it is being born into is already what says which code it can
  // reach.
  const mentions = usePlanMentionCandidates(
    draft === undefined ? null : (draft.projectId as MercurianProjectId),
  );

  const send = useCallback(
    async ({ text, attachments: uploads }: PlanComposerSubmission) => {
      if (draft === undefined) return false;
      const created = await createPlan({
        projectId: draft.projectId as MercurianProjectId,
        message: text,
        ...(uploads.length === 0 ? {} : { attachments: uploads }),
        ...(modelChoice === null ? {} : { modelChoice }),
      });
      if (created === null) {
        return false;
      }
      discardDraft(draftId);
      void navigate({
        to: "/plans/$planId",
        params: { planId: created.plan.planId },
        replace: true,
      });
      return true;
    },
    [createPlan, discardDraft, draft, draftId, modelChoice, navigate],
  );

  if (draft === undefined) {
    return (
      <PlanningSurface>
        <PlanningHeader title="New plan" />
        <Empty className="flex-1">
          <EmptyHeader className="max-w-md">
            <EmptyTitle className="text-foreground text-xl">This draft is gone</EmptyTitle>
            <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
              Start a new plan from its project in the sidebar.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </PlanningSurface>
    );
  }

  return (
    <PlanningSurface>
      <PlanningHeader title="New plan" />
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle className="text-foreground text-lg">What are we planning?</EmptyTitle>
          <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
            The plan starts existing when you send the first message.
          </EmptyDescription>
        </EmptyHeader>
        {/* All issues can form plans, but not all plans are formed by issues:
            the two ways in stand side by side, and starting blank stays the
            one you land on. */}
        <Button className="mt-4" size="sm" variant="outline" onClick={() => setIsImportOpen(true)}>
          <CircleDotIcon className="size-3.5" />
          Import from a tracker
        </Button>
      </Empty>
      <ImportIssueDialog
        open={isImportOpen}
        projectId={draft.projectId as MercurianProjectId}
        onOpenChange={setIsImportOpen}
        // The draft's text is not consumed by an import and is not thrown away
        // by one either: it stays in the one-draft-per-project store for the
        // next plan born blank.
        onImported={(planId) => void navigate({ to: "/plans/$planId", params: { planId } })}
      />
      {mentions.sources}
      <PlanComposer
        attachments={attachments}
        {...(providerStatus === undefined
          ? {}
          : {
              provider: providerStatus.driver,
              slashCommands: providerStatus.slashCommands,
              skills: providerStatus.skills,
            })}
        implementDisabledReason={implementDisabledReason({
          turnActive: false,
          planTextEmpty: true,
        })}
        mentionCandidates={mentions.candidates}
        menuGateNotice={draftPlanningModelNotice}
        modelPicker={
          <>
            <PlanModelPicker
              providers={planningModel.providers}
              selection={modelChoice}
              onChange={(selection) => setDraftModelChoice(draftId, selection)}
            />
            <PlanTraitsPicker
              prompt={draft.text}
              providers={planningModel.providers}
              resolution={effectiveModelResolution}
              selection={modelChoice}
              onChange={(selection) => setDraftModelChoice(draftId, selection)}
              onPromptChange={(text) => setDraftText(draftId, text)}
            />
          </>
        }
        // Informational, not blocking: a plan is born with its first message
        // whether or not an assistant can reply, so the draft composer says
        // what will happen rather than refusing to create the plan.
        notice={draftPlanningModelNotice}
        placeholder="Describe the work"
        text={draft.text}
        onAddAttachments={(added) => setAttachments((current) => [...current, ...added])}
        onChangeText={(text) => setDraftText(draftId, text)}
        onMentionQueryChange={mentions.onMentionQueryChange}
        onRemoveAttachment={(localId) =>
          setAttachments((current) => current.filter((one) => one.localId !== localId))
        }
        onSend={send}
      />
    </PlanningSurface>
  );
}

function PlanningHeader({
  title,
  actions,
}: {
  readonly title: string;
  /** The top-right corner. Empty wherever there is no plan to have views of. */
  readonly actions?: ReactNode;
}) {
  return (
    <WorkspacePageHeader className="gap-2 border-b border-border">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</h1>
      {actions}
    </WorkspacePageHeader>
  );
}

function PlanningSurface({ children }: { readonly children: ReactNode }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        {children}
      </div>
    </SidebarInset>
  );
}

import type {
  MercurianCommitId,
  MercurianProjectId,
  PlanId,
  PlanTimelineItem,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CircleDotIcon, ClockIcon, FileTextIcon, GitBranchIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { cn } from "../../lib/utils";
import {
  EMPTY_PLAN_COMPOSER_DRAFT,
  usePlanComposerStore,
  type PlanComposerAttachment,
} from "../../planComposerStore";
import { usePlanDraftStore } from "../../planDraftStore";
import {
  useAnswerPlanningQuestion,
  useAppendPlanMessage,
  useCreatePlan,
  useGetPlanTextAt,
  usePlanDetail,
  useStopPlanningTurn,
  useVisitPlan,
} from "../../state/mercurian";
import { usePlanningModel } from "../../state/mercurianWorkspace";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import {
  DagExplorer,
  DEFAULT_EXPLORER_VIEW,
  EXPLORER_VIEW_STORAGE_KEY,
  ExplorerView,
} from "./DagExplorer";
import { ImportIssueDialog } from "./ImportIssueDialog";
import { PlanArtifact } from "./PlanArtifact";
import { snapshotTextIsForPath } from "./PlanArtifact.logic";
import { PlanComposer, type PlanComposerSubmission } from "./PlanComposer";
import { planningModelGateNotice, turnRefusalNotice } from "./PlanComposer.logic";
import { usePlanMentionCandidates } from "./PlanMentionSources";
import { ancestorClosure, buildPlanGraph } from "./PlanGraph.logic";
import {
  advance,
  isViewingPast,
  LATEST,
  positionAfterPick,
  resolveHead,
  type PlanPosition,
} from "./PlanPosition.logic";
import { PlanTimeline } from "./PlanTimeline";

const RIGHT_PANE_WIDTH_STORAGE_KEY = "mercurian:plan-right-pane-width:v1";
const RIGHT_PANE_DEFAULT_WIDTH = 480;
const RIGHT_PANE_MIN_WIDTH = 280;
const RIGHT_PANE_MAX_WIDTH = 900;
const RIGHT_PANE_THREAD_MAX_WIDTH = 560;
const CONVERSATION_MIN_WIDTH = 480;

const RIGHT_PANE_STORAGE_KEY = "mercurian:plan-right-pane:v1";
const RightPaneState = Schema.Struct({
  open: Schema.Boolean,
  view: Schema.Literals(["artifact", "explorer"]),
});
type RightPaneState = typeof RightPaneState.Type;

/**
 * A plan opens with its plan visible and its history one toggle away. The
 * preference is not keyed by plan on purpose: which view you prefer is a fact
 * about you, not about the issue, so it follows you across plans.
 */
const DEFAULT_RIGHT_PANE: RightPaneState = { open: true, view: "artifact" };

/** One identity for "nothing yet", so the derived graph is not rebuilt for it. */
const EMPTY_TIMELINE: ReadonlyArray<PlanTimelineItem> = [];

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
  const { detail, isPending, error, turnRefusal } = usePlanDetail(planId);
  const appendMessage = useAppendPlanMessage();
  const getPlanTextAt = useGetPlanTextAt();
  const visitPlan = useVisitPlan();
  const stopTurn = useStopPlanningTurn();
  const answerQuestion = useAnswerPlanningQuestion();
  // The same resolution the server runs, read here so sending gates with the
  // reason stated instead of failing silently. The two can only disagree for
  // the width of a race, which `turn-refused` covers.
  const planningModel = usePlanningModel();
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
  const { width, handlers } = useResizableWidth({
    storageKey: RIGHT_PANE_WIDTH_STORAGE_KEY,
    defaultWidth: RIGHT_PANE_DEFAULT_WIDTH,
    minWidth: RIGHT_PANE_MIN_WIDTH,
    maxWidth: RIGHT_PANE_MAX_WIDTH,
    // Right-anchored: the handle is on the pane's left edge, and dragging it
    // leftward grows the pane.
    edge: "left",
  });
  const [columnsWidthCap, setColumnsWidthCap] = useState(0);
  const planningSpaceRef = useRef<HTMLDivElement>(null);
  const [planningSpaceWidth, setPlanningSpaceWidth] = useState<number | null>(null);
  const usesSideBySideLayout = useMediaQuery("sm");

  useEffect(() => {
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
  const draft = usePlanComposerStore(
    (state) => state.draftsByPlanId[planId] ?? EMPTY_PLAN_COMPOSER_DRAFT,
  );
  const setDraftText = usePlanComposerStore((state) => state.setDraftText);
  const addDraftAttachments = usePlanComposerStore((state) => state.addAttachments);
  const removeDraftAttachment = usePlanComposerStore((state) => state.removeAttachment);
  const clearDraft = usePlanComposerStore((state) => state.clearDraft);
  // The plan's project is what says which code this space can mention. With no
  // repository set, there is nothing to offer and the menu stays closed.
  const mentions = usePlanMentionCandidates(detail?.plan.projectId ?? null);

  // Another plan is another history: whatever you were looking at there does
  // not name anything here.
  useEffect(() => setPosition(LATEST), [planId]);

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

  const timeline = detail?.timeline ?? EMPTY_TIMELINE;
  const graph = useMemo(() => buildPlanGraph(timeline), [timeline]);

  /**
   * Standing somewhere live means riding that branch forward: a commit landing
   * on this line moves the surface onto it, and a commit landing anywhere else
   * in the DAG moves nothing. Looking back never moves at all.
   */
  useEffect(() => setPosition((current) => advance(graph, current)), [graph]);

  const head = resolveHead(graph, position);
  const viewingPast = isViewingPast(graph, position);
  const rightPaneViewCap =
    pane.view === "artifact" || explorerView === "graph"
      ? RIGHT_PANE_MAX_WIDTH
      : explorerView === "thread"
        ? RIGHT_PANE_THREAD_MAX_WIDTH
        : columnsWidthCap;
  const effectiveRightPaneWidth = Math.max(RIGHT_PANE_MIN_WIDTH, Math.min(width, rightPaneViewCap));
  const rightPaneOverlays =
    usesSideBySideLayout &&
    planningSpaceWidth !== null &&
    planningSpaceWidth - effectiveRightPaneWidth < CONVERSATION_MIN_WIDTH;

  /**
   * The conversation is always one path, never the whole history: the commits
   * leading to wherever you stand. A branch you are not on is a different
   * conversation, not more of this one.
   *
   * History above a commit is immutable, so looking back needs no liveness of
   * its own: new commits keep folding into the subscription, and the
   * projection through an earlier commit cannot change.
   */
  const visibleTimeline = useMemo(() => {
    if (head === null) return timeline;
    const closure = ancestorClosure(graph, head);
    return timeline.filter((item) => closure.has(item.commitId));
  }, [graph, head, timeline]);

  /**
   * The streaming reply belongs to one path: the one its human message is
   * on. Standing on another branch — or in the past — shows the history you
   * chose, not a reply landing somewhere else.
   */
  const inFlightTurn = detail?.inFlightTurn;
  const visibleInFlight = useMemo(() => {
    if (inFlightTurn === undefined) return undefined;
    if (head === null) return inFlightTurn;
    const closure = ancestorClosure(graph, head);
    return closure.has(inFlightTurn.parentCommitId) ? inFlightTurn : undefined;
  }, [graph, head, inFlightTurn]);

  const gateNotice = planningModelGateNotice(planningModel.resolution);

  /**
   * The artifact's text along *this* path is the one fact the client cannot
   * derive: revisions travel without their bodies. The snapshot's `planText`
   * answers for the whole history, which is the same answer only while the
   * last revision on this path is the last one anywhere — so the read happens
   * exactly when it is not, which on a linear history is never.
   */
  const needsPathText = head !== null && !snapshotTextIsForPath(timeline, visibleTimeline);

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
        ...(head === null ? {} : { parentCommitId: head }),
        ...(attachments.length === 0 ? {} : { attachments }),
      });
      if (sent === null) return false;
      // The stream delivers the message back; there is nothing to refresh.
      setPosition({ _tag: "at", commitId: sent.commitId, live: true });
      clearDraft(planId);
      return true;
    },
    [appendMessage, clearDraft, head, planId],
  );

  const select = useCallback(
    (commitId: MercurianCommitId) => setPosition(positionAfterPick(graph, commitId)),
    [graph],
  );

  const backToNow = useCallback(() => setPosition(LATEST), []);

  if (error !== null) {
    return (
      <PlanningSurface title="Plan">
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

  return (
    <PlanningSurface
      // The pane and its icons belong to a plan; a space with no plan has
      // neither.
      actions={detail === null ? null : <PlanPaneToggle state={pane} onChange={setPane} />}
      title={detail?.plan.title ?? (isPending ? "Loading…" : "Plan")}
    >
      {/* Below `sm` the two stack, pane above conversation — same content, no
          second surface to keep in step. */}
      <div
        className="relative flex min-h-0 flex-1 flex-col-reverse sm:flex-row"
        ref={planningSpaceRef}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PlanTimeline
            inFlight={visibleInFlight}
            timeline={visibleTimeline}
            onAnswerQuestion={(answers) => void answerQuestion(planId, answers)}
          />
          {/* One live search per repository in the project's set. Renders
              nothing; it is what makes `@` reach real files. */}
          {mentions.sources}
          <PlanComposer
            attachments={draft.attachments}
            // Standing at an earlier point does not take the composer away —
            // it changes what sending means, and the banner says so.
            banner={viewingPast ? <ViewingEarlierBanner onBack={backToNow} /> : null}
            gateNotice={gateNotice}
            mentionCandidates={mentions.candidates}
            notice={turnRefusal === null ? null : turnRefusalNotice(turnRefusal)}
            placeholder="Message this plan"
            text={draft.text}
            // The whole plan holds one turn at a time, wherever it streams —
            // Stop is offered even when the reply is on another branch.
            turnActive={inFlightTurn !== undefined}
            onAddAttachments={(added) => addDraftAttachments(planId, added)}
            onChangeText={(text) => setDraftText(planId, text)}
            onMentionQueryChange={mentions.onMentionQueryChange}
            onRemoveAttachment={(localId) => removeDraftAttachment(planId, localId)}
            onSend={send}
            onStop={() => void stopTurn(planId)}
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
                "flex min-h-0 min-w-0 flex-1 flex-col border-b border-border bg-background sm:w-(--plan-pane-width) sm:flex-none sm:border-b-0 sm:border-l",
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
                  graph={graph}
                  onColumnsWidthCapChange={setColumnsWidthCap}
                  onSelect={select}
                />
              ) : artifactText === null ? (
                // The plan as of then is still on its way. An empty artifact
                // and an unread one look alike, and saying nothing is better
                // than saying the plan was blank.
                <div className="min-h-0 flex-1 px-3 py-6 sm:px-4">
                  <p className="text-sm text-muted-foreground/70">Reading the plan as of then…</p>
                </div>
              ) : (
                <PlanArtifact
                  // An edit lands on the branch you are standing on. Editing
                  // is only offered live, so a revision can never be the thing
                  // that opens a fork: a fork opens with a message.
                  {...(head === null ? {} : { parentCommitId: head })}
                  planId={planId}
                  planText={artifactText}
                  readOnly={viewingPast}
                  readOnlyAction={
                    <Button size="sm" variant="ghost" onClick={backToNow}>
                      Back to now
                    </Button>
                  }
                  timeline={visibleTimeline}
                />
              )}
            </div>
          </>
        )}
      </div>
    </PlanningSurface>
  );
}

/**
 * The corner's two icons: the plan artifact and the DAG explorer. One of them
 * is the pane's content; pressing the pressed one closes the pane and leaves
 * the conversation full-width.
 */
function PlanPaneToggle({
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
          onChange({ open: true, view: chosen });
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
        <TooltipTrigger render={<Toggle aria-label="History" value="explorer" />}>
          <GitBranchIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">History</TooltipPopup>
      </Tooltip>
    </ToggleGroup>
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
  const discardDraft = usePlanDraftStore((state) => state.discardDraft);
  const createPlan = useCreatePlan();
  // The birth message starts a reply like any other, so the gate is the
  // same here: the plan can still be born, but the composer says up front
  // that no assistant will answer on this machine.
  const planningModel = usePlanningModel();
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
    [createPlan, discardDraft, draft, draftId, navigate],
  );

  if (draft === undefined) {
    return (
      <PlanningSurface title="New plan">
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
    <PlanningSurface title="New plan">
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
        mentionCandidates={mentions.candidates}
        // Informational, not blocking: a plan is born with its first message
        // whether or not an assistant can reply, so the draft composer says
        // what will happen rather than refusing to create the plan.
        notice={planningModelGateNotice(planningModel.resolution)}
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

function PlanningSurface({
  title,
  actions,
  children,
}: {
  readonly title: string;
  /** The top-right corner. Empty wherever there is no plan to have views of. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "flex items-center gap-2 border-b border-border px-3 py-2 sm:px-5 sm:py-3",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</h1>
          {actions}
        </header>
        {children}
      </div>
    </SidebarInset>
  );
}

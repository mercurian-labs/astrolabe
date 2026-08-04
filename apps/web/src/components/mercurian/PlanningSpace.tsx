import type {
  MercurianCommitId,
  MercurianProjectId,
  PlanId,
  PlanTimelineItem,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ClockIcon, FileTextIcon, GitBranchIcon, SendHorizontalIcon } from "lucide-react";
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
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { cn } from "../../lib/utils";
import { usePlanDraftStore } from "../../planDraftStore";
import {
  useAppendPlanMessage,
  useCreatePlan,
  useGetPlanTextAt,
  usePlanDetail,
} from "../../state/mercurian";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { DagExplorer } from "./DagExplorer";
import { PlanArtifact } from "./PlanArtifact";
import { ancestorClosure, buildPlanGraph } from "./PlanGraph.logic";
import { PlanTimeline } from "./PlanTimeline";

const RIGHT_PANE_WIDTH_STORAGE_KEY = "mercurian:plan-right-pane-width:v1";
const RIGHT_PANE_DEFAULT_WIDTH = 480;
const RIGHT_PANE_MIN_WIDTH = 280;
const RIGHT_PANE_MAX_WIDTH = 900;

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

/**
 * Where the planning surface is looking.
 *
 * Per-window and transient — not persisted, not server-owned. Nothing ranks or
 * rolls up from where a window is pointed, so position is scroll-state-shaped
 * (ADR 002 §5): two windows on one plan may look at different commits and
 * still agree on every fact the server owns. Reopening a plan lands on now.
 */
type PlanPosition =
  | { readonly _tag: "now" }
  | { readonly _tag: "anchored"; readonly commitId: MercurianCommitId };

const NOW: PlanPosition = { _tag: "now" };

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
  const { detail, isPending, error } = usePlanDetail(planId);
  const appendMessage = useAppendPlanMessage();
  const getPlanTextAt = useGetPlanTextAt();
  const [pane, setPane] = useLocalStorage(
    RIGHT_PANE_STORAGE_KEY,
    DEFAULT_RIGHT_PANE,
    RightPaneState,
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

  const [position, setPosition] = useState<PlanPosition>(NOW);
  const [anchoredText, setAnchoredText] = useState<string | null>(null);

  // Another plan is another history: whatever you were looking at there does
  // not name anything here.
  useEffect(() => setPosition(NOW), [planId]);

  const timeline = detail?.timeline ?? EMPTY_TIMELINE;
  const graph = useMemo(() => buildPlanGraph(timeline), [timeline]);

  /**
   * The conversation is always one path, never the whole history: the commits
   * leading to wherever you stand. At an anchor that is the path through the
   * anchored commit; at now it is the path through the latest one — a branch
   * you are not on is a different conversation, not more of this one.
   *
   * History above a commit is immutable, so the anchored case needs no
   * liveness of its own: new commits keep folding into the subscription, and
   * the projection through an earlier commit cannot change.
   */
  const visibleTimeline = useMemo(() => {
    const head = position._tag === "anchored" ? position.commitId : graph.latest;
    if (head === null) return timeline;
    const closure = ancestorClosure(graph, head);
    return timeline.filter((item) => closure.has(item.commitId));
  }, [graph, position, timeline]);

  // The artifact's text at an earlier commit is the one fact the client cannot
  // derive: revisions travel without their bodies. It is frozen, so one read
  // per anchor is the whole cost.
  useEffect(() => {
    if (position._tag === "now") {
      setAnchoredText(null);
      return;
    }
    let cancelled = false;
    setAnchoredText(null);
    void getPlanTextAt(planId, position.commitId).then((result) => {
      if (!cancelled && result !== null) setAnchoredText(result.planText);
    });
    return () => {
      cancelled = true;
    };
  }, [getPlanTextAt, planId, position]);

  const send = useCallback(
    // The stream delivers the message back; there is nothing to refresh.
    async (text: string) => (await appendMessage(planId, text)) !== null,
    [appendMessage, planId],
  );

  const select = useCallback(
    (commitId: MercurianCommitId) =>
      // Picking the latest commit *is* standing at now: there is no separate
      // way back to say the same thing.
      setPosition(commitId === graph.latest ? NOW : { _tag: "anchored", commitId }),
    [graph.latest],
  );

  const backToNow = useCallback(() => setPosition(NOW), []);

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

  const anchored = position._tag === "anchored";
  const artifactText = anchored ? anchoredText : (detail?.planText ?? null);

  return (
    <PlanningSurface
      // The pane and its icons belong to a plan; a space with no plan has
      // neither.
      actions={detail === null ? null : <PlanPaneToggle state={pane} onChange={setPane} />}
      title={detail?.plan.title ?? (isPending ? "Loading…" : "Plan")}
    >
      {/* Below `sm` the two stack, pane above conversation — same content, no
          second surface to keep in step. */}
      <div className="flex min-h-0 flex-1 flex-col-reverse sm:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PlanTimeline timeline={visibleTimeline} />
          {anchored ? (
            <BackToNowBar onBack={backToNow} />
          ) : (
            <PlanComposer placeholder="Message this plan" onSend={send} />
          )}
        </div>
        {detail === null || !pane.open ? null : (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              className="group relative hidden w-0 shrink-0 select-none sm:block"
            >
              <div className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize" {...handlers}>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60"
                />
              </div>
            </div>
            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-border sm:w-(--plan-pane-width) sm:flex-none sm:border-b-0 sm:border-l"
              style={{ "--plan-pane-width": `${width}px` } as CSSProperties}
            >
              {pane.view === "explorer" ? (
                <DagExplorer
                  anchoredCommitId={anchored ? position.commitId : null}
                  graph={graph}
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
                  planId={planId}
                  planText={artifactText}
                  readOnly={anchored}
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
 * What stands where the composer stands while you are looking at an earlier
 * point. Acting from there is a fork, not an append — so rather than quietly
 * adding to the tip behind your back, the space says where you are and offers
 * the way out.
 */
function BackToNowBar({ onBack }: { readonly onBack: () => void }) {
  return (
    <div className="border-t border-border px-3 py-3 sm:px-5">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
        <ClockIcon className="size-4 shrink-0 text-muted-foreground/70" />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          Viewing an earlier point in this plan’s history
        </span>
        <Button size="sm" variant="outline" onClick={onBack}>
          Back to now
        </Button>
      </div>
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

  const send = useCallback(
    async (text: string) => {
      if (draft === undefined) return false;
      const created = await createPlan(draft.projectId as MercurianProjectId, text);
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
      </Empty>
      <PlanComposer
        placeholder="Describe the work"
        value={draft.text}
        onChangeValue={(text) => setDraftText(draftId, text)}
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

/**
 * Auto-growing textarea plus send. Deliberately not the thread composer: this
 * is how you talk to the plan, not how you edit it — editing is the artifact's
 * own affordance, and both land as commits either way.
 */
function PlanComposer({
  placeholder,
  value,
  onChangeValue,
  onSend,
}: {
  readonly placeholder: string;
  readonly value?: string;
  readonly onChangeValue?: (value: string) => void;
  readonly onSend: (text: string) => Promise<boolean>;
}) {
  const [internalValue, setInternalValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const text = value ?? internalValue;

  const setText = useCallback(
    (next: string) => {
      if (onChangeValue) {
        onChangeValue(next);
      } else {
        setInternalValue(next);
      }
    },
    [onChangeValue],
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }, [text]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || isSending) return;
    setIsSending(true);
    const sent = await onSend(trimmed);
    setIsSending(false);
    if (sent) {
      setText("");
    }
  }, [isSending, onSend, setText, text]);

  return (
    <div className="border-t border-border px-3 py-3 sm:px-5">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <textarea
          ref={textareaRef}
          className="min-h-9 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-hidden ring-ring focus-visible:ring-2"
          placeholder={placeholder}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <Button
          aria-label="Send"
          disabled={text.trim().length === 0 || isSending}
          size="sm"
          onClick={() => void submit()}
        >
          <SendHorizontalIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

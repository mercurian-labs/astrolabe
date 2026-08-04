import type { MercurianProjectId, PlanId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { SendHorizontalIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useResizableWidth } from "../../hooks/useResizableWidth";
import { cn } from "../../lib/utils";
import { usePlanDraftStore } from "../../planDraftStore";
import { useAppendPlanMessage, useCreatePlan, usePlanDetail } from "../../state/mercurian";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";
import { PlanArtifact } from "./PlanArtifact";
import { PlanTimeline } from "./PlanTimeline";

const ARTIFACT_WIDTH_STORAGE_KEY = "mercurian:plan-artifact-width:v1";
const ARTIFACT_DEFAULT_WIDTH = 480;
const ARTIFACT_MIN_WIDTH = 280;
const ARTIFACT_MAX_WIDTH = 900;

/**
 * The planning space: the plan artifact beside the conversation that evolves
 * it, and a composer to act from.
 *
 * The plan sits on the left because it is the standing object the space orbits
 * — and because the right edge belongs to the DAG explorer this surface is
 * growing toward. Nothing here holds plan state: the artifact and the history
 * are two readings of one subscription over the plan's commits.
 */
export function PlanningSpace({ planId }: { readonly planId: PlanId }) {
  const { detail, isPending, error } = usePlanDetail(planId);
  const appendMessage = useAppendPlanMessage();
  const { width, handlers } = useResizableWidth({
    storageKey: ARTIFACT_WIDTH_STORAGE_KEY,
    defaultWidth: ARTIFACT_DEFAULT_WIDTH,
    minWidth: ARTIFACT_MIN_WIDTH,
    maxWidth: ARTIFACT_MAX_WIDTH,
    edge: "right",
  });

  const send = useCallback(
    // The stream delivers the message back; there is nothing to refresh.
    async (text: string) => (await appendMessage(planId, text)) !== null,
    [appendMessage, planId],
  );

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

  return (
    <PlanningSurface title={detail?.plan.title ?? (isPending ? "Loading…" : "Plan")}>
      {/* Below `sm` the panes stack, artifact above conversation — same
          content, no second surface to keep in step. */}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-border sm:w-(--plan-artifact-width) sm:flex-none sm:border-r sm:border-b-0"
          style={{ "--plan-artifact-width": `${width}px` } as CSSProperties}
        >
          {/* Nothing to edit until the space has loaded: an empty artifact and
              a real one look alike, and saving the difference would be a
              revision nobody asked for. */}
          {detail === null ? null : (
            <PlanArtifact planId={planId} planText={detail.planText} timeline={detail.timeline} />
          )}
        </div>
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PlanTimeline timeline={detail?.timeline ?? []} />
          <PlanComposer placeholder="Message this plan" onSend={send} />
        </div>
      </div>
    </PlanningSurface>
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
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "border-b border-border px-3 py-2 sm:px-5 sm:py-3",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
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

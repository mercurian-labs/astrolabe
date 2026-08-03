import type { MercurianProjectId, PlanId, PlanMessage } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { SendHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { usePlanDraftStore } from "../../planDraftStore";
import { useAppendPlanMessage, useCreatePlan, usePlanDetail } from "../../state/mercurian";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "../../workspaceTitlebar";

/**
 * The planning space: one plan's conversation over the commit store.
 *
 * Minimal on purpose. Every commit written here is a human `message`; the plan
 * artifact, assistant turns, and the DAG surface each land on this seam later.
 */
export function PlanningSpace({ planId }: { readonly planId: PlanId }) {
  const { detail, isPending, error, refresh } = usePlanDetail(planId);
  const appendMessage = useAppendPlanMessage();

  const send = useCallback(
    async (text: string) => {
      const appended = await appendMessage(planId, text);
      if (appended !== null) {
        refresh();
      }
      return appended !== null;
    },
    [appendMessage, planId, refresh],
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
      <MessageList messages={detail?.messages ?? []} />
      <PlanComposer placeholder="Message this plan" onSend={send} />
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

function MessageList({ messages }: { readonly messages: ReadonlyArray<PlanMessage> }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
      <ol className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {messages.map((message) => (
          <li
            key={message.commitId}
            className={cn(
              "rounded-lg border border-border/60 px-3 py-2",
              message.authorKind === "human" ? "bg-card/40" : "bg-muted/30",
            )}
          >
            <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground/70">
              <span>{message.authorKind === "human" ? "You" : "Assistant"}</span>
              <span>{formatRelativeTimeLabel(message.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">{message.text}</p>
          </li>
        ))}
      </ol>
      <div ref={bottomRef} />
    </div>
  );
}

/**
 * Auto-growing textarea plus send. Deliberately not the thread composer — the
 * rich composer belongs to the plan artifact, which has not landed.
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

import type {
  ChatAttachment,
  EnvironmentId,
  PlanGroundingItem,
  PlanGroundingScope,
  PlanInFlightTurn,
  PlanQuestion,
  PlanQuestionRecord,
  PlanTimelineItem,
} from "@t3tools/contracts";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  FileSearchIcon,
  FileTextIcon,
  FolderOpenIcon,
  SearchIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAssetUrl } from "../../assets/assetUrls";
import { cn } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

/**
 * The planning space's history: messages and plan revisions in one ordered
 * list, because that is what they are in the store — commits of the same
 * standing in one history. Revisions are not a system-message ghetto; they sit
 * in the same flow, rendered compactly because they have no body to show.
 *
 * Below the last commit, the reply streaming right now — the same shapes the
 * settled message will keep: live text, the grounding fold growing as items
 * arrive, and the question card while one waits. The settled commit replaces
 * it seamlessly because both render from the same facts.
 */
export function PlanTimeline({
  timeline,
  inFlight,
  onAnswerQuestion,
}: {
  readonly timeline: ReadonlyArray<PlanTimelineItem>;
  /** The turn streaming on this path right now, when one is. */
  readonly inFlight?: PlanInFlightTurn | undefined;
  readonly onAnswerQuestion?: (answers: Readonly<Record<string, unknown>>) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const environmentId = usePrimaryEnvironmentId();

  const streamedLength = inFlight?.text.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [timeline.length, streamedLength > 0, inFlight?.questions !== undefined]);

  if (timeline.length === 0 && inFlight === undefined) {
    return <div className="min-h-0 flex-1" />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
      <ol className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {timeline.map((item) =>
          item._tag === "message" ? (
            <li
              key={item.commitId}
              className={cn(
                "rounded-lg border border-border/60 px-3 py-2",
                item.authorKind === "human" ? "bg-card/40" : "bg-muted/30",
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground/70">
                <span>{item.authorKind === "human" ? "You" : "Assistant"}</span>
                <span>{formatRelativeTimeLabel(item.createdAt)}</span>
                {item.interrupted === true ? <InterruptedBadge /> : null}
              </div>
              {item.groundingScope === undefined ? null : (
                <NarrowedGroundingNotice scope={item.groundingScope} />
              )}
              {item.grounding === undefined || item.grounding.length === 0 ? null : (
                <GroundingFold items={item.grounding} />
              )}
              {item.attachments === undefined ||
              item.attachments.length === 0 ||
              environmentId === null ? null : (
                <MessageAttachments attachments={item.attachments} environmentId={environmentId} />
              )}
              <MessageText text={item.text} />
              {item.question === undefined ? null : <QuestionRecord record={item.question} />}
            </li>
          ) : (
            <li
              key={item.commitId}
              className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground/70"
            >
              <FileTextIcon className="size-3.5 shrink-0" />
              <span>
                {item.authorKind === "human"
                  ? "You edited the plan"
                  : "The assistant revised the plan"}
              </span>
              <span>{formatRelativeTimeLabel(item.createdAt)}</span>
            </li>
          ),
        )}
        {inFlight === undefined ? null : (
          <li className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground/70">
              <span>Assistant</span>
              {inFlight.questions === undefined ? (
                <span className="inline-flex items-center gap-1">
                  <Spinner aria-hidden className="size-2.5" />
                  <span>replying…</span>
                </span>
              ) : (
                <span>waiting on you</span>
              )}
            </div>
            {inFlight.groundingScope === undefined ? null : (
              <NarrowedGroundingNotice scope={inFlight.groundingScope} />
            )}
            {inFlight.grounding.length === 0 ? null : (
              <GroundingFold items={inFlight.grounding} live />
            )}
            {inFlight.text.length === 0 ? null : <MessageText text={inFlight.text} />}
            {inFlight.questions === undefined || inFlight.questions.length === 0 ? null : (
              <QuestionCard questions={inFlight.questions} onSubmit={onAnswerQuestion} />
            )}
          </li>
        )}
      </ol>
      <div ref={bottomRef} />
    </div>
  );
}

/** The stopped-response mark: this reply was cut short, and the record says so. */
function InterruptedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-600">
      Interrupted
    </span>
  );
}

/**
 * Grounding that could not reach everything: quiet, above the fold, and only
 * ever rendered when narrowing actually happened.
 */
function NarrowedGroundingNotice({ scope }: { readonly scope: PlanGroundingScope }) {
  return (
    <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
      <CircleAlertIcon className="size-3 shrink-0" />
      <span>
        Grounded without {scope.unreachableRepositories.join(", ")} — out of reach for this
        provider.
      </span>
    </p>
  );
}

const GROUNDING_KIND_ICONS = {
  "file-read": FileSearchIcon,
  search: SearchIcon,
  listing: FolderOpenIcon,
  other: WrenchIcon,
} as const;

/**
 * What the assistant consulted, folded away until expanded — for the
 * streaming turn and the settled commit alike, so nothing changes shape when
 * the reply lands.
 */
function GroundingFold({
  items,
  live = false,
}: {
  readonly items: ReadonlyArray<PlanGroundingItem>;
  readonly live?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = items.length === 1 ? "Consulted 1 item" : `Consulted ${items.length} items`;
  return (
    <div className="mb-1.5">
      <button
        className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronRightIcon
          className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")}
        />
        <span>
          {label}
          {live ? "…" : ""}
        </span>
      </button>
      {expanded ? (
        <ul className="mt-1 flex flex-col gap-0.5 border-l border-border/60 pl-3">
          {items.map((item, index) => {
            const Icon = GROUNDING_KIND_ICONS[item.kind];
            return (
              <li
                key={`${item.kind}-${item.label}-${index}`}
                className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/80"
              >
                <Icon className="size-3 shrink-0 opacity-70" />
                <span className="truncate font-mono">{item.label}</span>
                {item.detail === undefined ? null : (
                  <span className="truncate text-muted-foreground/60">{item.detail}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * A structured question instead of a guess. Options select; multi-select
 * questions collect before submitting. There is deliberately no free-text
 * lane — the composer is right there, and stopping to just say something is
 * the plan's own move.
 */
function QuestionCard({
  questions,
  onSubmit,
}: {
  readonly questions: ReadonlyArray<PlanQuestion>;
  readonly onSubmit?: ((answers: Readonly<Record<string, unknown>>) => void) | undefined;
}) {
  const [selections, setSelections] = useState<Record<string, ReadonlyArray<string>>>({});

  const toggle = (question: PlanQuestion, label: string) => {
    setSelections((current) => {
      const chosen = current[question.id] ?? [];
      if (question.multiSelect === true) {
        return {
          ...current,
          [question.id]: chosen.includes(label)
            ? chosen.filter((one) => one !== label)
            : [...chosen, label],
        };
      }
      return { ...current, [question.id]: [label] };
    });
  };

  const complete = questions.every((question) => (selections[question.id]?.length ?? 0) > 0);

  const submit = () => {
    if (!complete || onSubmit === undefined) return;
    const answers: Record<string, unknown> = {};
    for (const question of questions) {
      const chosen = selections[question.id] ?? [];
      answers[question.id] = question.multiSelect === true ? chosen : (chosen[0] ?? "");
    }
    onSubmit(answers);
  };

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-md border border-border/80 bg-background/60 p-3">
      {questions.map((question) => {
        const chosen = selections[question.id] ?? [];
        return (
          <div key={question.id} className="flex flex-col gap-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {question.header}
            </p>
            <p className="text-sm text-foreground">{question.question}</p>
            <div className="flex flex-col gap-1">
              {question.options.map((option) => {
                const selected = chosen.includes(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                      selected
                        ? "border-primary/70 bg-primary/10 text-foreground"
                        : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                    onClick={() => toggle(question, option.label)}
                  >
                    <span className="font-medium">{option.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground/80">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="flex justify-end">
        <Button disabled={!complete} size="sm" onClick={submit}>
          Answer
        </Button>
      </div>
    </div>
  );
}

/**
 * The exchange as the settled commit recorded it: what was asked, and what
 * it was answered — or that it never was, when the turn ended first.
 */
function QuestionRecord({ record }: { readonly record: PlanQuestionRecord }) {
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border/60 bg-background/40 p-2.5">
      {record.questions.map((question) => {
        const answer = record.answers?.[question.id];
        const answerLabel = Array.isArray(answer)
          ? answer.join(", ")
          : typeof answer === "string"
            ? answer
            : null;
        return (
          <div key={question.id} className="text-xs">
            <p className="text-muted-foreground">{question.question}</p>
            {answerLabel === null ? (
              <p className="mt-0.5 italic text-muted-foreground/60">Not answered</p>
            ) : (
              <p className="mt-0.5 font-medium text-foreground">{answerLabel}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A message's text, with its mentions read back as the chips they were.
 *
 * A mention is an inline token in the text itself — nothing on the wire says
 * "this message has a mention" — so rendering one is a pure pass over what
 * arrived. That is what makes "the chip travels with the message" true rather
 * than reconstructed: the chip and the characters are the same thing.
 */
function MessageText({ text }: { readonly text: string }) {
  const parts = useMemo((): ReadonlyArray<ReactNode> => {
    const tokens = collectComposerInlineTokens(text).filter((token) => token.type === "mention");
    if (tokens.length === 0) return [text];

    const rendered: Array<ReactNode> = [];
    let cursor = 0;
    for (const [index, token] of tokens.entries()) {
      if (token.start > cursor) rendered.push(text.slice(cursor, token.start));
      rendered.push(
        <span
          key={`mention-${index}`}
          className="rounded bg-muted/70 px-1 py-0.5 font-medium text-foreground"
        >
          {token.value}
        </span>,
      );
      cursor = token.end;
    }
    if (cursor < text.length) rendered.push(text.slice(cursor));
    return rendered;
  }, [text]);

  return <p className="whitespace-pre-wrap text-sm text-foreground">{parts}</p>;
}

/**
 * The images a message carried. The commit holds only their metadata, so each
 * one is fetched through the assets door by id — the same door the fork's
 * threads read theirs through, which never knew or cared what a thread was.
 */
function MessageAttachments({
  attachments,
  environmentId,
}: {
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly environmentId: EnvironmentId;
}) {
  return (
    <ul className="mb-2 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <MessageAttachment attachment={attachment} environmentId={environmentId} />
        </li>
      ))}
    </ul>
  );
}

function MessageAttachment({
  attachment,
  environmentId,
}: {
  readonly attachment: ChatAttachment;
  readonly environmentId: EnvironmentId;
}) {
  const url = useAssetUrl(environmentId, {
    _tag: "attachment",
    attachmentId: attachment.id,
  });

  if (url === null) {
    // The image is on its way. A sized placeholder keeps the message from
    // jumping when it lands.
    return <div className="size-24 rounded-md border border-border bg-muted/40" />;
  }
  return (
    <img
      alt={attachment.name}
      className="size-24 rounded-md border border-border object-cover"
      src={url}
    />
  );
}

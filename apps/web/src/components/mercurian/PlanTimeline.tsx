import type { ChatAttachment, EnvironmentId, PlanTimelineItem } from "@t3tools/contracts";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";
import { FileTextIcon } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { useAssetUrl } from "../../assets/assetUrls";
import { cn } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { formatRelativeTimeLabel } from "../../timestampFormat";

/**
 * The planning space's history: messages and plan revisions in one ordered
 * list, because that is what they are in the store — commits of the same
 * standing in one history. Revisions are not a system-message ghetto; they sit
 * in the same flow, rendered compactly because they have no body to show.
 */
export function PlanTimeline({ timeline }: { readonly timeline: ReadonlyArray<PlanTimelineItem> }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const environmentId = usePrimaryEnvironmentId();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [timeline.length]);

  if (timeline.length === 0) {
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
              </div>
              {item.attachments === undefined ||
              item.attachments.length === 0 ||
              environmentId === null ? null : (
                <MessageAttachments attachments={item.attachments} environmentId={environmentId} />
              )}
              <MessageText text={item.text} />
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
      </ol>
      <div ref={bottomRef} />
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

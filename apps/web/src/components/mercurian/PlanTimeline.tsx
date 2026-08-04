import type { PlanTimelineItem } from "@t3tools/contracts";
import { FileTextIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";

/**
 * The planning space's history: messages and plan revisions in one ordered
 * list, because that is what they are in the store — commits of the same
 * standing in one history. Revisions are not a system-message ghetto; they sit
 * in the same flow, rendered compactly because they have no body to show.
 */
export function PlanTimeline({ timeline }: { readonly timeline: ReadonlyArray<PlanTimelineItem> }) {
  const bottomRef = useRef<HTMLDivElement>(null);

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
              <p className="whitespace-pre-wrap text-sm text-foreground">{item.text}</p>
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

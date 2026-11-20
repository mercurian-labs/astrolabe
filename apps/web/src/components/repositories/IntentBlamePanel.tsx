import type { EnvironmentId, IntentBlameResult, IntentBlameTurn } from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Button } from "../ui/button";
import { type IntentBlameAsk, sharesIn, spanAt } from "./intentBlame";

/**
 * Astrolabe: "Why is this here?" for the line under the cursor and the item around it: the turn
 * that last changed it, with the person's request and the agent's own words, or that none did.
 */
export function IntentBlamePanel({
  environmentId,
  cwd,
  path,
  ask,
  stale,
  onAskAgain,
  onOpenTurn,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly ask: IntentBlameAsk;
  /** The file changed after the question was asked. */
  readonly stale: boolean;
  readonly onAskAgain: () => void;
  readonly onOpenTurn: (turn: IntentBlameTurn) => void;
  readonly onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    vcsEnvironment.intentBlame({
      environmentId,
      input: ask.unsaved ? { cwd, path, contents: ask.text } : { cwd, path },
    }),
  );
  const result = query.data;
  return (
    <section
      aria-label="Why is this here?"
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-border bg-background"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="flex items-center gap-2 px-(--workspace-gutter-start) py-1.5 text-xs">
        <span className="font-medium text-foreground">Why is this here?</span>
        <span className="text-muted-foreground">Line {ask.line}</span>
        <span className="flex-1" />
        <Button size="icon-xs" variant="ghost" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-(--workspace-gutter-start) pb-3 text-sm">
        {stale ? (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex-1">The file changed after you asked.</span>
            <Button size="xs" variant="outline" onClick={onAskAgain}>
              Ask again
            </Button>
          </div>
        ) : null}
        {query.error !== null ? (
          <p className="text-muted-foreground">{query.error}</p>
        ) : result === null ? (
          <p className="text-muted-foreground">Reading the turns that changed this file…</p>
        ) : (
          <Answer result={result} ask={ask} cwd={cwd} onOpenTurn={onOpenTurn} />
        )}
      </div>
    </section>
  );
}

const lines = (count: number) => `${count} ${count === 1 ? "line" : "lines"}`;
const turns = (count: number) => `${count} recorded ${count === 1 ? "turn" : "turns"}`;

const ORIGIN_TEXT = {
  before:
    "No recorded turn changed this line. It was there before the first recorded turn that changed this file.",
  outside:
    "This line last changed outside the recorded turns: by a person, a merge or pull, or a turn whose checkpoint is gone.",
  unsaved: "This line is not saved yet.",
} as const;

function Answer({
  result,
  ask,
  cwd,
  onOpenTurn,
}: {
  readonly result: IntentBlameResult;
  readonly ask: IntentBlameAsk;
  readonly cwd: string;
  readonly onOpenTurn: (turn: IntentBlameTurn) => void;
}) {
  const missing =
    result.missingCheckpoints > 0 ? (
      <p className="text-xs text-muted-foreground">
        {turns(result.missingCheckpoints)} that changed this file no longer{" "}
        {result.missingCheckpoints === 1 ? "has its checkpoint" : "have their checkpoints"} in this
        repository.
      </p>
    ) : null;
  if (result.turns.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground">
          {result.changedBy === 0
            ? "No recorded turn changed this file."
            : `${turns(result.changedBy)} changed this file. None of their lines remain.`}
        </p>
        {missing}
      </div>
    );
  }
  const span = spanAt(result, ask.line);
  const lineTurn = span?.origin === "turn" && span.turn !== undefined ? span.turn : null;
  const item = ask.item;
  const shares = item ? sharesIn(result, item.startLine, item.endLine) : [];
  const otherTurns = shares.filter((share) => share.turn !== null && share.turn !== lineTurn);
  const untouched = shares
    .filter((share) => share.turn === null)
    .reduce((total, share) => total + share.lines, 0);
  const fromTurns = shares.flatMap((share) =>
    share.turn === null
      ? []
      : [`${lines(share.lines)} from turn ${result.turns[share.turn]!.turnNumber}`],
  );
  return (
    <div className="flex flex-col gap-3">
      {lineTurn !== null ? (
        <TurnCard
          turn={result.turns[lineTurn]!}
          lead="This line last changed in"
          cwd={cwd}
          onOpenTurn={onOpenTurn}
        />
      ) : (
        <p className="text-muted-foreground">
          {span === null || span.origin === "turn" ? ORIGIN_TEXT.outside : ORIGIN_TEXT[span.origin]}
        </p>
      )}
      {item ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{item.name}</span> ({item.kind}, lines{" "}
            {item.startLine}–{item.endLine}):{" "}
            {fromTurns.join(", ") || "no lines from a recorded turn"}
            {untouched > 0 && fromTurns.length > 0
              ? `; ${lines(untouched)} not from a recorded turn`
              : ""}
            .
          </p>
          {otherTurns.map((share) => (
            <TurnCard
              key={share.turn}
              turn={result.turns[share.turn!]!}
              lead={`${lines(share.lines)} here last changed in`}
              cwd={cwd}
              onOpenTurn={onOpenTurn}
              compact
            />
          ))}
        </div>
      ) : null}
      {missing}
    </div>
  );
}

function TurnCard({
  turn,
  lead,
  cwd,
  onOpenTurn,
  compact = false,
}: {
  readonly turn: IntentBlameTurn;
  readonly lead: string;
  readonly cwd: string;
  readonly onOpenTurn: (turn: IntentBlameTurn) => void;
  readonly compact?: boolean;
}) {
  const closing = turn.closing !== turn.beforeChange ? turn.closing : null;
  const canOpen =
    turn.beforeChangeMessageId !== null ||
    turn.closingMessageId !== null ||
    turn.userMessageId !== null;
  return (
    <article className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {lead} turn {turn.turnNumber} of{" "}
          <span className="font-medium text-foreground">{turn.threadTitle}</span>
          {", "}
          <time dateTime={turn.at}>{formatRelativeTimeLabel(turn.at)}</time>
          {turn.checkout !== cwd ? (
            <>
              {", in "}
              <span className="font-mono">{turn.checkout.split("/").at(-1)}</span>
            </>
          ) : null}
        </p>
        {canOpen ? (
          <Button size="xs" variant="outline" onClick={() => onOpenTurn(turn)}>
            Open turn
          </Button>
        ) : null}
      </div>
      <Quote label="Request" text={turn.request} lines={compact ? 2 : 4} />
      {compact ? null : (
        <>
          {turn.beforeChange !== null ? (
            <Quote
              label="The agent, before changing this file"
              text={turn.beforeChange}
              lines={4}
            />
          ) : null}
          {closing !== null ? (
            <details className="group">
              <summary className="cursor-default text-2xs uppercase tracking-wide text-muted-foreground">
                The agent, at the end of the turn
              </summary>
              <p className="mt-0.5 whitespace-pre-wrap text-foreground">
                <InlineMarkdown text={closing} />
              </p>
            </details>
          ) : null}
        </>
      )}
    </article>
  );
}

const CLAMP = { 2: "line-clamp-2", 4: "line-clamp-4" } as const;

function Quote({
  label,
  text,
  lines: clamp,
}: {
  readonly label: string;
  readonly text: string;
  readonly lines: keyof typeof CLAMP;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className={`whitespace-pre-wrap text-foreground ${CLAMP[clamp]}`}>
        <InlineMarkdown text={text} />
      </p>
    </div>
  );
}

/** Code spans as code, emphasis and link markup dropped: enough to read a message, no renderer. */
function InlineMarkdown({ text }: { readonly text: string }) {
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const part of text.split(/(`[^`\n]+`)/)) {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      parts.push(
        <code key={offset} className="font-mono">
          {part.slice(1, -1)}
        </code>,
      );
    } else if (part.length > 0) {
      parts.push(
        part
          .replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1")
          .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2"),
      );
    }
    offset += part.length;
  }
  return parts;
}

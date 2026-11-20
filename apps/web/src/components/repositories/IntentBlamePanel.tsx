import type { EnvironmentId, IntentBlameResult, IntentBlameTurn } from "@t3tools/contracts";
import { XIcon } from "lucide-react";

import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Button } from "../ui/button";
import { type IntentBlameAsk, sharesIn, spanAt } from "./intentBlame";

/**
 * Astrolabe: "Why is this here?" for the line under the cursor and the item around it: the turn
 * that last wrote it, with the person's request and the agent's own words, or that none did.
 */
export function IntentBlamePanel({
  environmentId,
  cwd,
  path,
  ask,
  onOpenTurn,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly ask: IntentBlameAsk;
  readonly onOpenTurn: (turn: IntentBlameTurn) => void;
  readonly onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    vcsEnvironment.intentBlame({ environmentId, input: { cwd, path } }),
  );
  const result = query.data;
  return (
    <section
      aria-label="Why is this here?"
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-t border-border bg-background"
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
  const span = spanAt(result, ask.line);
  const lineTurn = span?.origin === "turn" && span.turn !== undefined ? span.turn : null;
  const item = ask.item;
  const shares = item ? sharesIn(result, item.startLine, item.endLine) : [];
  const otherTurns = shares.filter((share) => share.turn !== null && share.turn !== lineTurn);
  const untouched = shares
    .filter((share) => share.turn === null)
    .reduce((total, share) => total + share.lines, 0);
  return (
    <div className="flex flex-col gap-3">
      {result.turns.length === 0 ? (
        <p className="text-muted-foreground">No recorded turn changed this file.</p>
      ) : lineTurn !== null ? (
        <TurnCard
          turn={result.turns[lineTurn]!}
          lead="This line was last written in"
          cwd={cwd}
          onOpenTurn={onOpenTurn}
        />
      ) : (
        <p className="text-muted-foreground">
          {span?.origin === "before"
            ? "This line was not written in a recorded turn. It was there before the first recorded turn that changed this file."
            : "This line was not written in a recorded turn. It changed outside them: by a person, a merge, or a turn whose checkpoint is gone."}
        </p>
      )}
      {item && result.turns.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{item.name}</span> ({item.kind}, lines{" "}
            {item.startLine}–{item.endLine}):{" "}
            {shares
              .map((share) =>
                share.turn === null
                  ? null
                  : `${share.lines} ${share.lines === 1 ? "line" : "lines"} from turn ${result.turns[share.turn]!.turnNumber}`,
              )
              .filter((part) => part !== null)
              .join(", ") || "no lines from a recorded turn"}
            {untouched > 0
              ? `; ${untouched} ${untouched === 1 ? "line" : "lines"} not from a recorded turn`
              : ""}
            .
          </p>
          {otherTurns.map((share) => (
            <TurnCard
              key={share.turn}
              turn={result.turns[share.turn!]!}
              lead={`${share.lines} ${share.lines === 1 ? "line" : "lines"} here were written in`}
              cwd={cwd}
              onOpenTurn={onOpenTurn}
              compact
            />
          ))}
        </div>
      ) : null}
      {result.missingCheckpoints > 0 ? (
        <p className="text-xs text-muted-foreground">
          {result.missingCheckpoints}{" "}
          {result.missingCheckpoints === 1 ? "turn that changed" : "turns that changed"} this file
          no longer {result.missingCheckpoints === 1 ? "has a checkpoint" : "have checkpoints"} in
          this repository.
        </p>
      ) : null}
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
        {turn.userMessageId !== null ? (
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
            <Quote label="The agent, at the end of the turn" text={closing} lines={3} />
          ) : null}
        </>
      )}
    </article>
  );
}

const CLAMP = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4" } as const;

function Quote({
  label,
  text,
  lines,
}: {
  readonly label: string;
  readonly text: string;
  readonly lines: keyof typeof CLAMP;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className={`whitespace-pre-wrap text-foreground ${CLAMP[lines]}`}>{text}</p>
    </div>
  );
}

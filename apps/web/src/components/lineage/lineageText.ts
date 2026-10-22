import { formatModelSlugName } from "@t3tools/shared/model";

import { formatElapsedDurationLabel } from "~/timestampFormat";
import { formatCompactDiffCount } from "../chat/DiffStatLabel";
import type { LineageLabel, LineageTurn } from "./lineageLayout";

/** How long ago an instant (epoch ms) was: "3h ago", or "just now". */
export function agoLabel(at: number, now: number): string {
  const elapsed = formatElapsedDurationLabel(new Date(at).toISOString(), now);
  return elapsed === "just now" ? elapsed : `${elapsed} ago`;
}

/** Line totals as the chat shows them: "+1.2k −340". */
export function lineTotals(additions: number, deletions: number): string {
  return `+${formatCompactDiffCount(additions)} −${formatCompactDiffCount(deletions)}`;
}

/**
 * A thread label's line after its agent's name: where the thread stands, when an idle one last
 * moved, and how many turns its parent has taken since it forked.
 */
export function labelStatus(
  label: Pick<LineageLabel, "state" | "lastActiveAt" | "behind">,
  now: number,
): string {
  const state =
    label.state === "waiting"
      ? "waiting on you"
      : label.state === "idle"
        ? `idle · ${agoLabel(label.lastActiveAt, now)}`
        : label.state;
  return label.behind > 0 ? `${state} · ${label.behind} behind` : state;
}

/** A turn's facts for its hover card: what it changed, its model, and when it ended. */
export function turnFacts(turn: LineageTurn, now: number): string {
  const parts: string[] = [];
  if (turn.files > 0) {
    parts.push(
      `${turn.files} ${turn.files === 1 ? "file" : "files"} ${lineTotals(turn.additions, turn.deletions)}`,
    );
  }
  if (turn.model !== null) parts.push(formatModelSlugName(turn.model));
  parts.push(
    turn.running || turn.completedAt === null
      ? `asked ${agoLabel(turn.at, now)}`
      : agoLabel(turn.completedAt, now),
  );
  return parts.join(" · ");
}

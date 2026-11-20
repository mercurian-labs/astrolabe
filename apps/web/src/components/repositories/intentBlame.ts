import type { IntentBlameOrigin, IntentBlameResult, IntentBlameSpan } from "@t3tools/contracts";

/** What "Why is this here?" was asked of: the cursor's line and the item around it. */
export interface IntentBlameAsk {
  readonly id: number;
  readonly line: number;
  readonly item: {
    readonly name: string;
    readonly kind: string;
    readonly startLine: number;
    readonly endLine: number;
  } | null;
}

export function spanAt(result: IntentBlameResult, line: number): IntentBlameSpan | null {
  return result.spans.find((span) => span.startLine <= line && line <= span.endLine) ?? null;
}

export interface LineShare {
  /** An index into the result's turns, or null for lines no turn wrote. */
  readonly turn: number | null;
  readonly origin: IntentBlameOrigin;
  readonly lines: number;
}

/** Who wrote lines `startLine`–`endLine`: the turns by how many lines they wrote, then the rest. */
export function sharesIn(
  result: IntentBlameResult,
  startLine: number,
  endLine: number,
): LineShare[] {
  const byKey = new Map<string, LineShare>();
  for (const span of result.spans) {
    const lines = Math.min(span.endLine, endLine) - Math.max(span.startLine, startLine) + 1;
    if (lines <= 0) continue;
    const turn = span.origin === "turn" ? (span.turn ?? null) : null;
    const key = turn === null ? span.origin : `turn:${turn}`;
    const share = byKey.get(key);
    byKey.set(key, { turn, origin: span.origin, lines: (share?.lines ?? 0) + lines });
  }
  return [...byKey.values()].toSorted(
    (a, b) => Number(a.turn === null) - Number(b.turn === null) || b.lines - a.lines,
  );
}

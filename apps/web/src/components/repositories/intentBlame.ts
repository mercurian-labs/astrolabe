import type { EditorView } from "@codemirror/view";
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
  /** The editor's text when asked; sent only when it was not saved yet. */
  readonly text: string;
  readonly unsaved: boolean;
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

const MARKUP_START = /^\s*(?:#{1,6}|[-*+>]|\d+[.)])\s+/;
const PLAIN_RUN = /[\p{L}\p{N}][\p{L}\p{N} ,.;:()!?/-]{23,}/u;

/**
 * Words of a Markdown message that render as they are written, for a citation to find on the
 * page: the first long run free of markup, quotes and dashes a renderer may change. Null when
 * the message has none.
 */
export function plainQuote(markdown: string): string | null {
  for (const line of markdown.split("\n")) {
    const run = PLAIN_RUN.exec(line.replace(MARKUP_START, ""))?.[0];
    if (!run || run.includes("--")) continue;
    const words = run.slice(0, 160);
    const cut = words.length < run.length ? words.slice(0, words.lastIndexOf(" ")) : words;
    const quote = cut.trim();
    if (quote.length >= 24) return quote;
  }
  return null;
}

/** The file editors that can be asked, for the keyboard menu. */
const askers = new WeakMap<EditorView, () => void>();

export function registerIntentBlameAsker(view: EditorView, ask: () => void): void {
  askers.set(view, ask);
}

export function intentBlameAskerFor(view: EditorView): (() => void) | null {
  return askers.get(view) ?? null;
}

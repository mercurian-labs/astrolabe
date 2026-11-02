import type { ChangeDesc, Text } from "@codemirror/state";

/**
 * Astrolabe: which lines of a file a multi-file view shows. An excerpt is a run of whole lines
 * around the lines it is about (a match, a problem, a reference) with some context; excerpts of
 * one file that overlap or touch merge into one.
 */

/** A run of whole lines, 1-based and inclusive. */
export interface LineSpan {
  readonly first: number;
  readonly last: number;
}

/** The lines something of interest covers: `endLine` defaults to `line`. */
export interface LineOfInterest {
  readonly line: number;
  readonly endLine?: number;
}

/** Lines of context shown above and below each line of interest. */
export const EXCERPT_CONTEXT_LINES = 2;
/** Lines one expand adds in each direction asked for. */
export const EXCERPT_EXPAND_LINES = 5;

const clampLine = (line: number, lineCount: number) => Math.min(Math.max(line, 1), lineCount);

/**
 * The excerpts for `lines` of a file with `lineCount` lines: each with `context` lines either side,
 * clamped to the file, sorted, and merged where they overlap or touch. Each excerpt lists the
 * indexes of the lines of interest it holds.
 */
export function excerptSpans(
  lines: readonly LineOfInterest[],
  lineCount: number,
  context: number = EXCERPT_CONTEXT_LINES,
): Array<LineSpan & { readonly items: readonly number[] }> {
  const count = Math.max(lineCount, 1);
  const spans = lines
    .map((item, index) => {
      const start = clampLine(item.line, count);
      const end = clampLine(Math.max(item.endLine ?? item.line, item.line), count);
      return {
        first: clampLine(start - context, count),
        last: clampLine(end + context, count),
        items: [index],
      };
    })
    .toSorted((a, b) => a.first - b.first || a.last - b.last);
  const merged: Array<{ first: number; last: number; items: number[] }> = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous !== undefined && span.first <= previous.last + 1) {
      previous.last = Math.max(previous.last, span.last);
      previous.items.push(...span.items);
    } else {
      merged.push({ ...span, items: [...span.items] });
    }
  }
  return merged;
}

/** `span` grown by `up` lines above and `down` below, clamped to the file. */
export function expandSpan(span: LineSpan, lineCount: number, up: number, down: number): LineSpan {
  const count = Math.max(lineCount, 1);
  return {
    first: clampLine(span.first - Math.max(up, 0), count),
    last: clampLine(span.last + Math.max(down, 0), count),
  };
}

/**
 * Which of a file's spans (in order) to merge: each group of indexes overlaps or touches. Groups of
 * one are left out, so an empty result means nothing merges.
 */
export function touchingGroups(spans: readonly LineSpan[]): number[][] {
  const order = spans
    .map((_, index) => index)
    .toSorted((a, b) => spans[a]!.first - spans[b]!.first);
  const groups: number[][] = [];
  let current: number[] = [];
  let last = -Infinity;
  for (const index of order) {
    const span = spans[index]!;
    if (current.length > 0 && span.first <= last + 1) {
      current.push(index);
      last = Math.max(last, span.last);
      continue;
    }
    if (current.length > 1) groups.push(current);
    current = [index];
    last = span.last;
  }
  if (current.length > 1) groups.push(current);
  return groups;
}

/**
 * New spans for a file whose old ones the person may have expanded: each new span widens to cover
 * the old ones it overlaps (keeping their extra context), and old spans that overlap none go.
 */
export function updateSpans(
  previous: readonly LineSpan[],
  next: readonly LineSpan[],
): Array<LineSpan & { readonly kept: readonly number[] }> {
  const widened = next.map((span) => {
    let { first, last } = span;
    const kept: number[] = [];
    previous.forEach((old, index) => {
      if (old.first <= last && first <= old.last) {
        first = Math.min(first, old.first);
        last = Math.max(last, old.last);
        kept.push(index);
      }
    });
    return { first, last, kept };
  });
  const merged: Array<{ first: number; last: number; kept: number[] }> = [];
  for (const span of widened.toSorted((a, b) => a.first - b.first)) {
    const previousSpan = merged.at(-1);
    if (previousSpan !== undefined && span.first <= previousSpan.last + 1) {
      previousSpan.last = Math.max(previousSpan.last, span.last);
      for (const index of span.kept) {
        if (!previousSpan.kept.includes(index)) previousSpan.kept.push(index);
      }
    } else {
      merged.push({ ...span, kept: [...span.kept] });
    }
  }
  return merged;
}

/** A run of whole lines as document positions: the start of its first line, the end of its last. */
export interface ExcerptBounds {
  readonly from: number;
  readonly to: number;
}

export function boundsOfSpan(doc: Text, span: LineSpan): ExcerptBounds {
  const first = doc.line(clampLine(span.first, doc.lines));
  const last = doc.line(clampLine(Math.max(span.last, span.first), doc.lines));
  return { from: first.from, to: last.to };
}

export function spanOfBounds(doc: Text, bounds: ExcerptBounds): LineSpan {
  return { first: doc.lineAt(bounds.from).number, last: doc.lineAt(bounds.to).number };
}

/**
 * `bounds` through `changes`, which turned some document into `doc`. Text typed at either edge
 * stays inside; lines inserted or removed inside grow or shrink it; it always covers whole lines.
 */
export function mapBounds(bounds: ExcerptBounds, changes: ChangeDesc, doc: Text): ExcerptBounds {
  const from = changes.mapPos(bounds.from, -1);
  const to = Math.max(changes.mapPos(bounds.to, 1), from);
  const start = doc.lineAt(from).from;
  const end = doc.lineAt(to).to;
  return start === bounds.from && end === bounds.to ? bounds : { from: start, to: end };
}

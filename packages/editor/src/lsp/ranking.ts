/**
 * Astrolabe: how a completion menu orders the language server's items for the word being typed.
 * Items whose words one starts with the query's first character come first; within them an exact
 * match wins, then the closer fuzzy match, earlier matches, matching case, the server's sort
 * text, the kind (keyword, variable, constant, property, the rest) and the label.
 */

export interface RankedItem {
  /** What the query is matched against (LSP `filterText`, else the label). */
  readonly filterText: string;
  readonly label: string;
  readonly sortText?: string | undefined;
  /** LSP `CompletionItemKind`. */
  readonly kind?: number | undefined;
}

export interface Ranked<T> {
  readonly item: T;
  /** Matched character offsets in `filterText`, in order. */
  readonly matched: readonly number[];
}

// Keyword, then variable, then constant (and enum members), then property and field.
const KIND_RANK: Readonly<Record<number, number>> = { 14: 0, 6: 1, 21: 2, 20: 2, 10: 3, 5: 3 };
const kindRank = (kind: number | undefined) => (kind === undefined ? 4 : (KIND_RANK[kind] ?? 4));

/** Whether `index` starts a word: the text's start, after a separator, or a case or digit step. */
function wordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const char = text[index]!;
  const before = text[index - 1]!;
  if (!/[A-Za-z0-9]/.test(before)) return /[A-Za-z0-9]/.test(char);
  if (/[A-Z]/.test(char) && /[a-z]/.test(before)) return true;
  return /[0-9]/.test(char) !== /[0-9]/.test(before);
}

interface Match {
  readonly matched: number[];
  readonly firstAtWord: boolean;
  readonly score: number;
  readonly caseHits: number;
}

/**
 * Matches `query` in `text` as a subsequence, preferring the start of words and runs, or null.
 * Greedy from each candidate start: cheap, and close enough to the best alignment for menus.
 */
function match(query: string, text: string): Match | null {
  if (query.length === 0) return { matched: [], firstAtWord: true, score: 0, caseHits: 0 };
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let best: Match | null = null;
  for (let start = 0; start < text.length; start++) {
    if (lowerText[start] !== lowerQuery[0]) continue;
    const matched = [start];
    let at = start + 1;
    for (let q = 1; q < lowerQuery.length && matched.length === q; q++) {
      // The next character right after the last match, else the next word start holding it, else
      // the next anywhere.
      let found = -1;
      if (lowerText[at] === lowerQuery[q]) found = at;
      else {
        for (let i = at; i < text.length; i++) {
          if (lowerText[i] !== lowerQuery[q]) continue;
          if (found < 0) found = i;
          if (wordStart(text, i)) {
            found = i;
            break;
          }
        }
      }
      if (found < 0) break;
      matched.push(found);
      at = found + 1;
    }
    if (matched.length !== query.length) continue;
    let score = 0;
    let caseHits = 0;
    for (const [q, index] of matched.entries()) {
      if (wordStart(text, index)) score += 3;
      if (q > 0 && index === matched[q - 1]! + 1) score += 2;
      if (text[index] === query[q]) caseHits++;
    }
    score -= matched.at(-1)! - matched[0]! + 1 - matched.length;
    if (start === 0) score += 4;
    const candidate = { matched, firstAtWord: wordStart(text, start), score, caseHits };
    if (best === null || better(candidate, best)) best = candidate;
  }
  return best;
}

function better(a: Match, b: Match): boolean {
  if (a.firstAtWord !== b.firstAtWord) return a.firstAtWord;
  if (a.score !== b.score) return a.score > b.score;
  return a.matched[0]! < b.matched[0]!;
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The items `query` matches, best first. */
export function rankCompletions<T extends RankedItem>(
  items: readonly T[],
  query: string,
): Ranked<T>[] {
  const lowerQuery = query.toLowerCase();
  const scored: Array<{ readonly item: T; readonly match: Match; readonly exact: boolean }> = [];
  for (const item of items) {
    const found = match(query, item.filterText);
    if (found === null) continue;
    scored.push({
      item,
      match: found,
      exact: query.length > 0 && item.filterText.toLowerCase() === lowerQuery,
    });
  }
  scored.sort((a, b) => {
    // Two tiers: the query's first character at the start of one of the item's words, or not.
    if (a.match.firstAtWord !== b.match.firstAtWord) return a.match.firstAtWord ? -1 : 1;
    if (a.match.firstAtWord) {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      if (a.match.score !== b.match.score) return b.match.score - a.match.score;
      const positions =
        a.match.matched.reduce((sum, at) => sum + at, 0) -
        b.match.matched.reduce((sum, at) => sum + at, 0);
      if (positions !== 0) return positions;
      if (a.match.caseHits !== b.match.caseHits) return b.match.caseHits - a.match.caseHits;
      const sort = compareText(a.item.sortText ?? a.item.label, b.item.sortText ?? b.item.label);
      if (sort !== 0) return sort;
      const kind = kindRank(a.item.kind) - kindRank(b.item.kind);
      if (kind !== 0) return kind;
      return compareText(a.item.label, b.item.label);
    }
    if (a.match.score !== b.match.score) return b.match.score - a.match.score;
    return compareText(a.item.sortText ?? a.item.label, b.item.sortText ?? b.item.label);
  });
  return scored.map(({ item, match: found }) => ({ item, matched: found.matched }));
}

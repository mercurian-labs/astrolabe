import type { OutlineItem } from "@mercurian/editor/outline";
import { normalizeSearchQuery, scoreSubsequenceMatch } from "@t3tools/shared/searchRanking";

export const OUTLINE_PICKER_RESULT_LIMIT = 500;

export interface OutlinePickerRow {
  readonly item: OutlineItem;
  /** The item's place in the outline, a stable key for its row. */
  readonly index: number;
  /** The enclosing items' names, outermost first. */
  readonly ancestors: readonly string[];
  /** Where the query's last word matched the item's name. */
  readonly matchIndices: readonly number[];
}

function matchIndices(value: string, word: string): number[] {
  const indices: number[] = [];
  for (let at = 0; at < value.length && indices.length < word.length; at += 1) {
    if (value[at] === word[indices.length]) indices.push(at);
  }
  return indices;
}

/**
 * The picker's rows for `query`: every item in source order when it is empty. Otherwise its last
 * word fuzzy-matches an item's own name, and any words before it match the item's enclosing
 * items' names in order (`store add` finds `add` in `Store`), so one word never matches a child
 * through its parent. Best match first; ties keep source order.
 */
export function outlinePickerRows(
  items: readonly OutlineItem[],
  query: string,
): OutlinePickerRow[] {
  const words = normalizeSearchQuery(query).split(/\s+/).filter(Boolean);
  const last = words.pop();
  const scored: { row: OutlinePickerRow; score: number }[] = [];
  const open: OutlineItem[] = [];
  items.forEach((item, index) => {
    open.length = Math.min(open.length, item.depth);
    const ancestors = open.map((ancestor) => ancestor.name);
    open.push(item);
    if (last === undefined) {
      scored.push({ row: { item, index, ancestors, matchIndices: [] }, score: 0 });
      return;
    }
    const name = item.name.toLowerCase();
    let score = scoreSubsequenceMatch(name, last);
    if (score === null) return;
    let from = 0;
    for (const word of words) {
      const at = ancestors.findIndex(
        (ancestor, position) =>
          position >= from && scoreSubsequenceMatch(ancestor.toLowerCase(), word) !== null,
      );
      if (at === -1) return;
      score += scoreSubsequenceMatch(ancestors[at]!.toLowerCase(), word, { ignorePosition: true })!;
      from = at + 1;
    }
    const row = { item, index, ancestors, matchIndices: matchIndices(name, last) };
    scored.push({ row, score });
  });
  return scored.toSorted((a, b) => a.score - b.score).map(({ row }) => row);
}

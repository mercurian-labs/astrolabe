import diff from "fast-diff";

interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * The edits that turn `from` into `to`, as ranges of `from`. Semantic cleanup makes a rewritten
 * phrase one replacement (one change-log op, one ghost) instead of scattered shared letters, and no
 * wider: a pure insert or delete stays one, so untouched characters keep their Yjs items.
 */
export function textEdits(from: string, to: string): Edit[] {
  const edits: Edit[] = [];
  let index = 0;
  let pending: Edit | null = null;
  for (const [op, chunk] of diff(from, to, undefined, true)) {
    if (op === diff.EQUAL) {
      if (pending) edits.push(pending);
      pending = null;
      index += chunk.length;
      continue;
    }
    pending ??= { from: index, to: index, insert: "" };
    if (op === diff.DELETE) {
      index += chunk.length;
      pending.to = index;
    } else {
      pending.insert += chunk;
    }
  }
  if (pending) edits.push(pending);
  return edits;
}

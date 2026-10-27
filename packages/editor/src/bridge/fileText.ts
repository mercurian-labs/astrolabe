import diff from "fast-diff";
import * as Y from "yjs";
import {
  agentChangeOp,
  originRuns,
  recordAgentChange,
  type AgentChangeAuthor,
} from "../collab/changeLog.ts";

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
function textEdits(from: string, to: string): Edit[] {
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

/**
 * Maps positions in `from` to positions in `to`. A position inside deleted text collapses
 * to where the deletion happened; `assoc` picks the side of text inserted at a position.
 */
function positionMapper(from: string, to: string): (position: number, assoc: -1 | 1) => number {
  const ops = diff(from, to);
  return (position, assoc) => {
    let a = 0;
    let b = 0;
    for (const [op, chunk] of ops) {
      if (op === diff.EQUAL) {
        if (position < a + chunk.length || (position === a + chunk.length && assoc < 0)) {
          return b + (position - a);
        }
        a += chunk.length;
        b += chunk.length;
      } else if (op === diff.DELETE) {
        if (position < a + chunk.length) return b;
        a += chunk.length;
      } else {
        if (position === a && assoc < 0) return b;
        b += chunk.length;
      }
    }
    return b + (position - a);
  };
}

/**
 * The index in `text` where `applyFileText(text, previous, next)` would make its first
 * edit, mapped onto the current buffer the same way, without applying anything; `null`
 * when the write changes nothing. An agent parks its cursor here before it writes, so a
 * following editor can scroll there first.
 */
export function fileTextTarget(text: Y.Text, previous: string, next: string): number | null {
  const first = textEdits(previous, next)[0];
  if (!first) return null;
  const current = text.toString();
  return current === previous ? first.from : positionMapper(previous, current)(first.from, 1);
}

export interface FileTextOptions {
  /** Records the write in the document's agent change log, as this author's entry. */
  log?: AgentChangeAuthor;
}

/**
 * Applies `previous` → `next` file text to `text` as one Yjs transaction, mapped onto anything the
 * user typed since the last flush: user edits outside the changed regions survive, those inside a
 * region the write replaced go with it. `options.log` also appends one change-log entry (the ghosts).
 * Returns the index after the last edit (where a writer's cursor belongs), or `null` if none applied.
 */
export function applyFileText(
  text: Y.Text,
  previous: string,
  next: string,
  options: FileTextOptions = {},
): number | null {
  const edits = textEdits(previous, next);
  if (edits.length === 0) return null;

  const current = text.toString();
  const map = current === previous ? null : positionMapper(previous, current);
  const author = options.log;
  const apply = () => {
    const ops: Parameters<typeof recordAgentChange>[3] = [];
    const clock = () => (text.doc ? Y.getState(text.doc.store, text.doc.clientID) : 0);
    // The write's insertions take consecutive clocks from here, one per character.
    const clockFrom = clock();
    // Edits are in ascending order; `shift` tracks how far earlier edits moved later ones.
    let shift = 0;
    let end = 0;
    for (const edit of edits) {
      const start = map ? map(edit.from, 1) : edit.from;
      const stop = Math.max(start, map ? map(edit.to, -1) : edit.to);
      const from = start + shift;
      const to = stop + shift;
      // The deleted text is the buffer's, not the file's: `current` sliced at the mapped
      // range holds whatever the user typed inside it. Where each character came from is
      // read from the items before they go.
      const items = author && to > from ? originRuns(text, from, to) : [];
      if (to > from) text.delete(from, to - from);
      if (edit.insert.length > 0) text.insert(from, edit.insert);
      if (author) {
        ops.push(agentChangeOp(text, from, edit.insert.length, current.slice(start, stop), items));
      }
      shift += edit.insert.length - (to - from);
      end = from + edit.insert.length;
    }
    if (author) recordAgentChange(text, author, { from: clockFrom, to: clock() }, ops);
    return end;
  };

  const doc = text.doc;
  if (!doc) return apply();
  let end = 0;
  doc.transact(() => {
    end = apply();
  });
  return end;
}

import { isolateHistory } from "@codemirror/commands";
import type { ChangeSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type * as Y from "yjs";
import {
  clearAgentDeletion,
  clockRanges,
  hideAgentDeletion,
  removeAgentChanges,
  type AgentChange,
  type AgentChangeOp,
} from "./changeLog.ts";
import { agentChangesConfig, agentLog } from "./changeState.ts";

// The review commands act on the outer view. Every text change is a user edit through
// `view.dispatch`, isolated as its own undo step; log changes go to the Y.Array and reach
// the view through the `agentChanges` plugin.

function entries(view: EditorView): readonly AgentChange[] {
  return agentLog(view.state)?.entries ?? [];
}

function logDoc(view: EditorView): Y.Doc | null {
  return view.state.facet(agentChangesConfig)?.text.doc ?? null;
}

/** Whether an op shows anything: an insertion, or a deletion whose ghost is not dismissed. */
function visible(op: AgentChangeOp) {
  return op.to > op.from || (op.deleted !== "" && !op.dismissed);
}

function moveToChange(view: EditorView, direction: 1 | -1): boolean {
  const starts = [
    ...new Set(entries(view).flatMap((entry) => entry.ops.filter(visible).map((op) => op.from))),
  ];
  if (starts.length === 0) return false;
  starts.sort((a, b) => a - b);
  const head = view.state.selection.main.head;
  const target =
    direction > 0
      ? (starts.find((pos) => pos > head) ?? starts[0])
      : (starts.findLast((pos) => pos < head) ?? starts.at(-1));
  if (target === undefined) return false;
  view.dispatch({
    selection: { anchor: target },
    effects: EditorView.scrollIntoView(target, { y: "center" }),
    userEvent: "select",
  });
  return true;
}

/**
 * Moves the caret to the next entry op after it in document order, wrapping, and scrolls
 * it to the middle of the view. Ops that show nothing (a dismissed or restored deletion)
 * are skipped.
 */
export function nextAgentChange(view: EditorView): boolean {
  return moveToChange(view, 1);
}

/** Moves the caret to the previous entry op before it in document order, wrapping. */
export function previousAgentChange(view: EditorView): boolean {
  return moveToChange(view, -1);
}

/** Accepts entry `id`: the entry and its marks and ghosts go, the text stays. */
export function acceptAgentChange(view: EditorView, id: string): boolean {
  const doc = logDoc(view);
  return doc !== null && removeAgentChanges(doc, (entry) => entry.id === id) > 0;
}

/**
 * Text a revert put back, with its origin before the write deleted it: `[from, to)` now holds
 * `client`'s characters from `clock` on. Restored text is inserted by the user's client, so only this
 * record lets a later revert in the same turn remove an earlier write's characters or find its anchor.
 */
interface Restored {
  from: number;
  to: number;
  client: number;
  clock: number;
}

/** Splits `restored` into the parts `entry`'s write owns and the parts it does not. */
function splitRestored(restored: readonly Restored[], entry: AgentChange) {
  const owned: { from: number; to: number }[] = [];
  const kept: Restored[] = [];
  for (const piece of restored) {
    const length = piece.to - piece.from;
    const from = Math.max(piece.clock, entry.clock.from);
    const to = Math.min(piece.clock + length, entry.clock.to);
    if (piece.client !== entry.client || from >= to) {
      kept.push(piece);
      continue;
    }
    owned.push({ from: piece.from + from - piece.clock, to: piece.from + to - piece.clock });
    if (from > piece.clock) kept.push({ ...piece, to: piece.from + from - piece.clock });
    if (to < piece.clock + length) {
      kept.push({ ...piece, from: piece.from + to - piece.clock, clock: to });
    }
  }
  return { owned, kept };
}

/**
 * Where `op`'s deleted text goes back. Its anchor item may have been deleted by a later
 * write whose revert restored it as new text; Yjs then resolves the anchor to a collapsed
 * point, so the item is looked up in `restored` instead.
 */
function anchorOf(op: AgentChangeOp, restored: readonly Restored[]) {
  const { anchor } = op;
  if (!anchor) return op.from;
  for (const piece of restored) {
    const offset = anchor.clock - piece.clock;
    if (piece.client === anchor.client && offset >= 0 && offset < piece.to - piece.from) {
      return piece.from + offset + (op.assoc < 0 ? 1 : 0);
    }
  }
  return op.from;
}

/**
 * Reverts `entry` in one user edit: deletes its write's inserted items (by client and clock range, so
 * user text and later nested writes inside stay) and the restored text it owned, and puts each op's
 * deleted text back at its anchor, dismissed ones too. Returns the new `restored`: pieces left, mapped,
 * plus every run this revert put back.
 */
function revertEntry(
  view: EditorView,
  text: Y.Text,
  entry: AgentChange,
  restored: readonly Restored[],
) {
  const { owned, kept } = splitRestored(restored, entry);
  const changes: ChangeSpec[] = [...clockRanges(text, entry.client, entry.clock), ...owned];
  const anchors = entry.ops.map((op) => anchorOf(op, restored));
  for (const [i, op] of entry.ops.entries()) {
    if (op.deleted !== "") changes.push({ from: anchors[i] ?? op.from, insert: op.deleted });
  }
  if (changes.length === 0) return kept;
  const tr = view.state.update({
    changes,
    annotations: isolateHistory.of("full"),
    userEvent: "input.revert",
  });
  view.dispatch(tr);
  const next: Restored[] = [];
  for (const piece of kept) {
    const from = tr.changes.mapPos(piece.from, 1);
    const to = tr.changes.mapPos(piece.to, -1);
    if (to > from) next.push({ ...piece, from, to });
  }
  for (const [i, op] of entry.ops.entries()) {
    // The deleted text lands where its anchor was, before anything inserted there.
    const at = tr.changes.mapPos(anchors[i] ?? op.from, -1);
    for (const run of op.items) {
      next.push({
        from: at + run.at,
        to: at + run.at + run.length,
        client: run.client,
        clock: run.clock,
      });
    }
  }
  return next;
}

function userEdit(view: EditorView, changes: ChangeSpec[], userEvent: string) {
  if (changes.length === 0) return;
  view.dispatch({ changes, annotations: isolateHistory.of("full"), userEvent });
}

function revertWithin(view: EditorView, id: string, restored: readonly Restored[]) {
  const config = view.state.facet(agentChangesConfig);
  const entry = entries(view).find((candidate) => candidate.id === id);
  const doc = config?.text.doc;
  if (!config || !doc || !entry) return null;
  const next = revertEntry(view, config.text, entry, restored);
  removeAgentChanges(doc, (stored) => stored.id === id);
  return next;
}

/**
 * Reverts entry `id` in one undo step: removes what its write inserted (except characters
 * the user typed inside, or a later write's) and restores what it deleted, then removes the
 * entry.
 */
export function revertAgentChange(view: EditorView, id: string): boolean {
  return revertWithin(view, id, []) !== null;
}

function deletionOf(view: EditorView, id: string, opIndex: number) {
  const op = entries(view).find((entry) => entry.id === id)?.ops[opIndex];
  return op && op.deleted !== "" ? op : null;
}

/**
 * The ghost's Restore: puts the deleted text back at its anchor as a user edit and clears
 * the op's deletion (the op itself stays, so op indexes never shift).
 */
export function restoreAgentDeletion(view: EditorView, id: string, opIndex: number): boolean {
  const doc = logDoc(view);
  const op = deletionOf(view, id, opIndex);
  if (!doc || !op) return false;
  userEdit(view, [{ from: op.from, insert: op.deleted }], "input.restore");
  return clearAgentDeletion(doc, id, opIndex);
}

/**
 * The ghost's Dismiss: hides the ghost and leaves the text as it is. The deletion stays in
 * the log, so reverting the entry or its turn still restores it; accepting forgets it.
 */
export function dismissAgentDeletion(view: EditorView, id: string, opIndex: number): boolean {
  const doc = logDoc(view);
  return doc !== null && deletionOf(view, id, opIndex) !== null
    ? hideAgentDeletion(doc, id, opIndex)
    : false;
}

/** Accepts every entry of `turnId`. */
export function acceptTurn(view: EditorView, turnId: string): boolean {
  const doc = logDoc(view);
  return doc !== null && removeAgentChanges(doc, (entry) => entry.turnId === turnId) > 0;
}

/**
 * Reverts every entry of `turnId`, newest first, each its own undo step. Ownership carries
 * across the steps: text a later write deleted that an earlier one inserted comes back with
 * the later write's revert and goes again with the earlier one's, so the turn's reversal is
 * exact when its writes overlap.
 */
export function revertTurn(view: EditorView, turnId: string): boolean {
  const ids = entries(view)
    .filter((entry) => entry.turnId === turnId)
    .map((entry) => entry.id)
    .toReversed();
  let restored: readonly Restored[] = [];
  let reverted = false;
  for (const id of ids) {
    const next = revertWithin(view, id, restored);
    if (next === null) continue;
    restored = next;
    reverted = true;
  }
  return reverted;
}

/** The turn ids in the log, oldest first. */
export function agentTurns(view: EditorView): string[] {
  return [...new Set(entries(view).map((entry) => entry.turnId))];
}

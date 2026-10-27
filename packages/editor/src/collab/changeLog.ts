import * as Y from "yjs";
import { safeAgentColor } from "./agentAwareness.ts";

// The agent change log: a `Y.Array` beside the note's text, one plain-object entry per
// agent file write. Only the bridge adds entries (inside the write's own transaction); the
// user removes them by reviewing, and the host clears them when the thread commits.

const LOG_NAME = "agentChanges";

/**
 * Where a run of an op's deleted text came from: `length` characters starting `at` into
 * `deleted` were Yjs items of `client`, the first with clock `clock` (the rest follow).
 */
export interface OriginRun {
  at: number;
  length: number;
  client: number;
  clock: number;
}

/** A Yjs item id: the character a relative position sticks to. */
export interface ItemId {
  client: number;
  clock: number;
}

/** A half-open range of one client's Yjs clock. */
export interface ClockRange {
  from: number;
  to: number;
}

/** One op as stored: Yjs relative positions encoded as plain number arrays. */
interface StoredOp {
  from: number[];
  to: number[];
  /** -1 when the anchor sticks to the character before it (an anchor at the text's end). */
  assoc: 1 | -1;
  deleted: string;
  /** The origin of every character of `deleted`. */
  items: OriginRun[];
  /** The user dismissed the ghost; the deletion stays for a later revert. */
  dismissed: boolean;
}

interface StoredEntry {
  id: string;
  turnId: string;
  client: number;
  name: string;
  color: string;
  at: number;
  /** The writer's clock range spanned by the characters this write inserted. */
  clock: ClockRange;
  ops: StoredOp[];
}

/** Who a logged write belongs to: the agent's turn, name, and colour. */
export interface AgentChangeAuthor {
  turnId: string;
  name: string;
  color: string;
}

/**
 * One op of a write, resolved to indexes in the text: `[from, to)` is what the write
 * inserted (empty when it inserted nothing) and `deleted` is what it removed at `from`.
 * `assoc` is the side the anchor sticks to and `anchor` the item it sticks to (null at an
 * end of the text); `items` holds the origin of every character of `deleted`.
 */
export interface AgentChangeOp {
  from: number;
  to: number;
  assoc: 1 | -1;
  anchor: ItemId | null;
  deleted: string;
  items: OriginRun[];
  dismissed: boolean;
}

/** One agent file write, with its ops resolved against the document as it stands. */
export interface AgentChange {
  id: string;
  turnId: string;
  client: number;
  name: string;
  color: string;
  at: number;
  clock: ClockRange;
  ops: AgentChangeOp[];
}

export function agentChangeLog(doc: Y.Doc): Y.Array<unknown> {
  return doc.getArray<unknown>(LOG_NAME);
}

/** A run of live characters of one item: `[index, index + length)`, clocks from `clock`. */
interface ItemRun {
  index: number;
  length: number;
  client: number;
  clock: number;
}

/**
 * The live characters of `text` in `[from, to)` as runs of Yjs items, each with its client
 * and the clock of its first character. Reads the private item list, as
 * `agentInsertions` does.
 */
function itemRuns(text: Y.Text, from = 0, to = Infinity): ItemRun[] {
  const runs: ItemRun[] = [];
  let index = 0;
  for (let item = text._start; item !== null && index < to; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const start = Math.max(index, from);
    const end = Math.min(index + item.length, to);
    if (start < end) {
      runs.push({
        index: start,
        length: end - start,
        client: item.id.client,
        clock: item.id.clock + (start - index),
      });
    }
    index += item.length;
  }
  return runs;
}

/** The index ranges of `text` holding `client`'s characters with a clock in `clock`. */
export function clockRanges(text: Y.Text, client: number, clock: ClockRange) {
  const ranges: { from: number; to: number }[] = [];
  for (const run of itemRuns(text)) {
    if (run.client !== client) continue;
    const from = Math.max(run.clock, clock.from);
    const to = Math.min(run.clock + run.length, clock.to);
    if (from < to) {
      ranges.push({ from: run.index + (from - run.clock), to: run.index + (to - run.clock) });
    }
  }
  return ranges;
}

function encodePosition(text: Y.Text, index: number, assoc: number): number[] {
  return Array.from(
    Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, index, assoc)),
  );
}

/**
 * The origin of every character in `[from, to)` of `text`, as runs relative to `from`. Call
 * it before deleting that range.
 */
export function originRuns(text: Y.Text, from: number, to: number): OriginRun[] {
  return itemRuns(text, from, to).map((run) => ({
    at: run.index - from,
    length: run.length,
    client: run.client,
    clock: run.clock,
  }));
}

/**
 * The stored op for one applied edit, where `text` already holds it. `from` sticks to the first
 * inserted character (else the one after the deletion) so typing at the anchor lands before it; `to`
 * sticks to the last inserted so typing at its end does not grow it. At the text's very end the anchor
 * sticks to the character before (`assoc` -1), since an end position follows everything appended.
 */
export function agentChangeOp(
  text: Y.Text,
  from: number,
  inserted: number,
  deleted: string,
  items: OriginRun[],
): StoredOp {
  const assoc = inserted === 0 && from > 0 && from === text.length ? -1 : 1;
  const start = encodePosition(text, from, assoc < 0 ? -1 : 0);
  return {
    from: start,
    to: inserted > 0 ? encodePosition(text, from + inserted, -1) : start,
    assoc,
    deleted,
    items,
    dismissed: false,
  };
}

/**
 * Appends one entry for a write; call it inside the write's transaction, after its text
 * changes. `clock` is the writer's clock range its insertions spanned.
 */
export function recordAgentChange(
  text: Y.Text,
  author: AgentChangeAuthor,
  clock: ClockRange,
  ops: StoredOp[],
) {
  const doc = text.doc;
  if (!doc || ops.length === 0) return;
  const client = doc.clientID;
  const entry: StoredEntry = {
    // Every write pushes an entry, which advances the writer's clock, so the clock before
    // the push is unique per write of that client.
    id: `${client}:${Y.getState(doc.store, client)}`,
    turnId: author.turnId,
    client,
    name: author.name,
    color: safeAgentColor(author.color),
    at: Date.now(),
    clock,
    ops,
  };
  agentChangeLog(doc).push([entry]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPosition(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((byte) => Number.isInteger(byte));
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function parseClock(value: unknown): ClockRange | null {
  if (!isRecord(value) || !isCount(value.from) || !isCount(value.to)) return null;
  return value.from <= value.to ? { from: value.from, to: value.to } : null;
}

function parseItems(value: unknown, deleted: string): OriginRun[] | null {
  if (!Array.isArray(value)) return null;
  const runs: OriginRun[] = [];
  for (const run of value) {
    if (!isRecord(run)) return null;
    const { at, length, client, clock } = run;
    if (!isCount(at) || !isCount(length) || !isCount(client) || !isCount(clock)) return null;
    if (at + length > deleted.length) return null;
    runs.push({ at, length, client, clock });
  }
  return runs;
}

// Entries arrive from remote peers, so each is checked before use.
function parseOp(value: unknown): StoredOp | null {
  if (!isRecord(value) || !isPosition(value.from) || !isPosition(value.to)) return null;
  if (typeof value.deleted !== "string") return null;
  const items = parseItems(value.items, value.deleted);
  if (!items) return null;
  return {
    from: value.from,
    to: value.to,
    assoc: value.assoc === -1 ? -1 : 1,
    deleted: value.deleted,
    items,
    dismissed: value.dismissed === true,
  };
}

function parseEntry(value: unknown): StoredEntry | null {
  if (!isRecord(value) || !Array.isArray(value.ops)) return null;
  const { id, turnId, client, name, at } = value;
  const clock = parseClock(value.clock);
  if (typeof id !== "string" || typeof turnId !== "string" || !isCount(client) || !clock) {
    return null;
  }
  const ops: StoredOp[] = [];
  for (const raw of value.ops) {
    const op = parseOp(raw);
    if (!op) return null;
    ops.push(op);
  }
  return {
    id,
    turnId,
    client,
    name: typeof name === "string" ? name : "Agent",
    color: safeAgentColor(value.color),
    at: typeof at === "number" ? at : 0,
    clock,
    ops,
  };
}

interface DecodedOp {
  from: Y.RelativePosition;
  to: Y.RelativePosition;
}

// Stored entries are immutable objects the Y.Array hands back by reference, so their
// decoded positions are cached per object.
const decoded = new WeakMap<object, DecodedOp[] | null>();

function decode(raw: object, entry: StoredEntry): DecodedOp[] | null {
  let ops = decoded.get(raw);
  if (ops !== undefined) return ops;
  try {
    ops = entry.ops.map((op) => ({
      from: Y.decodeRelativePosition(Uint8Array.from(op.from)),
      to: Y.decodeRelativePosition(Uint8Array.from(op.to)),
    }));
  } catch {
    ops = null;
  }
  decoded.set(raw, ops);
  return ops;
}

// A position that decodes but names no item or type (a malformed remote entry) makes Yjs
// throw; such an entry is ignored, never thrown.
function resolve(doc: Y.Doc, position: Y.RelativePosition, text: Y.Text | undefined) {
  try {
    const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc);
    if (!absolute || (text && absolute.type !== text)) return null;
    return absolute.index;
  } catch {
    return null;
  }
}

/**
 * The log's entries in log order (oldest first), each op resolved to indexes. An entry
 * whose positions do not resolve (yet), or that points into another type than `text`, is
 * left out. Indexes are clamped to `length` when given.
 */
export function resolveAgentChanges(doc: Y.Doc, text?: Y.Text, length?: number): AgentChange[] {
  const changes: AgentChange[] = [];
  const clamp = (index: number) => (length === undefined ? index : Math.min(index, length));
  for (const raw of agentChangeLog(doc).toArray()) {
    const entry = parseEntry(raw);
    const positions = entry && isRecord(raw) ? decode(raw, entry) : null;
    if (!entry || !positions) continue;
    const ops: AgentChangeOp[] = [];
    for (const [i, op] of entry.ops.entries()) {
      const position = positions[i];
      if (!position) break;
      const from = resolve(doc, position.from, text);
      const to = resolve(doc, position.to, text);
      if (from === null || to === null) break;
      const item = position.from.item;
      ops.push({
        from: clamp(from),
        to: clamp(Math.max(from, to)),
        assoc: op.assoc,
        anchor: item ? { client: item.client, clock: item.clock } : null,
        deleted: op.deleted,
        items: op.items,
        dismissed: op.dismissed,
      });
    }
    if (ops.length === entry.ops.length) changes.push({ ...entry, ops });
  }
  return changes;
}

/** What a host's chrome reads: every entry of `doc`'s log, resolved to indexes. */
export function readAgentChanges(doc: Y.Doc): AgentChange[] {
  return resolveAgentChanges(doc);
}

/**
 * Calls `listener` with the resolved entries whenever the log changes (not when only the
 * text moves). Returns the function that stops observing.
 */
export function observeAgentChanges(
  doc: Y.Doc,
  listener: (changes: AgentChange[]) => void,
): () => void {
  const log = agentChangeLog(doc);
  const observer = () => listener(readAgentChanges(doc));
  log.observe(observer);
  return () => log.unobserve(observer);
}

/** Removes the entries `match` picks, in one transaction; returns how many. */
export function removeAgentChanges(doc: Y.Doc, match: (entry: StoredEntry) => boolean): number {
  const log = agentChangeLog(doc);
  let removed = 0;
  doc.transact(() => {
    const entries = log.toArray();
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = parseEntry(entries[i]);
      if (entry && match(entry)) {
        log.delete(i, 1);
        removed += 1;
      }
    }
  });
  return removed;
}

/**
 * The host's commit hook: removes every entry, or every entry of `turnId`, without
 * touching the text.
 */
export function clearAgentChanges(doc: Y.Doc, turnId?: string): void {
  removeAgentChanges(doc, (entry) => turnId === undefined || entry.turnId === turnId);
}

function insertedNothing(op: StoredOp) {
  return op.from.length === op.to.length && op.from.every((byte, i) => byte === op.to[i]);
}

/**
 * Rewrites op `opIndex` of entry `id` with `change`, in place: op indexes never shift, so
 * an open popover cannot come to act on another ghost. An entry left with neither an
 * insertion nor a deletion in any op is removed. Returns whether the op had a deletion.
 */
function updateDeletion(
  doc: Y.Doc,
  id: string,
  opIndex: number,
  change: (op: StoredOp) => StoredOp,
): boolean {
  const log = agentChangeLog(doc);
  const entries = log.toArray();
  const index = entries.findIndex((raw) => parseEntry(raw)?.id === id);
  const entry = index < 0 ? null : parseEntry(entries[index]);
  const op = entry?.ops[opIndex];
  if (!entry || !op || op.deleted === "") return false;
  const ops = entry.ops.map((kept, i) => (i === opIndex ? change(kept) : kept));
  const empty = ops.every((kept) => insertedNothing(kept) && kept.deleted === "");
  doc.transact(() => {
    log.delete(index, 1);
    if (!empty) log.insert(index, [{ ...entry, ops }]);
  });
  return true;
}

/** Forgets the deletion of op `opIndex` of entry `id` (its text was put back). */
export function clearAgentDeletion(doc: Y.Doc, id: string, opIndex: number): boolean {
  return updateDeletion(doc, id, opIndex, (op) => ({
    ...op,
    deleted: "",
    items: [],
    dismissed: false,
  }));
}

/** Hides the ghost of op `opIndex` of entry `id`; a revert still restores the deletion. */
export function hideAgentDeletion(doc: Y.Doc, id: string, opIndex: number): boolean {
  return updateDeletion(doc, id, opIndex, (op) => ({ ...op, dismissed: true }));
}

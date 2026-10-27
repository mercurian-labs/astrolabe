/**
 * A thread's record, as the graph plays it back: each turn ends in a
 * checkpoint, and each turn lists what the agent did to the memory, in order.
 * The graph never says more than the record does.
 */
import type { LinkKind, LinkResolution, Memory, NoteKind } from "./memory.ts";

/** Where a codebase's definition sits in its file, 1-based and inclusive. */
export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

export type ThreadEvent =
  /** The agent read a note: it rises into view with its local graph. */
  | { readonly kind: "read"; readonly note: string }
  /**
   * The agent amended a written note: it is marked. A `name`, `group`,
   * `noteKind`, or `parent` given relabels or regroups it. (The note's kind is
   * `noteKind`: `kind` is the event's own.)
   */
  | {
      readonly kind: "amend";
      readonly note: string;
      readonly name?: string;
      readonly group?: string;
      /** The note's kind, in a codebase. An amend of a file or folder is never emitted. */
      readonly noteKind?: NoteKind;
      readonly parent?: string;
      /** In a codebase: the definition's lines after the amend. */
      readonly range?: LineRange;
      /** In a codebase: the symbol's declaration line after the amend. */
      readonly signature?: string;
      /** In a codebase: the symbol's doc comment after the amend. */
      readonly doc?: string;
    }
  /**
   * The agent wrote a note for the first time; a red link of that name turns written. `name`,
   * `group`, `parent`, and `noteKind` are here because a note the memory lacks has no other source
   * for them. Writing a container (a new file or folder) is an event too.
   */
  | {
      readonly kind: "write";
      readonly note: string;
      readonly name?: string;
      readonly group?: string;
      readonly noteKind?: NoteKind;
      readonly parent?: string;
      /** In a codebase: the definition's lines. */
      readonly range?: LineRange;
      /** In a codebase: the symbol's declaration line. */
      readonly signature?: string;
      /** In a codebase: the symbol's doc comment. */
      readonly doc?: string;
    }
  /**
   * The agent added a wikilink. A target no note holds is a red link the agent
   * reached toward, and appears as a frontier node. In a codebase the link
   * means `linkKind`. Containment never produces a link.
   */
  | {
      readonly kind: "link";
      readonly from: string;
      readonly to: string;
      readonly linkKind?: LinkKind;
      /** In a codebase: how surely the link was resolved to its target. */
      readonly resolution?: LinkResolution;
    }
  /** The agent removed a wikilink: it draws broken where it stood. */
  | {
      readonly kind: "unlink";
      readonly from: string;
      readonly to: string;
      readonly linkKind?: LinkKind;
      /** In a codebase: how surely the removed link had been resolved. */
      readonly resolution?: LinkResolution;
    }
  /**
   * A standing link was resolved anew (a same-named definition appeared or
   * went): only its resolution changes. Not a move: no play, no mark, no
   * story. A record may say it directly; a `link` event for a link that
   * already stands means the same, and `resolveRelinks` rewrites it so.
   */
  | {
      readonly kind: "resolve";
      readonly from: string;
      readonly to: string;
      readonly linkKind?: LinkKind;
      readonly resolution?: LinkResolution;
    };

/** Whether an event is one of the turn's moves (a play): every event but a re-resolution. */
export const isMove = (event: ThreadEvent) => event.kind !== "resolve";

export interface ThreadTurn {
  readonly id: string;
  /** What the person asked, shortened: the checkpoint's label. */
  readonly label: string;
  readonly events: ReadonlyArray<ThreadEvent>;
}

export interface ThreadRecord {
  readonly id: string;
  readonly title: string;
  /** The memory the thread's branch started from. */
  readonly memoryId: string;
  readonly turns: ReadonlyArray<ThreadTurn>;
}

/**
 * Where a codebase's note was last written or amended by the end of turn
 * `checkpoint`: its file (the event's group) and its lines, when the record
 * says. Null when no turn so far touched it with either.
 */
export function noteSource(
  thread: ThreadRecord,
  checkpoint: number,
  note: string,
): { readonly path: string; readonly range: LineRange | null } | null {
  for (let turn = Math.min(checkpoint, thread.turns.length - 1); turn >= 0; turn -= 1) {
    const events = thread.turns[turn]?.events ?? [];
    for (let at = events.length - 1; at >= 0; at -= 1) {
      const event = events[at];
      if (event === undefined || (event.kind !== "write" && event.kind !== "amend")) continue;
      if (event.note !== note || event.group === undefined) continue;
      return { path: event.group, range: event.range ?? null };
    }
  }
  return null;
}

/**
 * A codebase symbol's latest `signature` or `doc` by the end of turn
 * `checkpoint`, from the last write or amend that gave one; undefined when
 * none did (the memory's own note may still carry it).
 */
export function noteText(
  thread: ThreadRecord,
  checkpoint: number,
  note: string,
  field: "signature" | "doc",
): string | undefined {
  for (let turn = Math.min(checkpoint, thread.turns.length - 1); turn >= 0; turn -= 1) {
    const events = thread.turns[turn]?.events ?? [];
    for (let at = events.length - 1; at >= 0; at -= 1) {
      const event = events[at];
      if (event === undefined || (event.kind !== "write" && event.kind !== "amend")) continue;
      if (event.note === note && event[field] !== undefined) return event[field];
    }
  }
  return undefined;
}

/** A doc comment's first paragraph, on one line. */
export const firstParagraph = (doc: string) =>
  (doc.trim().split(/\n\s*\n/)[0] ?? "").replace(/\s+/g, " ").trim();

/**
 * `thread` with each `link` event for an already-standing link (same ends and kind) rewritten as
 * the `resolve` it is. Standing follows the memory's links, then each link and unlink in order (an
 * unlink with no kind removes every kind). Returns `thread` itself when nothing is rewritten.
 */
export function resolveRelinks(memory: Memory, thread: ThreadRecord): ThreadRecord {
  const key = (from: string, to: string, kind: string | undefined) =>
    `${from}\u0000${to}\u0000${kind ?? ""}`;
  const standing = new Set(memory.links.map((link) => key(link.from, link.to, link.kind)));
  const kindsOf = new Map<string, Set<string>>();
  const way = (from: string, to: string) => `${from}\u0000${to}`;
  const remember = (from: string, to: string, kind: string | undefined) => {
    const set = kindsOf.get(way(from, to)) ?? new Set<string>();
    set.add(kind ?? "");
    kindsOf.set(way(from, to), set);
  };
  for (const link of memory.links) remember(link.from, link.to, link.kind);
  let rewritten = false;
  const turns = thread.turns.map((turn) => {
    let changed = false;
    const events = turn.events.map((event): ThreadEvent => {
      if (event.kind === "link") {
        const at = key(event.from, event.to, event.linkKind);
        if (standing.has(at)) {
          changed = true;
          return {
            kind: "resolve",
            from: event.from,
            to: event.to,
            ...(event.linkKind === undefined ? {} : { linkKind: event.linkKind }),
            ...(event.resolution === undefined ? {} : { resolution: event.resolution }),
          };
        }
        standing.add(at);
        remember(event.from, event.to, event.linkKind);
      } else if (event.kind === "unlink") {
        const kinds =
          event.linkKind === undefined
            ? [...(kindsOf.get(way(event.from, event.to)) ?? [""])]
            : [event.linkKind];
        for (const kind of kinds) standing.delete(key(event.from, event.to, kind));
      }
      return event;
    });
    if (!changed) return turn;
    rewritten = true;
    return { ...turn, events };
  });
  return rewritten ? { ...thread, turns } : thread;
}

/** What an event does and to what, for comparing two tellings of one turn. */
const eventKey = (event: ThreadEvent) =>
  event.kind === "read" || event.kind === "amend" || event.kind === "write"
    ? `${event.kind}\u0000${event.note}`
    : `${event.kind}\u0000${event.from}\u0000${event.to}`;

/**
 * Whether `next` is `previous` grown: every event `previous` had, in order,
 * then more (or the same). A working turn grows as the agent writes; a turn
 * that rewrote its past (or another turn) did not grow.
 */
export function turnGrew(previous: ThreadTurn | undefined, next: ThreadTurn | undefined): boolean {
  if (previous === undefined || next === undefined) return false;
  if (next.events.length < previous.events.length) return false;
  return previous.events.every((event, at) => {
    const other = next.events[at];
    return other !== undefined && eventKey(other) === eventKey(event);
  });
}

/**
 * The thread's reading at a checkpoint, derived from the record up to it.
 * Nothing is stored per checkpoint: stepping to any checkpoint replays the
 * turns before it, and only what they changed.
 *
 * At checkpoint `k` (the end of turn `k`):
 * - the memory is the starting memory with turns `0..k` applied: written notes,
 *   filled red links, added and removed links, and red links reached toward;
 * - `now` holds the notes turn `k` touched, `earlier` the notes earlier turns
 *   touched, and `around` their neighbors within `depth` links, receded;
 * - marks say what the thread did: new and amended notes, new and broken links.
 *
 * The memory at `k` is an overlay over one index of everything the thread ever
 * holds (built once per memory and thread): the notes not written yet and the
 * links not standing yet, or no longer, are hidden from it. A step costs the
 * turns' events and the links they touch, never the size of the memory.
 */
import {
  indexMemory,
  localGraph,
  neighborsOf,
  overlayIndex,
  pairKey,
  type Memory,
  type MemoryIndex,
  type LinkResolution,
  type MemoryLink,
  type MemoryNote,
  type NoteKind,
} from "./memory.ts";
import type { ThreadRecord } from "./thread.ts";

export type NoteMark = "new" | "amended";
export type LinkMark = "new" | "broken";

export interface Reading {
  readonly checkpoint: number;
  /** The memory as the thread's branch had it at this checkpoint. */
  readonly state: MemoryIndex;
  readonly now: ReadonlySet<string>;
  readonly earlier: ReadonlySet<string>;
  readonly around: ReadonlySet<string>;
  /** Each marked note with the turn that last marked it. */
  readonly noteMarks: ReadonlyMap<string, { readonly mark: NoteMark; readonly turn: number }>;
  /**
   * Each marked pair, by `pairKey`, with the turn that last marked it and the
   * way it went; `both` when that turn added the link both ways.
   */
  readonly linkMarks: ReadonlyMap<
    string,
    {
      readonly mark: LinkMark;
      readonly turn: number;
      readonly from: string;
      readonly to: string;
      readonly both: boolean;
    }
  >;
  /** Whether `link` (its ends and its kind) stands at this checkpoint: a pair can hold several kinds. */
  readonly linkStands: (link: MemoryLink) => boolean;
  /** How surely `link` is resolved at this checkpoint: re-resolutions replayed up to it. */
  readonly linkResolution: (link: MemoryLink) => LinkResolution | undefined;
}

export interface ReadingOptions {
  /** How far each worked note's neighborhood reaches; one link by default. */
  readonly depth: number;
  /** Narrow the reading to the checkpoint's own turn. */
  readonly thisTurnOnly: boolean;
}

interface LinkMarkEntry {
  mark: LinkMark;
  turn: number;
  from: string;
  to: string;
  both: boolean;
}

interface Replay {
  /** The version at the checkpoint of every note the turns wrote or first named. */
  readonly notes: Map<string, MemoryNote>;
  /** Every link (by `linkKey`) the turns touched: the link if it stands at the checkpoint, else null. */
  readonly links: Map<string, MemoryLink | null>;
  readonly touched: Array<Set<string>>;
  readonly noteMarks: Map<string, { mark: NoteMark; turn: number }>;
  readonly linkMarks: Map<string, LinkMarkEntry>;
}

/** A link by its ends and kind: `calls` and `references` from A to B are two links. */
const linkKey = (from: string, to: string, kind = "") => `${from}\u0000${to}\u0000${kind}`;
/** A directed connection, whatever its kinds. */
const wayKey = (from: string, to: string) => `${from}\u0000${to}`;

/** The kinds each directed connection ever has, by `wayKey`, from the memory and the record. */
type KindsByWay = ReadonlyMap<string, ReadonlySet<string>>;

function kindsByWay(memory: Memory, thread: ThreadRecord): Map<string, Set<string>> {
  const kinds = new Map<string, Set<string>>();
  const add = (from: string, to: string, kind = "") => {
    const key = wayKey(from, to);
    const set = kinds.get(key) ?? new Set<string>();
    set.add(kind);
    kinds.set(key, set);
  };
  for (const link of memory.links) add(link.from, link.to, link.kind);
  for (const turn of thread.turns) {
    for (const event of turn.events) {
      if (event.kind === "link" || event.kind === "unlink" || event.kind === "resolve")
        add(event.from, event.to, event.linkKind);
    }
  }
  return kinds;
}

/** The label and layout group a write or amend gives its note, when the record names them. */
/** What a write or amend says about its note: its name, layout group, kind, and container. */
const named = (event: {
  readonly name?: string;
  readonly group?: string;
  readonly noteKind?: NoteKind;
  readonly parent?: string;
}) => ({
  ...(event.name === undefined ? {} : { name: event.name }),
  ...(event.group === undefined ? {} : { group: event.group }),
  ...(event.noteKind === undefined ? {} : { kind: event.noteKind }),
  ...(event.parent === undefined ? {} : { parent: event.parent }),
});

/** What a thread starts from, gathered once: every reading overlays it. */
interface ThreadBase {
  /** Every note and link the thread ever holds, removed links included. */
  readonly universe: Memory;
  readonly final: MemoryIndex;
  /** Notes the starting memory lacks: each exists from the turn that first names it. */
  readonly created: ReadonlySet<string>;
  /** The starting memory's own version of each of its notes the thread touches. */
  readonly startNotes: ReadonlyMap<string, MemoryNote>;
  /** Every link (every kind, both ways of every pair) the thread touches, by `linkKey`. */
  readonly touchedLinks: ReadonlySet<string>;
  /** Every directed connection the thread touches, by `wayKey`. */
  readonly touchedWays: ReadonlySet<string>;
  readonly kinds: KindsByWay;
  /** Of those, the ones the starting memory holds. */
  readonly startLinks: ReadonlySet<string>;
  /** The starting memory's resolution of each of its links, by `linkKey`. */
  readonly startResolution: ReadonlyMap<string, LinkResolution | undefined>;
}

const threadBases = new WeakMap<Memory, WeakMap<ThreadRecord, ThreadBase>>();

/** The thread's base, built once per memory and thread: the only pass over the whole memory. */
function threadBase(memory: Memory, thread: ThreadRecord): ThreadBase {
  let byThread = threadBases.get(memory);
  if (byThread === undefined) {
    byThread = new WeakMap();
    threadBases.set(memory, byThread);
  }
  const cached = byThread.get(thread);
  if (cached !== undefined) return cached;
  // Which notes and links the thread touches at all.
  const kinds = kindsByWay(memory, thread);
  const touchedNotes = new Set<string>();
  const touchedLinks = new Set<string>();
  const touchedWays = new Set<string>();
  for (const turn of thread.turns) {
    for (const event of turn.events) {
      if (event.kind === "link" || event.kind === "unlink" || event.kind === "resolve") {
        touchedNotes.add(event.from);
        touchedNotes.add(event.to);
        for (const [from, to] of [
          [event.from, event.to],
          [event.to, event.from],
        ] as const) {
          touchedWays.add(wayKey(from, to));
          for (const kind of kinds.get(wayKey(from, to)) ?? [])
            touchedLinks.add(linkKey(from, to, kind));
        }
      } else touchedNotes.add(event.note);
    }
  }
  const startIds = new Set<string>();
  const startNotes = new Map<string, MemoryNote>();
  for (const note of memory.notes) {
    startIds.add(note.id);
    if (touchedNotes.has(note.id) && !startNotes.has(note.id)) startNotes.set(note.id, note);
  }
  const startLinks = new Set<string>();
  for (const link of memory.links) {
    const key = linkKey(link.from, link.to, link.kind);
    if (touchedLinks.has(key)) startLinks.add(key);
  }
  const created = new Set([...touchedNotes].filter((id) => !startIds.has(id)));
  // The whole record replayed once: the last version of every note, and every link that ever stood.
  const whole = replay(
    { startNotes, startLinks, created, kinds, exists: (id) => startIds.has(id) },
    thread,
    thread.turns.length - 1,
  );
  const notes = new Map(memory.notes.map((note) => [note.id, note]));
  for (const [id, note] of whole.notes) notes.set(id, note);
  const everLinks = new Map(
    memory.links.map((link) => [linkKey(link.from, link.to, link.kind), link]),
  );
  for (const [key, link] of whole.ever) everLinks.set(key, link);
  const universe = { ...memory, notes: [...notes.values()], links: [...everLinks.values()] };
  const base = {
    universe,
    final: indexMemory(universe.notes, universe.links),
    created,
    startNotes,
    touchedLinks,
    touchedWays,
    kinds,
    startLinks,
    startResolution: new Map(
      memory.links.map((link) => [linkKey(link.from, link.to, link.kind), link.resolution]),
    ),
  };
  byThread.set(thread, base);
  return base;
}

interface ReplayStart {
  readonly startNotes: ReadonlyMap<string, MemoryNote>;
  readonly startLinks: ReadonlySet<string>;
  readonly created: ReadonlySet<string>;
  readonly kinds: KindsByWay;
  /** Whether a note the thread does not touch exists (it always does, from the start). */
  readonly exists: (id: string) => boolean;
}

/** Apply turns `0..last` to the starting memory, keeping only what they change. */
function replay(
  start: ReplayStart,
  thread: ThreadRecord,
  last: number,
): Replay & { readonly ever: Map<string, MemoryLink> } {
  const notes = new Map<string, MemoryNote>();
  const links = new Map<string, MemoryLink | null>();
  const ever = new Map<string, MemoryLink>();
  const touched: Array<Set<string>> = [];
  const noteMarks = new Map<string, { mark: NoteMark; turn: number }>();
  const linkMarks = new Map<string, LinkMarkEntry>();
  const exists = (id: string) =>
    notes.has(id) || (!start.created.has(id) && (start.startNotes.has(id) || start.exists(id)));
  const noteOf = (id: string) => notes.get(id) ?? start.startNotes.get(id);
  const ensure = (id: string) => {
    if (!exists(id)) notes.set(id, { id, name: id, frontier: true });
  };
  const stands = (key: string) => {
    const link = links.get(key);
    return link === undefined ? start.startLinks.has(key) : link !== null;
  };
  const kindsOf = (from: string, to: string) => start.kinds.get(wayKey(from, to)) ?? new Set([""]);
  // A directed connection stands while any of its kinds does.
  const standsWay = (from: string, to: string) =>
    [...kindsOf(from, to)].some((kind) => stands(linkKey(from, to, kind)));
  const hasPair = (a: string, b: string) => standsWay(a, b) || standsWay(b, a);

  thread.turns.slice(0, last + 1).forEach((turn, index) => {
    const worked = new Set<string>();
    // What each link this turn changes looked like before it, so a link the turn
    // adds and then removes again leaves the pair as the turn found it.
    const standingBefore = new Map<string, boolean>();
    const before = (key: string) => {
      if (!standingBefore.has(key)) standingBefore.set(key, stands(key));
    };
    const stoodBefore = (key: string) => standingBefore.get(key) ?? stands(key);
    const stoodWayBefore = (from: string, to: string) =>
      [...kindsOf(from, to)].some((kind) => stoodBefore(linkKey(from, to, kind)));
    const marksBefore = new Map<string, LinkMarkEntry | undefined>();
    const remember = (key: string) => {
      if (!marksBefore.has(key)) marksBefore.set(key, linkMarks.get(key));
    };
    for (const event of turn.events) {
      switch (event.kind) {
        case "read":
          ensure(event.note);
          worked.add(event.note);
          break;
        case "amend":
          ensure(event.note);
          if (
            event.name !== undefined ||
            event.group !== undefined ||
            event.noteKind !== undefined ||
            event.parent !== undefined
          ) {
            const note = noteOf(event.note);
            if (note !== undefined) notes.set(event.note, { ...note, ...named(event) });
          }
          worked.add(event.note);
          {
            // A note written and amended in the same turn is still that turn's new note;
            // written in an earlier turn, it is this turn's amendment.
            const mark = noteMarks.get(event.note);
            if (mark?.mark !== "new" || mark.turn !== index) {
              noteMarks.set(event.note, { mark: "amended", turn: index });
            }
          }
          break;
        case "write": {
          const existing = noteOf(event.note);
          // A red link of the same name turns written where it stands.
          notes.set(event.note, {
            ...existing,
            id: event.note,
            name: event.note,
            ...named(event),
            frontier: false,
          });
          worked.add(event.note);
          noteMarks.set(event.note, { mark: "new", turn: index });
          break;
        }
        case "resolve":
        case "link": {
          if (event.from === event.to) break;
          // A link that already stands, linked again, is re-resolved: only its
          // resolution changes. No mark, no work, nothing new for the story.
          const standing = linkKey(event.from, event.to, event.linkKind);
          if (event.kind === "resolve" || stands(standing)) {
            if (!stands(standing)) break;
            const resolved: MemoryLink = {
              from: event.from,
              to: event.to,
              ...(event.linkKind === undefined ? {} : { kind: event.linkKind }),
              ...(event.resolution === undefined ? {} : { resolution: event.resolution }),
            };
            links.set(standing, resolved);
            ever.set(standing, resolved);
            break;
          }
          ensure(event.from);
          ensure(event.to);
          worked.add(event.from);
          worked.add(event.to);
          const key = linkKey(event.from, event.to, event.linkKind);
          before(key);
          const link: MemoryLink = {
            from: event.from,
            to: event.to,
            ...(event.linkKind === undefined ? {} : { kind: event.linkKind }),
            ...(event.resolution === undefined ? {} : { resolution: event.resolution }),
          };
          links.set(key, link);
          ever.set(key, link);
          {
            // The same turn linking the pair the other way too makes it new both ways.
            remember(pairKey(event.from, event.to));
            const prior = linkMarks.get(pairKey(event.from, event.to));
            const sameTurn = prior?.mark === "new" && prior.turn === index;
            linkMarks.set(pairKey(event.from, event.to), {
              mark: "new",
              turn: index,
              from: event.from,
              to: event.to,
              both: sameTurn && (prior.both || prior.from !== event.from),
            });
          }
          break;
        }
        case "unlink": {
          worked.add(event.from);
          worked.add(event.to);
          // A kind's unlink removes that kind; one naming no kind removes the connection.
          const removed =
            event.linkKind === undefined ? [...kindsOf(event.from, event.to)] : [event.linkKind];
          for (const kind of removed) {
            const linkAt = linkKey(event.from, event.to, kind);
            before(linkAt);
            links.set(linkAt, null);
          }
          const key = pairKey(event.from, event.to);
          remember(key);
          const mark = linkMarks.get(key);
          if (mark?.mark === "new" && mark.turn === index) {
            // The turn takes back a way it added: the ways it added that still
            // stand stay new, and only those.
            const added = mark.both
              ? [
                  [mark.from, mark.to],
                  [mark.to, mark.from],
                ]
              : [[mark.from, mark.to]];
            const standing = added.filter(([from = "", to = ""]) => standsWay(from, to));
            const [from, to] = standing[0] ?? [];
            if (from !== undefined && to !== undefined) {
              linkMarks.set(key, { mark: "new", turn: index, from, to, both: standing.length > 1 });
              break;
            }
          }
          const wasLinked =
            stoodWayBefore(event.from, event.to) || stoodWayBefore(event.to, event.from);
          if (hasPair(event.from, event.to) || !wasLinked) {
            // Still linked the other way (not broken, only one-way now), or a link this
            // turn added and took back: the pair keeps the mark it had before the turn.
            const beforeMark = marksBefore.get(key);
            if (mark?.turn === index) {
              if (beforeMark === undefined) linkMarks.delete(key);
              else linkMarks.set(key, beforeMark);
            }
          } else {
            linkMarks.set(key, {
              mark: "broken",
              turn: index,
              from: event.from,
              to: event.to,
              both: false,
            });
          }
          break;
        }
      }
    }
    touched.push(new Set([...worked].filter((id) => exists(id))));
  });
  return { notes, links, ever, touched, noteMarks, linkMarks };
}

/**
 * The memory at a checkpoint: the thread's whole index with the notes not yet
 * written hidden, each note the thread touched at its version then, and the
 * links the thread touched that do not stand then hidden.
 */
function stateAt(base: ThreadBase, replayed: Replay): MemoryIndex {
  const hiddenNotes = new Set([...base.created].filter((id) => !replayed.notes.has(id)));
  const notes = new Map<string, MemoryNote>();
  for (const [id, note] of base.startNotes) notes.set(id, replayed.notes.get(id) ?? note);
  for (const [id, note] of replayed.notes) notes.set(id, note);
  const hiddenLinks: Array<MemoryLink> = [];
  // Every connection the thread touches, hidden unless one of its kinds stands
  // at the checkpoint (a link only a later turn touches stands as it started).
  for (const way of base.touchedWays) {
    const [from = "", to = ""] = way.split("\u0000");
    if (linkStandsIn(base, replayed, from, to)) continue;
    if (base.final.outgoing.get(from)?.has(to) === true) hiddenLinks.push({ from, to });
  }
  return overlayIndex(base.final, { hiddenNotes, notes, hiddenLinks });
}

/** Whether the connection from → to stands in `replayed`, in kind `kind` or (no kind given) in any. */
function linkStandsIn(
  base: ThreadBase,
  replayed: Replay,
  from: string,
  to: string,
  kind?: string,
): boolean {
  const kinds = kind === undefined ? (base.kinds.get(wayKey(from, to)) ?? [""]) : [kind];
  for (const each of kinds) {
    const key = linkKey(from, to, each);
    const link = replayed.links.get(key);
    if (
      link === undefined ? base.startLinks.has(key) || !base.touchedLinks.has(key) : link !== null
    ) {
      return true;
    }
  }
  return false;
}

/** The memory after the thread's first `turns` turns (0: the starting memory), as an overlay. */
export function memoryAt(memory: Memory, thread: ThreadRecord, turns: number): MemoryIndex {
  const base = threadBase(memory, thread);
  return stateAt(base, replay(startOf(base), thread, Math.min(turns, thread.turns.length) - 1));
}

const startOf = (base: ThreadBase): ReplayStart => ({
  startNotes: base.startNotes,
  startLinks: base.startLinks,
  created: base.created,
  kinds: base.kinds,
  exists: (id) => base.final.byId.has(id),
});

/** The reading at checkpoint `checkpoint`, clamped to the record. */
export function readingAt(
  memory: Memory,
  thread: ThreadRecord,
  checkpoint: number,
  options: ReadingOptions,
): Reading {
  const last = Math.max(0, Math.min(checkpoint, thread.turns.length - 1));
  const base = threadBase(memory, thread);
  const replayed = replay(startOf(base), thread, last);
  const { touched, noteMarks, linkMarks } = replayed;
  const state = stateAt(base, replayed);
  const now = touched[last] ?? new Set<string>();
  const earlier = new Set<string>();
  if (!options.thisTurnOnly) {
    for (const turn of touched.slice(0, last)) {
      for (const id of turn) if (!now.has(id)) earlier.add(id);
    }
  }
  const worked = new Set([...now, ...earlier]);
  // A broken link's ends still neighbor each other in the reading, so its
  // far note stays in view where the link stood.
  const brokenNeighbors = new Map<string, Array<string>>();
  for (const mark of linkMarks.values()) {
    if (mark.mark !== "broken") continue;
    if (options.thisTurnOnly && mark.turn !== last) continue;
    brokenNeighbors.set(mark.from, [...(brokenNeighbors.get(mark.from) ?? []), mark.to]);
    brokenNeighbors.set(mark.to, [...(brokenNeighbors.get(mark.to) ?? []), mark.from]);
  }
  const reached = localGraph(
    (id) => [...neighborsOf(state, id), ...(brokenNeighbors.get(id) ?? [])],
    worked,
    options.depth,
  );
  const around = new Set([...reached].filter((id) => !worked.has(id)));

  const inTurn = <Mark extends { turn: number }>(marks: Map<string, Mark>) =>
    options.thisTurnOnly
      ? new Map([...marks].filter(([, mark]) => mark.turn === last))
      : new Map(marks);
  return {
    checkpoint: last,
    state,
    now,
    earlier,
    around,
    noteMarks: inTurn(noteMarks),
    linkMarks: inTurn(linkMarks),
    linkStands: (link) =>
      state.outgoing.get(link.from)?.has(link.to) === true &&
      linkStandsIn(base, replayed, link.from, link.to, link.kind ?? ""),
    linkResolution: (link) => {
      const key = linkKey(link.from, link.to, link.kind);
      const now = replayed.links.get(key);
      if (now !== undefined && now !== null) return now.resolution;
      return base.startResolution.has(key) ? base.startResolution.get(key) : link.resolution;
    },
  };
}

/**
 * Every note and link the thread ever holds, broken links included, so the
 * layout can place them all once and never reshuffle between checkpoints.
 */
export function threadUniverse(memory: Memory, thread: ThreadRecord): Memory {
  return threadBase(memory, thread).universe;
}

/** The index of `threadUniverse`, built once and shared with every reading of the thread. */
export function threadIndex(memory: Memory, thread: ThreadRecord): MemoryIndex {
  return threadBase(memory, thread).final;
}

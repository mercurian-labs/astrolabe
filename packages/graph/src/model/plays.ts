/**
 * A checkpoint's play-by-play: the moves its turn made, in order, in plain
 * words. Nothing new is stored; the plays are the turn's events read aloud.
 * A selected play becomes the graph's story: its notes, and its link if it
 * has one, are what the graph shows in front.
 */
import { pairKey, type Memory, type MemoryNote, type NoteKind } from "./memory.ts";
import { kindGlyph } from "./kinds.ts";
import { edgeBetween } from "./level.ts";
import { memoryAt } from "./reading.ts";
import type { ThreadEvent, ThreadRecord, ThreadTurn } from "./thread.ts";
import type { Universe } from "./universe.ts";
import { EdgeDirection, EdgeKind, VERB_GLYPH, type GraphView, type ReadingView } from "./view.ts";

export interface Play {
  /** The turn's id and the play's place in it: stable for as long as the record is. */
  readonly id: string;
  /** A `resolve` is not a move: it has no row, no gesture, no story (see `isMove`). */
  readonly kind: "read" | "amend" | "write" | "link" | "reach" | "unlink" | "resolve";
  /** A verb phrase in plain words: "linked PR Review to Merges". */
  readonly text: string;
  /** The note ids the play involves: one, or a link's two ends (from, then to). */
  readonly notes: ReadonlyArray<string>;
  /** What the play did to its note, as a glyph before its name: "+" wrote, "~" amended, "×" removed; "" otherwise. */
  readonly glyph: string;
}

/**
 * The plays of `turn` that remove a note, by their place in the turn: for
 * each note the record lists as removed (`removed`) that has no link left
 * after the turn (`degreeAfter`), the turn's last unlink touching it. No
 * event says "removed" yet; a code story lists the symbols it removed.
 */
export function removalsIn(
  turn: ThreadTurn,
  removed: ReadonlySet<string>,
  degreeAfter: (id: string) => number,
): Map<number, string> {
  const last = new Map<string, number>();
  turn.events.forEach((event, index) => {
    if (event.kind !== "unlink") return;
    for (const id of [event.from, event.to]) if (removed.has(id)) last.set(id, index);
  });
  const removals = new Map<number, string>();
  for (const [id, index] of last) if (degreeAfter(id) === 0) removals.set(index, id);
  return removals;
}

/** The removals of the turn ending at `checkpoint` (see `removalsIn`), against the memory after it. */
export function removalsAt(
  memory: Memory,
  thread: ThreadRecord,
  checkpoint: number,
  removed: ReadonlyArray<string>,
): Map<number, string> {
  const turn = thread.turns[checkpoint];
  if (turn === undefined || removed.length === 0) return new Map();
  const after = memoryAt(memory, thread, checkpoint + 1);
  return removalsIn(turn, new Set(removed), (id) => after.degree.get(id) ?? 0);
}

const NO_REMOVALS: ReadonlyMap<number, string> = new Map();

/** Notes by id: a memory's notes, as a map or an index's `byId`, looked up one at a time. */
export interface NoteLookup {
  get(id: string): MemoryNote | undefined;
}

/**
 * The plays of a turn, one per event, in order. `notes` holds the notes as
 * they stood before the turn; a note the turn writes counts as written for the
 * plays after it. A link to a note nobody has written is a reach toward a red
 * link. A note is named as the turn leaves it: the name a write or amend of
 * the turn gives it, else its name before the turn, else its id. Only the
 * turn's own notes are looked up.
 */
export function describePlays(
  turn: ThreadTurn,
  notes: NoteLookup,
  removals: ReadonlyMap<number, string> = NO_REMOVALS,
): Array<Play> {
  const writtenNow = new Set<string>();
  const written = (id: string) => writtenNow.has(id) || notes.get(id)?.frontier === false;
  // A note the turn writes did not exist before it: its name is the one the turn gives.
  const namedNow = new Map<string, string>();
  for (const event of turn.events) {
    if ((event.kind === "write" || event.kind === "amend") && event.name !== undefined) {
      namedNow.set(event.note, event.name);
    }
  }
  const name = (id: string) => namedNow.get(id) ?? notes.get(id)?.name ?? id;
  const describe = (event: ThreadEvent): Omit<Play, "id" | "glyph"> => {
    switch (event.kind) {
      case "read":
        return { kind: "read", text: `read ${name(event.note)}`, notes: [event.note] };
      case "amend":
        return { kind: "amend", text: `amended ${name(event.note)}`, notes: [event.note] };
      case "write":
        writtenNow.add(event.note);
        return { kind: "write", text: `wrote ${name(event.note)}`, notes: [event.note] };
      case "link":
        return written(event.to)
          ? {
              kind: "link",
              text: `linked ${name(event.from)} to ${name(event.to)}`,
              notes: [event.from, event.to],
            }
          : {
              kind: "reach",
              text: `reached toward ${name(event.to)} from ${name(event.from)}`,
              notes: [event.from, event.to],
            };
      case "unlink":
        return {
          kind: "unlink",
          text: `unlinked ${name(event.to)} from ${name(event.from)}`,
          notes: [event.from, event.to],
        };
      case "resolve":
        return {
          kind: "resolve",
          text: `re-resolved ${name(event.from)} to ${name(event.to)}`,
          notes: [event.from, event.to],
        };
    }
  };
  return turn.events.map((event, index) => {
    const play = describe(event);
    const glyph = removals.has(index)
      ? VERB_GLYPH.remove
      : play.kind === "write"
        ? VERB_GLYPH.write
        : play.kind === "amend"
          ? VERB_GLYPH.amend
          : "";
    return { id: `${turn.id}:${index}`, ...play, glyph };
  });
}

/** A note kind that holds others in a codebase: a play tree groups plays under the nearest one. */
const CONTAINER_KINDS: ReadonlySet<NoteKind> = new Set(["file", "package", "folder"]);

/** A link play under its source symbol: "→ playEdge (calls)". */
export interface PlayLeaf {
  /** The play's place in the turn. */
  readonly play: number;
  readonly kind: Play["kind"];
  readonly text: string;
  /** "×" when the unlink removed its note; else "". */
  readonly glyph: string;
}

/** A symbol and its moves ("wrote choosePlay"), with the links it made below it. */
export interface PlaySymbol {
  readonly note: string;
  readonly text: string;
  /** What its moves did to it: "+" when it was written, else "~" when amended, else "". */
  readonly glyph: string;
  /** Its kind, as its shape's glyph ("◆" for an interface); "" when it has none. */
  readonly kindGlyph: string;
  /** What selecting the row selects: its own moves, or its links when it made no other move. */
  readonly pick: PlayPick;
  readonly links: ReadonlyArray<PlayLeaf>;
}

/**
 * Whether a file row shows its symbols: opened by hand, holding a chosen play,
 * or holding the play the agent's cursor is telling, so the row expands while
 * the cursor is inside the file and folds again when it leaves.
 */
export function fileOpen(
  group: Pick<PlayGroup, "note" | "plays">,
  opened: ReadonlySet<string>,
  chosen: ReadonlyArray<number>,
  cursor: number | null,
): boolean {
  if (opened.has(group.note)) return true;
  if (chosen.some((play) => group.plays.includes(play))) return true;
  return cursor !== null && group.plays.includes(cursor);
}

/** A file (or the container its plays share) and the plays inside it. */
export interface PlayGroup {
  /** The container's note id, or "" for plays outside any container. */
  readonly note: string;
  readonly name: string;
  /** Its plays counted by move: "wrote 3, amended 2, linked 5". */
  readonly counts: string;
  /** Every play in the group, in turn order: what selecting the group's row selects. */
  readonly plays: ReadonlyArray<number>;
  readonly symbols: ReadonlyArray<PlaySymbol>;
}

const COUNT_WORDS: ReadonlyArray<readonly [Play["kind"], string]> = [
  ["read", "read"],
  ["write", "wrote"],
  ["amend", "amended"],
  ["link", "linked"],
  ["reach", "reached"],
  ["unlink", "unlinked"],
];

/**
 * A turn's plays as a tree, when its notes sit in a containment tree (a
 * codebase): grouped by the file each play's note lives in (the nearest
 * file, package, or folder above it), then by symbol, each symbol's links
 * below it. Null when no note the turn touches has a container, so a plain
 * memory keeps its flat list. Amends of a container never show: a file is
 * its symbols. Parents and kinds are the turn's (a write's `parent`) or the
 * notes' as they stood before it.
 */
export function playTree(
  turn: ThreadTurn,
  notes: NoteLookup,
  removals: ReadonlyMap<number, string> = NO_REMOVALS,
): Array<PlayGroup> | null {
  const parentNow = new Map<string, string>();
  const kindNow = new Map<string, NoteKind>();
  for (const event of turn.events) {
    if (event.kind !== "write" && event.kind !== "amend") continue;
    if (event.parent !== undefined) parentNow.set(event.note, event.parent);
    if (event.noteKind !== undefined) kindNow.set(event.note, event.noteKind);
  }
  const parent = (id: string) => parentNow.get(id) ?? notes.get(id)?.parent;
  const kind = (id: string) => kindNow.get(id) ?? notes.get(id)?.kind;
  const container = (id: string) => {
    const kindOf = kind(id);
    return kindOf !== undefined && CONTAINER_KINDS.has(kindOf);
  };
  // The group a note's plays go under: itself when it is a container, else the nearest container above it.
  const groupOf = (id: string): string => {
    if (container(id)) return id;
    const first = parent(id);
    for (let at = first; at !== undefined; at = parent(at)) if (container(at)) return at;
    return first ?? "";
  };
  const plays = describePlays(turn, notes, removals);
  const touched = turn.events.flatMap((event) =>
    event.kind === "resolve"
      ? []
      : event.kind === "link" || event.kind === "unlink"
        ? [event.from]
        : [event.note],
  );
  if (!touched.some((id) => parent(id) !== undefined || container(id))) return null;

  const namedNow = new Map<string, string>();
  for (const event of turn.events) {
    if ((event.kind === "write" || event.kind === "amend") && event.name !== undefined) {
      namedNow.set(event.note, event.name);
    }
  }
  const name = (id: string) => namedNow.get(id) ?? notes.get(id)?.name ?? id;

  interface SymbolMoves {
    readonly moves: Array<number>;
    readonly links: Array<PlayLeaf>;
  }
  interface Building {
    readonly plays: Array<number>;
    readonly symbols: Map<string, SymbolMoves>;
  }
  const groups = new Map<string, Building>();
  const symbolIn = (group: string, note: string) => {
    const building: Building = groups.get(group) ?? { plays: [], symbols: new Map() };
    groups.set(group, building);
    const symbol: SymbolMoves = building.symbols.get(note) ?? { moves: [], links: [] };
    building.symbols.set(note, symbol);
    return { building, symbol };
  };
  turn.events.forEach((event, index) => {
    const play = plays[index];
    // A re-resolution is no play: no row, and it counts in no file's links.
    if (play === undefined || event.kind === "resolve") return;
    if (event.kind === "link" || event.kind === "unlink") {
      const { building, symbol } = symbolIn(groupOf(event.from), event.from);
      building.plays.push(index);
      const linkKind = event.linkKind === undefined ? "" : ` (${event.linkKind})`;
      const text =
        play.kind === "unlink"
          ? `unlinked ${name(event.to)}${linkKind}`
          : play.kind === "reach"
            ? `→ ${name(event.to)} (red link)`
            : `→ ${name(event.to)}${linkKind}`;
      symbol.links.push({ play: index, kind: play.kind, text, glyph: play.glyph });
      return;
    }
    if (event.kind === "amend" && container(event.note)) return;
    const { building, symbol } = symbolIn(groupOf(event.note), event.note);
    building.plays.push(index);
    symbol.moves.push(index);
  });

  return [...groups].map(([note, building]) => {
    const counted = COUNT_WORDS.flatMap(([kindOf, word]) => {
      const count = building.plays.filter((index) => plays[index]?.kind === kindOf).length;
      return count === 0 ? [] : [`${word} ${count}`];
    });
    const symbols = [...building.symbols].map(([symbolNote, symbol]): PlaySymbol => {
      const verbs = [
        ...new Set(symbol.moves.map((index) => plays[index]?.text.split(" ")[0] ?? "")),
      ];
      const moves = symbol.moves.length;
      const pick: PlayPick =
        moves === 1
          ? (symbol.moves[0] ?? 0)
          : moves > 1
            ? symbol.moves
            : symbol.links.length === 1
              ? (symbol.links[0]?.play ?? 0)
              : symbol.links.map((leaf) => leaf.play);
      const glyphs = new Set(symbol.moves.map((index) => plays[index]?.glyph ?? ""));
      return {
        note: symbolNote,
        text: verbs.length > 0 ? `${verbs.join(", ")} ${name(symbolNote)}` : name(symbolNote),
        glyph: glyphs.has(VERB_GLYPH.write)
          ? VERB_GLYPH.write
          : glyphs.has(VERB_GLYPH.amend)
            ? VERB_GLYPH.amend
            : "",
        kindGlyph: kindGlyph(kind(symbolNote)),
        pick,
        links: symbol.links,
      };
    });
    return {
      note,
      name: note === "" ? "elsewhere" : name(note),
      counts: counted.join(", "),
      plays: building.plays.toSorted((left, right) => left - right),
      symbols,
    };
  });
}

/**
 * The notes as the thread had them just before the turn ending at
 * `checkpoint`: what that turn's plays are named against. Costs the turns
 * before it, not the memory.
 */
export function memoryBefore(memory: Memory, thread: ThreadRecord, checkpoint: number): NoteLookup {
  return memoryAt(memory, thread, Math.max(0, checkpoint)).byId;
}

/** What a move does: to a note (written, amended, read, removed), or to a link. */
export type MoveVerb = "write" | "amend" | "read" | "remove" | "link" | "unlink";

/** One move of a turn at the level shown: what the agent's cursor visits, in play order. */
export interface Move {
  /** Its place in the turn: its play. */
  readonly play: number;
  readonly verb: MoveVerb;
  /** The shown note it acts on (universe index); a link's source. */
  readonly note: number;
  /** A link's (or unlink's) shown target, else -1. */
  readonly to: number;
}

/**
 * The moves of `turn`, each note as what shows for it in `view` (itself, or
 * the closed container holding it); a move whose note does not show is left
 * out. An unlink in `removals` removes its note.
 */
export function turnMoves(
  turn: ThreadTurn,
  universe: Universe,
  view: Pick<ReadingView, "holders" | "nodeAt">,
  removals: ReadonlyMap<number, string> = NO_REMOVALS,
): Array<Move> {
  const shown = (id: string) => {
    const index = universe.indexOf.get(id);
    if (index === undefined) return -1;
    const holder = view.holders.get(index) ?? index;
    return view.nodeAt.has(holder) ? holder : -1;
  };
  return turn.events.flatMap((event, play): Array<Move> => {
    // A re-resolution is no move: the cursor never visits it.
    if (event.kind === "resolve") return [];
    if (event.kind === "link" || event.kind === "unlink") {
      const gone = removals.get(play);
      if (gone !== undefined) {
        const note = shown(gone);
        return note < 0 ? [] : [{ play, verb: "remove", note, to: -1 }];
      }
      const from = shown(event.from);
      const to = shown(event.to);
      if (from < 0) return [];
      return [{ play, verb: event.kind, note: from, to: to === from ? -1 : to }];
    }
    const note = shown(event.note);
    if (note < 0) return [];
    const verb = event.kind === "write" ? "write" : event.kind === "amend" ? "amend" : "read";
    return [{ play, verb, note, to: -1 }];
  });
}

/**
 * One visit of the agent's cursor: a shown thing it goes to once for all the
 * moves on it, or one stretch between two shown things for all the links
 * between them. Labelled in the play-by-play's words.
 */
export interface Visit {
  /** The first play it stands for: the row that lights. */
  readonly play: number;
  /** Every play it stands for, in turn order. */
  readonly plays: ReadonlyArray<number>;
  /** A note visit's gesture (write before remove before amend before read), or link / unlink. */
  readonly verb: MoveVerb;
  /** The shown thing it visits; a link's source. */
  readonly note: number;
  /** A link's shown target, else -1. */
  readonly to: number;
  /** What the cursor's label says on the way and at rest. */
  readonly label: string;
}

const VISIT_VERBS: ReadonlyArray<readonly [MoveVerb, string]> = [
  ["write", "wrote"],
  ["remove", "removed"],
  ["amend", "amended"],
  ["read", "read"],
];

/**
 * The cursor's visits for `turn`'s moves: each shown thing once for all its
 * note moves, each pair of shown things once for all the links between them,
 * in the order of each one's first play. A single move reads as its play
 * ("+ wrote PR Review"); several read like the file row ("wrote 6, amended 1
 * in attention.test.ts", "linked plays.ts to playEdge, +4 more").
 */
export function turnVisits(
  turn: ThreadTurn,
  universe: Universe,
  moves: ReadonlyArray<Move>,
  notes: NoteLookup,
  removals: ReadonlyMap<number, string> = NO_REMOVALS,
  /** Whether a shown thing is a container told as a whole: its visit reads like the file row even for one move. */
  summarised: (note: number) => boolean = () => false,
): Array<Visit> {
  const plays = describePlays(turn, notes, removals);
  // The story's glyph, then the note's kind as its shape's glyph (a codebase's), then the words.
  const words = (play: number, kind = "") => {
    const described = plays[play];
    if (described === undefined) return "";
    return [described.glyph, kind, described.text].filter((part) => part !== "").join(" ");
  };
  const groups = new Map<string, Array<Move>>();
  for (const move of moves) {
    const link = move.verb === "link" || move.verb === "unlink";
    const key = link
      ? `link:${Math.min(move.note, move.to)}:${Math.max(move.note, move.to)}`
      : `note:${move.note}`;
    const group = groups.get(key) ?? [];
    group.push(move);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group): Visit => {
      const first = group[0];
      if (first === undefined) throw new Error("an empty visit");
      const link = first.verb === "link" || first.verb === "unlink";
      const all = group.map((move) => move.play);
      if (link) {
        return {
          play: first.play,
          plays: all,
          verb: first.verb,
          note: first.note,
          to: first.to,
          label:
            group.length === 1
              ? words(first.play)
              : `${words(first.play)}, +${group.length - 1} more`,
        };
      }
      const verb =
        VISIT_VERBS.find(([each]) => group.some((move) => move.verb === each))?.[0] ?? first.verb;
      const counted = VISIT_VERBS.flatMap(([each, word]) => {
        const count = group.filter((move) => move.verb === each).length;
        return count === 0 ? [] : [`${word} ${count}`];
      });
      const shape = kindGlyph(universe.nodes[first.note]?.kind);
      return {
        play: first.play,
        plays: all,
        verb,
        note: first.note,
        to: -1,
        label:
          group.length === 1 && !summarised(first.note)
            ? words(first.play, shape)
            : `${shape === "" ? "" : `${shape} `}${counted.join(", ")} in ${universe.nodes[first.note]?.name ?? ""}`,
      };
    })
    .toSorted((left, right) => left.play - right.play);
}

/** Whether two visit lists are the same visits. */
export const sameVisits = (left: ReadonlyArray<Visit>, right: ReadonlyArray<Visit>) =>
  left.length === right.length &&
  left.every((visit, at) => {
    const other = right[at];
    return (
      other !== undefined &&
      visit.play === other.play &&
      visit.verb === other.verb &&
      visit.note === other.note &&
      visit.to === other.to &&
      visit.label === other.label
    );
  });

/** Whether two move lists are the same moves. */
export const sameMoves = (left: ReadonlyArray<Move>, right: ReadonlyArray<Move>) =>
  left.length === right.length &&
  left.every((move, at) => {
    const other = right[at];
    return (
      other !== undefined &&
      move.play === other.play &&
      move.verb === other.verb &&
      move.note === other.note &&
      move.to === other.to
    );
  });

/** A link or unlink a selected play draws, by universe edge, with the way a link was written. */
export interface PlayLink {
  readonly edge: number;
  readonly kind: "link" | "unlink";
  /** For a link, the way it was written as `EdgeDirection` bits over the edge; else 0. */
  readonly ways: number;
}

/** A selected play (or several, a file's plays together), as the graph draws it: its notes and its links. */
export interface PlayFocus {
  /** A link (or a reach toward a red link), an unlink, a note read, amended, or written, or several plays. */
  readonly kind: "link" | "unlink" | "note" | "many";
  /** Universe node indices of the plays' notes. */
  readonly nodes: ReadonlyArray<number>;
  /** The links and unlinks the plays drew whose pairs the universe has edges for. */
  readonly links: ReadonlyArray<PlayLink>;
  /**
   * Links the story has already told (a tour's earlier visits): lit quietly,
   * still, no beads. Universe edges.
   */
  readonly quiet?: ReadonlyArray<number>;
}

/** A selection of plays: one play by its place in the turn, or several. */
export type PlayPick = number | ReadonlyArray<number>;

/** The plays a pick holds, in turn order. */
export const pickedPlays = (pick: PlayPick): ReadonlyArray<number> =>
  typeof pick === "number" ? [pick] : pick;

/**
 * The focus of play `index` of `turn` in `universe`, or null when there is no
 * such play. A link or unlink whose pair the universe has no edge for lights
 * its notes only.
 */
function oneFocus(universe: Universe, turn: ThreadTurn, index: number): PlayFocus | null {
  const event = turn.events[index];
  if (event === undefined || event.kind === "resolve") return null;
  const node = (id: string) => universe.indexOf.get(id) ?? -1;
  if (event.kind === "link" || event.kind === "unlink") {
    const nodes = [node(event.from), node(event.to)].filter((at) => at >= 0);
    const edge = universe.edgeIndexOf.get(pairKey(event.from, event.to)) ?? -1;
    if (edge < 0) return { kind: event.kind, nodes, links: [] };
    const ways =
      event.kind === "link"
        ? universe.edges[edge]?.a === node(event.from)
          ? EdgeDirection.forward
          : EdgeDirection.backward
        : 0;
    return { kind: event.kind, nodes, links: [{ edge, kind: event.kind, ways }] };
  }
  const at = node(event.note);
  return { kind: "note", nodes: at >= 0 ? [at] : [], links: [] };
}

/**
 * The focus of `pick` (one play, or several) of `turn` in `universe`, or null
 * when it holds no such play. Several plays draw their notes and links
 * together; where two touch one edge, the later play draws it.
 */
export function playFocus(universe: Universe, turn: ThreadTurn, pick: PlayPick): PlayFocus | null {
  const foci = pickedPlays(pick)
    .map((index) => oneFocus(universe, turn, index))
    .filter((focus): focus is PlayFocus => focus !== null);
  if (foci.length <= 1) return foci[0] ?? null;
  const nodes = [...new Set(foci.flatMap((focus) => focus.nodes))];
  const byEdge = new Map<number, PlayLink>();
  for (const focus of foci) for (const link of focus.links) byEdge.set(link.edge, link);
  return { kind: "many", nodes, links: [...byEdge.values()] };
}

/**
 * A play's focus at the shown level: each of its notes as what shows for it
 * (the closed container holding it, else itself), each link as the edge drawn
 * between those, the way it was written carried over. A link inside one
 * closed container has nothing to draw.
 */
export function focusAtLevel(
  focus: PlayFocus | null,
  view: Pick<ReadingView, "holders">,
  universe: Universe,
): PlayFocus | null {
  if (focus === null || view.holders.size === 0) return focus;
  const shown = (index: number) => view.holders.get(index) ?? index;
  const flip = (ways: number) =>
    ((ways & EdgeDirection.forward) !== 0 ? EdgeDirection.backward : 0) |
    ((ways & EdgeDirection.backward) !== 0 ? EdgeDirection.forward : 0);
  const byEdge = new Map<number, PlayLink>();
  for (const link of focus.links) {
    const edge = universe.edges[link.edge];
    if (edge === undefined) continue;
    const a = shown(edge.a);
    const b = shown(edge.b);
    if (a === edge.a && b === edge.b) {
      byEdge.set(link.edge, link);
      continue;
    }
    const at = a === b ? -1 : edgeBetween(universe, a, b);
    const target = universe.edges[at];
    if (target === undefined) continue;
    byEdge.set(at, {
      edge: at,
      kind: link.kind,
      ways: target.a === a ? link.ways : flip(link.ways),
    });
  }
  return { ...focus, nodes: [...new Set(focus.nodes.map(shown))], links: [...byEdge.values()] };
}

/**
 * How edge `index` is drawn: as the checkpoint has it, except the selected
 * plays' own edges, each drawn by its play whatever became of it later in
 * the turn: a link shown and marked new, an unlink shown broken.
 */
export function playEdge(
  view: GraphView,
  play: PlayFocus | null,
  index: number,
): { readonly visible: number; readonly kind: number } {
  const link = play?.links.find((candidate) => candidate.edge === index);
  if (link !== undefined) {
    return { visible: 1, kind: link.kind === "link" ? EdgeKind.new : EdgeKind.broken };
  }
  return { visible: view.edgeVisible[index] ?? 0, kind: view.edgeKind[index] ?? EdgeKind.plain };
}

/** A selected play, remembered with the reading it was chosen in. */
export type PlaySelection = { readonly reading: string; readonly index: PlayPick } | null;

export type PlaySelectionAction =
  /** A play was chosen in `reading`, or the selection was cleared. */
  | { readonly type: "select"; readonly reading: string; readonly index: PlayPick | null }
  /** The reading moved (checkpoint, memory, or reading mode): whatever was selected is cleared. */
  | { readonly type: "reading"; readonly reading: string };

/**
 * The play selection as a reducer: selecting sets it, and any change of the
 * reading clears it for good, so coming back to the same checkpoint shows no
 * selection and the story keeps its own timing.
 */
export function selectPlay(selection: PlaySelection, action: PlaySelectionAction): PlaySelection {
  if (action.type === "select") {
    return action.index === null ? null : { reading: action.reading, index: action.index };
  }
  return selection !== null && selection.reading === action.reading ? selection : null;
}

/** The selected play's index (or plays') while its reading is still the one shown, else none. */
export const selectedIn = (selection: PlaySelection, reading: string): PlayPick | null =>
  selection !== null && selection.reading === reading ? selection.index : null;

/** A row of the cursor's popover: a group's heading, or one play. */
export type PlayRow =
  | {
      readonly kind: "group";
      /** The container the plays below it sit in, as its id (a path, in a codebase). */
      readonly name: string;
      /** The plays of the run of rows it heads, in turn order. */
      readonly plays: ReadonlyArray<number>;
    }
  | {
      readonly kind: "play";
      /** Its place in the turn. */
      readonly play: number;
      readonly glyph: string;
      readonly text: string;
    };

/** A container that only holds the work: writing it is structure, not a move worth a row. */
const STRUCTURE_KINDS: ReadonlySet<NoteKind> = new Set(["folder", "package"]);

/**
 * A turn's plays as the cursor's popover lists them: in turn order, each in
 * the play-by-play's words, under a heading wherever the container its note
 * sits in changes (a folder, in a story told at file level). Writing a folder
 * is how a file comes to sit in it, not a move of its own, so it has no row.
 * A memory whose notes sit in no container has no headings.
 */
export function playRows(
  turn: ThreadTurn,
  notes: NoteLookup,
  removals: ReadonlyMap<number, string> = NO_REMOVALS,
): Array<PlayRow> {
  const plays = describePlays(turn, notes, removals);
  const parentNow = new Map<string, string>();
  for (const event of turn.events) {
    if ((event.kind === "write" || event.kind === "amend") && event.parent !== undefined) {
      parentNow.set(event.note, event.parent);
    }
  }
  const parentOf = (id: string) => parentNow.get(id) ?? notes.get(id)?.parent;
  const rows: Array<PlayRow> = [];
  let heading: { name: string; plays: Array<number> } | null = null;
  turn.events.forEach((event, index) => {
    const play = plays[index];
    if (play === undefined || event.kind === "resolve") return;
    if (event.kind === "write" || event.kind === "amend") {
      const kind = event.noteKind ?? notes.get(event.note)?.kind;
      if (kind !== undefined && STRUCTURE_KINDS.has(kind)) return;
    }
    const subject = event.kind === "link" || event.kind === "unlink" ? event.from : event.note;
    const parent = parentOf(subject);
    if (parent !== undefined && parent !== heading?.name) {
      heading = { name: parent, plays: [] };
      rows.push({ kind: "group", name: parent, plays: heading.plays });
    } else if (parent === undefined) {
      heading = null;
    }
    heading?.plays.push(index);
    rows.push({ kind: "play", play: index, glyph: play.glyph, text: play.text });
  });
  return rows;
}

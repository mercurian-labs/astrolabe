/**
 * The level a codebase's reading is told at. The story set's lowest common container opens with its
 * children shown, and everything outside closes where it meets that line, so the reading persists
 * collapsed; when that would not fit one frame, the level goes up. Pure over the universe and
 * reading; the host keeps the closed set as the reader drills in and out.
 */
import { pairKey } from "./memory.ts";
import type { Reading } from "./reading.ts";
import type { Universe } from "./universe.ts";

/** The reading density's spacing on screen, in CSS pixels (the camera's READING_PIXELS). */
const SPACING_PIXELS = 96;

/** How many shown things fit a frame of `width` × `height` CSS pixels at the reading density. */
export const frameCapacity = (width: number, height: number) =>
  Math.max(4, Math.floor(width / SPACING_PIXELS) * Math.floor(height / SPACING_PIXELS));

/** A note's containers from the top down, ending with the note itself. */
function chainOf(universe: Universe, note: number): Array<number> {
  const up: Array<number> = [];
  for (let at = note; at >= 0; at = universe.parentOf[at] ?? -1) up.push(at);
  return up.toReversed();
}

const isContainer = (universe: Universe, note: number) =>
  (universe.childrenOf[note]?.length ?? 0) > 0;

/** The notes a reading holds (worked, earlier, and around), by universe index. */
export function readingNotes(universe: Universe, reading: Reading): Array<number> {
  const notes: Array<number> = [];
  for (const set of [reading.now, reading.earlier, reading.around]) {
    for (const id of set) {
      const index = universe.indexOf.get(id);
      if (index !== undefined && reading.state.byId.has(id)) notes.push(index);
    }
  }
  return [...new Set(notes)];
}

/** The turn's story at a reading's checkpoint: what it wrote or amended, and both ends of the links it made. */
export function storyNotes(universe: Universe, reading: Reading): Array<number> {
  const ids = new Set<string>();
  for (const [id, mark] of reading.noteMarks) if (mark.turn === reading.checkpoint) ids.add(id);
  for (const mark of reading.linkMarks.values()) {
    if (mark.turn !== reading.checkpoint || mark.mark !== "new") continue;
    ids.add(mark.from);
    ids.add(mark.to);
  }
  return [...ids]
    .map((id) => universe.indexOf.get(id))
    .filter((index): index is number => index !== undefined);
}

/**
 * The lowest container holding every note of `focus`, or -1 when they share
 * none (the top). A focus of one leaf opens the container it sits in.
 */
export function lowestCommon(universe: Universe, focus: ReadonlyArray<number>): number {
  let common: Array<number> | null = null;
  for (const note of focus) {
    const chain = chainOf(universe, note);
    if (common === null) {
      common = chain;
      continue;
    }
    let depth = 0;
    while (depth < common.length && depth < chain.length && common[depth] === chain[depth]) {
      depth += 1;
    }
    common = common.slice(0, depth);
  }
  const lowest = common?.at(-1) ?? -1;
  return lowest >= 0 && !isContainer(universe, lowest) ? (universe.parentOf[lowest] ?? -1) : lowest;
}

/**
 * The closed set for level `open` (a container, or -1 for the top): each reading note shows as the
 * child of the container where its line meets `open`'s, closed when that child is a container.
 * Notes inside `open` show as its children; `open` and its ancestors are regions.
 */
export function levelClosed(
  universe: Universe,
  notes: ReadonlyArray<number>,
  open: number,
): Set<number> {
  const line = open < 0 ? [] : chainOf(universe, open);
  const closed = new Set<number>();
  for (const note of notes) {
    const chain = chainOf(universe, note);
    let depth = 0;
    while (depth < line.length && depth < chain.length && line[depth] === chain[depth]) depth += 1;
    // The note is `open` or one of its containers: it is a region.
    if (depth === chain.length) continue;
    const child = chain[depth];
    if (child !== undefined && child !== note && isContainer(universe, child)) closed.add(child);
  }
  return closed;
}

/** How many things show for `notes` with `closed` closed: each note, or the outermost closed container above it. */
export function shownCount(
  universe: Universe,
  notes: ReadonlyArray<number>,
  closed: ReadonlySet<number>,
): number {
  const shown = new Set<number>();
  for (const note of notes) {
    let holder = note;
    for (let up = universe.parentOf[note] ?? -1; up >= 0; up = universe.parentOf[up] ?? -1) {
      if (closed.has(up)) holder = up;
    }
    shown.add(holder);
  }
  // The containers above shown things are regions, not nodes.
  for (const note of shown) {
    for (let up = universe.parentOf[note] ?? -1; up >= 0; up = universe.parentOf[up] ?? -1) {
      shown.delete(up);
    }
  }
  return shown.size;
}

/**
 * The closed set that tells `focus` (the story, or the whole reading for a
 * Fit) at its span: open the lowest container holding it, close everything
 * else at the level where it meets that line, and go up one container at a
 * time while the shown things exceed `capacity`.
 */
export function spanLevel(
  universe: Universe,
  notes: ReadonlyArray<number>,
  focus: ReadonlyArray<number>,
  capacity: number,
  fill = false,
): Set<number> {
  if (!universe.tree || notes.length === 0) return new Set();
  const told = focus.length > 0 ? focus : notes;
  let open = lowestCommon(universe, told);
  for (;;) {
    const closed = levelClosed(universe, notes, open);
    if (open < 0 || shownCount(universe, notes, closed) <= capacity) {
      return fill ? fillFrame(universe, notes, told, closed, capacity) : closed;
    }
    open = universe.parentOf[open] ?? -1;
  }
}

/** Container kinds a frame fills by opening: the folders a file-level story lives in. */
const FILLED_KINDS: ReadonlySet<string> = new Set(["folder", "package"]);

/**
 * `closed` with the story's folders opened, fullest first, while the frame holds what shows, so a
 * story spanning the repository's top reads as named folders. The order ignores `capacity` and the
 * first overfill stops it, so a wider frame opens a superset of a narrower one's. Files and below
 * stay the reader's drill.
 */
function fillFrame(
  universe: Universe,
  notes: ReadonlyArray<number>,
  focus: ReadonlyArray<number>,
  closed: Set<number>,
  capacity: number,
): Set<number> {
  let level = closed;
  for (;;) {
    let best = -1;
    let bestHeld = 0;
    for (const container of level) {
      if (!FILLED_KINDS.has(universe.nodes[container]?.kind ?? "")) continue;
      const held = focus.filter((note) => chainOf(universe, note).includes(container)).length;
      if (held > bestHeld || (held === bestHeld && held > 0 && container < best)) {
        best = container;
        bestHeld = held;
      }
    }
    if (best < 0) return level;
    const next = openContainer(universe, level, best, notes);
    if (shownCount(universe, notes, next) > capacity) return level;
    level = next;
  }
}

/** The level a landing checkpoint tells its story at: `spanLevel` over its reading and story. */
export function storyLevel(
  universe: Universe,
  reading: Reading,
  capacity: number,
  fill = false,
): Set<number> {
  return spanLevel(
    universe,
    readingNotes(universe, reading),
    storyNotes(universe, reading),
    capacity,
    fill,
  );
}

/**
 * Open `container`: its children with reading notes inside show, each child
 * container closed; everything else stays as it was.
 */
export function openContainer(
  universe: Universe,
  closed: ReadonlySet<number>,
  container: number,
  notes: ReadonlyArray<number>,
): Set<number> {
  const next = new Set(closed);
  next.delete(container);
  for (const note of notes) {
    const chain = chainOf(universe, note);
    const at = chain.indexOf(container);
    if (at < 0) continue;
    const child = chain[at + 1];
    if (child !== undefined && child !== note && isContainer(universe, child)) next.add(child);
  }
  return next;
}

/** Close `container` again: one node for everything inside it. */
export function closeContainer(
  universe: Universe,
  closed: ReadonlySet<number>,
  container: number,
): Set<number> {
  const next = new Set<number>([container]);
  for (const other of closed) {
    if (!chainOf(universe, other).includes(container)) next.add(other);
  }
  return next;
}

/**
 * Open whatever closed containers hold `notes`, outermost first, so each
 * shows as itself: what selecting a symbol's play does.
 */
export function revealNotes(
  universe: Universe,
  closed: ReadonlySet<number>,
  notes: ReadonlyArray<number>,
  readingHeld: ReadonlyArray<number>,
): Set<number> {
  let next = new Set(closed);
  for (const note of notes) {
    for (const up of chainOf(universe, note).slice(0, -1)) {
      if (next.has(up)) next = openContainer(universe, next, up, readingHeld);
    }
  }
  return next;
}

/** A stable key for a closed set, for caches. */
export const closedKey = (closed: ReadonlySet<number>) =>
  [...closed].sort((left, right) => left - right).join(",");

/** Whether two closed sets are the same. */
export const sameClosed = (left: ReadonlySet<number>, right: ReadonlySet<number>) =>
  left.size === right.size && [...left].every((note) => right.has(note));

/** The aggregate (or own) edge drawn between two shown things, or -1. */
export const edgeBetween = (universe: Universe, a: number, b: number) =>
  universe.edgeIndexOf.get(pairKey(universe.nodes[a]?.id ?? "", universe.nodes[b]?.id ?? "")) ?? -1;

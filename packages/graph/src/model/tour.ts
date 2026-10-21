/**
 * The agent's tour of a turn: the visits its cursor makes, one container at a
 * time. A landing chooses the level for the survey; a visit to a closed
 * container whose contents the turn worked does not summarise it but opens
 * it, tells each worked symbol inside in play order (with the links they made,
 * to things inside or out), and closes it again before going on. Nested
 * containers open in turn (folder › file › class). Links between two closed
 * containers stay one ride at the outer level.
 *
 * Each visit carries the edges its plays draw at its own level, so the
 * renderer can light only the links of the visit it is telling.
 */
import { openContainer } from "./level.ts";
import {
  focusAtLevel,
  playFocus,
  turnMoves,
  turnVisits,
  type NoteLookup,
  type PlayLink,
  type Visit,
} from "./plays.ts";
import type { ThreadTurn } from "./thread.ts";
import type { Universe } from "./universe.ts";
import type { ReadingView } from "./view.ts";

/** What a visit to a closed container opens into. */
export interface TourInner {
  /** The container, by universe index. */
  readonly container: number;
  /** The closed set with the container open: the level its visits are told at. */
  readonly closed: ReadonlySet<number>;
  /** The closed set it returns to. */
  readonly outer: ReadonlySet<number>;
  readonly visits: ReadonlyArray<TourVisit>;
}

export interface TourVisit extends Visit {
  /** The links its plays draw at its level (universe edges): lit, with beads, while it is told. */
  readonly links: ReadonlyArray<PlayLink>;
  /** For a closed container the turn worked inside: what it opens into. */
  readonly inner: TourInner | null;
}

const isLink = (visit: Visit) => visit.verb === "link" || visit.verb === "unlink";

/**
 * The tour of `turn` at the level `closed`: its visits, each container the
 * turn worked inside opened into its own. `viewAt` derives the reading's view
 * at a closed set; `held` are the reading's notes (what an opening shows).
 * With `only`, the tour of those plays alone (what a working turn appended):
 * each visit groups, words, and gestures only its own plays.
 */
export function turnTour(
  turn: ThreadTurn,
  universe: Universe,
  closed: ReadonlySet<number>,
  viewAt: (closed: ReadonlySet<number>) => ReadingView,
  held: ReadonlyArray<number>,
  notes: NoteLookup,
  removals: ReadonlyMap<number, string>,
  only: ReadonlySet<number> | null = null,
): Array<TourVisit> {
  const tell = (level: ReadonlySet<number>, only: ReadonlySet<number> | null, depth: number) => {
    const view = viewAt(level);
    const moves = turnMoves(turn, universe, view, removals).filter(
      (move) => only === null || only.has(move.play),
    );
    const visits = turnVisits(turn, universe, moves, notes, removals, (note) => level.has(note));
    const linksOf = (plays: ReadonlyArray<number>) => {
      const links = new Map<number, PlayLink>();
      for (const play of plays) {
        for (const link of focusAtLevel(playFocus(universe, turn, play), view, universe)?.links ??
          []) {
          links.set(link.edge, link);
        }
      }
      return [...links.values()];
    };
    const consumed = new Set<number>();
    const told: Array<TourVisit> = [];
    for (const visit of visits) {
      const container = !isLink(visit) && level.has(visit.note) && depth < 8;
      if (!container) {
        told.push({ ...visit, links: linksOf(visit.plays), inner: null });
        continue;
      }
      // Inside: its note moves, and the links made from its members, to anything.
      const links = visits.filter((each) => isLink(each) && each.note === visit.note);
      const plays = new Set([...visit.plays, ...links.flatMap((each) => each.plays)]);
      for (const play of plays) consumed.add(play);
      const opened = openContainer(universe, level, visit.note, held);
      told.push({
        ...visit,
        links: linksOf([...plays]),
        inner: {
          container: visit.note,
          closed: opened,
          outer: level,
          visits: tell(opened, plays, depth + 1),
        },
      });
    }
    return told.filter(
      (visit) =>
        visit.inner !== null || !isLink(visit) || !visit.plays.every((play) => consumed.has(play)),
    );
  };
  return tell(closed, only, 0);
}

/** Every visit of a tour, the containers' inner visits in their place: what the cursor tells, in order. */
export function tourSteps(tour: ReadonlyArray<TourVisit>): Array<TourVisit> {
  return tour.flatMap((visit) => [
    visit,
    ...(visit.inner === null ? [] : tourSteps(visit.inner.visits)),
  ]);
}

/**
 * The popover's rows to light: the chosen plays (`chosen`), else the play the
 * cursor is on, alone; `near` are the other plays of the visit it is telling
 * (a file amended twice is told once), which carry a quieter mark.
 */
export function cursorRows(
  chosen: ReadonlyArray<number> | null,
  cursor: number | null,
  tour: ReadonlyArray<TourVisit>,
): { readonly lit: ReadonlyArray<number>; readonly near: ReadonlyArray<number> } {
  if (chosen !== null) return { lit: chosen, near: [] };
  if (cursor === null) return { lit: [], near: [] };
  const visit = tourSteps(tour).find((each) => each.play === cursor);
  return { lit: [cursor], near: (visit?.plays ?? []).filter((each) => each !== cursor) };
}

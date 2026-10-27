/**
 * The cursor's popover: the shown turn's moves beside the agent's cursor, since attention is
 * already there. Each row is a door: choosing it puts the cursor on that move, choosing it again
 * lets go. Placed by the cursor's position (see `popoverPlace`), never by React.
 */
import { useEffect, useMemo, useRef, type Ref } from "react";

import { pickedPlays, playRows, type NoteLookup, type PlayPick } from "./model/plays.ts";
import type { ThreadTurn } from "./model/thread.ts";

export interface CursorPlaysProps {
  readonly turn: ThreadTurn;
  /** The notes as they stood before the turn (`memoryBefore`). */
  readonly notes: NoteLookup;
  readonly removals: ReadonlyMap<number, string>;
  readonly selected: PlayPick | null;
  /** The plays lit now: the chosen ones, else the one the cursor is on. */
  readonly lit: ReadonlyArray<number>;
  /** The other plays of the visit the cursor is telling: a quieter mark. */
  readonly near?: ReadonlyArray<number>;
  readonly onSelect: (pick: PlayPick | null) => void;
  readonly onClose: () => void;
  readonly ref?: Ref<HTMLDivElement>;
}

const NO_PLAYS: ReadonlyArray<number> = [];

const samePick = (a: PlayPick | null, b: PlayPick) =>
  a !== null && pickedPlays(a).join() === pickedPlays(b).join();

export function CursorPlays({
  turn,
  notes,
  removals,
  selected,
  lit,
  near = NO_PLAYS,
  onSelect,
  onClose,
  ref,
}: CursorPlaysProps) {
  const rows = useMemo(() => playRows(turn, notes, removals), [turn, notes, removals]);
  const litSet = useMemo(() => new Set(lit), [lit]);
  const nearSet = useMemo(() => new Set(near), [near]);
  const list = useRef<HTMLOListElement>(null);
  const toggle = (pick: PlayPick) => onSelect(samePick(selected, pick) ? null : pick);

  // The lit row stays in view inside the list (never scrolling the page around it).
  const first = lit[0];
  useEffect(() => {
    const element = list.current;
    if (first === undefined || element === null) return;
    const row = element.querySelector<HTMLElement>(`[data-play="${first}"]`);
    if (row === null) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + element.clientHeight) {
      element.scrollTop = bottom - element.clientHeight;
    }
  }, [first]);

  return (
    <div ref={ref} className="atlas-cursor-plays" role="dialog" aria-label="The turn's moves">
      <div className="atlas-cursor-plays-head">
        <span className="atlas-cursor-plays-turn">{turn.label}</span>
        <button
          type="button"
          className="atlas-cursor-plays-close"
          aria-label="Close the moves"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <ol ref={list} className="atlas-plays-list atlas-cursor-plays-list">
        {rows.map((row) =>
          row.kind === "group" ? (
            <li key={`group:${row.plays[0] ?? row.name}`}>
              <button
                type="button"
                className="atlas-play atlas-cursor-plays-group"
                aria-pressed={samePick(selected, row.plays)}
                onClick={() => toggle(row.plays)}
              >
                <span>
                  {row.name}
                  <span className="atlas-play-counts"> · {row.plays.length}</span>
                </span>
              </button>
            </li>
          ) : (
            <li key={row.play}>
              <button
                type="button"
                className="atlas-play"
                data-play={row.play}
                data-cursor={
                  litSet.has(row.play) ? "true" : nearSet.has(row.play) ? "near" : "false"
                }
                aria-pressed={samePick(selected, row.play)}
                onClick={() => toggle(row.play)}
              >
                <span className="atlas-play-glyph">{row.glyph}</span>
                <span>{row.text}</span>
              </button>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

/**
 * A checkpoint's play-by-play: the moves its turn made, numbered, in plain
 * words. Selecting a play shows it on the graph (pass the selection to
 * `AtlasGraph`'s `play`); selecting it again, or Escape, clears it. The host
 * owns the selection and clears it when the checkpoint changes.
 *
 * In a codebase the plays are a tree: a row per file with its moves counted,
 * collapsed, and inside it each symbol's moves with its links below. A file
 * row selects every play in it and opens it; a symbol row selects its moves;
 * a link row selects that link. The file holding the selected play opens by
 * itself, so playback stays visible.
 *
 * `notes` are the notes as they stood before the turn (`memoryBefore`), so a
 * link to a note nobody had written yet reads as reaching toward a red link.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  describePlays,
  pickedPlays,
  fileOpen,
  playTree,
  type NoteLookup,
  type PlayGroup,
  type PlayPick,
} from "./model/plays.ts";
import type { ThreadTurn } from "./model/thread.ts";
import { crossesBoundary, layerAt, notePath } from "./model/features.ts";
import type { Boundaries } from "./model/memory.ts";

export interface PlayByPlayProps {
  readonly turn: ThreadTurn;
  readonly notes: NoteLookup;
  /** The selected play, or plays (a file's, a symbol's). */
  readonly selected: PlayPick | null;
  readonly onSelect: (pick: PlayPick | null) => void;
  /** The plays that remove a note (see `removalsAt`): their rows carry "×". */
  readonly removals?: ReadonlyMap<number, string>;
  /** The play the agent's cursor is on (the graph's `onCursor`): its row lights in step. */
  readonly cursor?: number | null;
  /** A codebase's declared layers, while boundaries are on: a link that crosses where it may not says "!". */
  readonly boundaries?: Boundaries;
}

const NO_REMOVALS: ReadonlyMap<number, string> = new Map();

/** A link play that crosses two layers the boundaries do not allow: a small "!" after its glyphs. */
function Crossing({ crosses }: { readonly crosses: boolean }) {
  return crosses ? (
    <span className="atlas-play-crossing" aria-label="crosses a boundary it may not">
      !
    </span>
  ) : null;
}

/** A play's glyph before its text: what it did to its note. */
function Glyph({ glyph }: { readonly glyph: string }) {
  return <span className="atlas-play-glyph">{glyph}</span>;
}

/** Whether two picks hold the same plays. */
const samePick = (a: PlayPick | null, b: PlayPick | null) =>
  a !== null && b !== null && pickedPlays(a).join() === pickedPlays(b).join();

export function PlayByPlay({
  turn,
  notes,
  selected,
  onSelect,
  removals = NO_REMOVALS,
  cursor = null,
  boundaries,
}: PlayByPlayProps) {
  // Which link plays cross a boundary they may not: found once per turn, and only with a declaration.
  const crossing = useMemo(() => {
    const plays = new Set<number>();
    if (boundaries === undefined) return plays;
    turn.events.forEach((event, play) => {
      if (event.kind !== "link") return;
      const from = layerAt(boundaries, notePath(event.from));
      const to = layerAt(boundaries, notePath(event.to));
      if (crossesBoundary(boundaries, from, to)) plays.add(play);
    });
    return plays;
  }, [turn, boundaries]);
  const plays = useMemo(() => describePlays(turn, notes, removals), [turn, notes, removals]);
  const tree = useMemo(() => playTree(turn, notes, removals), [turn, notes, removals]);
  const atCursor = (picks: PlayPick) => cursor !== null && pickedPlays(picks).includes(cursor);
  const last = plays.length - 1;
  const list = useRef<HTMLOListElement>(null);
  // Files opened by hand, by turn so a new turn starts collapsed.
  const [opened, setOpened] = useState<{ turn: string; files: ReadonlySet<string> }>({
    turn: turn.id,
    files: new Set(),
  });
  const openFiles = opened.turn === turn.id ? opened.files : new Set<string>();
  const toggleFile = (note: string, open?: boolean) => {
    const files = new Set(openFiles);
    if (open ?? !files.has(note)) files.add(note);
    else files.delete(note);
    setOpened({ turn: turn.id, files });
  };
  const chosen = selected === null ? [] : pickedPlays(selected);
  const isOpen = (group: PlayGroup) => fileOpen(group, openFiles, chosen, cursor);

  // The selected play stays in view as playback (or the keyboard) moves through a long turn.
  const first = chosen[0];
  useEffect(() => {
    if (first === undefined) return;
    list.current?.querySelector(`[data-play="${first}"]`)?.scrollIntoView({ block: "nearest" });
  }, [first]);

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const low = chosen.length === 0 ? null : Math.min(...chosen);
    const high = chosen.length === 0 ? null : Math.max(...chosen);
    // The next play either way, stepping over re-resolutions (no rows of their own).
    const step = (from: number, by: number) => {
      for (let at = from; at >= 0 && at <= last; at += by) {
        if (plays[at]?.kind !== "resolve") return at;
      }
      return by > 0 ? (high ?? last) : (low ?? 0);
    };
    let next: number | null | undefined;
    if (event.key === "ArrowDown") next = step(high === null ? 0 : Math.min(last, high + 1), 1);
    else if (event.key === "ArrowUp") next = step(low === null ? last : Math.max(0, low - 1), -1);
    else if (event.key === "Escape") next = null;
    if (next === undefined || plays.length === 0) return;
    event.preventDefault();
    // Handled here: the graph's own Escape (which would let go of a pick) stays out of it.
    event.stopPropagation();
    onSelect(next);
  };
  const toggle = (pick: PlayPick) => onSelect(samePick(selected, pick) ? null : pick);

  return (
    <section className="atlas-plays" aria-label="Play-by-play">
      <h2 className="atlas-plays-turn">{turn.label}</h2>
      <ol ref={list} className="atlas-plays-list" tabIndex={0} onKeyDown={onKeyDown}>
        {tree === null
          ? plays.map((play, index) =>
              play.kind === "resolve" ? null : (
                <li key={play.id}>
                  <button
                    type="button"
                    className="atlas-play"
                    data-kind={play.kind}
                    data-play={index}
                    data-cursor={cursor === index}
                    aria-pressed={samePick(selected, index)}
                    onClick={() => toggle(index)}
                  >
                    <span className="atlas-play-number">{index + 1}</span>
                    <Glyph glyph={play.glyph} />
                    <Crossing crosses={crossing.has(index)} />
                    <span>{play.text}</span>
                  </button>
                </li>
              ),
            )
          : tree.map((group) => {
              const open = isOpen(group);
              return (
                <li key={group.note} className="atlas-play-file">
                  <div className="atlas-play-row">
                    {/* The chevron opens or closes the file without selecting it. */}
                    <button
                      type="button"
                      className="atlas-play-toggle"
                      aria-expanded={open}
                      aria-label={open ? `Close ${group.name}` : `Open ${group.name}`}
                      onClick={() => toggleFile(group.note, !open)}
                    >
                      {open ? "▾" : "▸"}
                    </button>
                    <button
                      type="button"
                      className="atlas-play"
                      data-cursor={atCursor(group.plays)}
                      aria-pressed={samePick(selected, group.plays)}
                      onClick={() => {
                        if (!samePick(selected, group.plays)) toggleFile(group.note, true);
                        toggle(group.plays);
                      }}
                    >
                      <span>
                        {group.name}
                        <span className="atlas-play-counts"> · {group.counts}</span>
                      </span>
                    </button>
                  </div>
                  {open ? (
                    <ol className="atlas-plays-list atlas-play-symbols">
                      {group.symbols.map((symbol) => (
                        <li key={symbol.note}>
                          <button
                            type="button"
                            className="atlas-play"
                            data-play={pickedPlays(symbol.pick)[0]}
                            data-cursor={atCursor(symbol.pick)}
                            aria-pressed={samePick(selected, symbol.pick)}
                            onClick={() => toggle(symbol.pick)}
                          >
                            <span className="atlas-play-number">
                              {typeof symbol.pick === "number" ? symbol.pick + 1 : ""}
                            </span>
                            <Glyph glyph={symbol.glyph} />
                            {symbol.kindGlyph === "" ? null : (
                              <span className="atlas-play-kind" aria-hidden="true">
                                {symbol.kindGlyph}
                              </span>
                            )}
                            <span>{symbol.text}</span>
                          </button>
                          {symbol.links.length === 0 ? null : (
                            <ol className="atlas-plays-list atlas-play-symbols">
                              {symbol.links.map((leaf) => (
                                <li key={leaf.play}>
                                  <button
                                    type="button"
                                    className="atlas-play"
                                    data-kind={leaf.kind}
                                    data-play={leaf.play}
                                    data-cursor={cursor === leaf.play}
                                    aria-pressed={samePick(selected, leaf.play)}
                                    onClick={() => toggle(leaf.play)}
                                  >
                                    <span className="atlas-play-number">{leaf.play + 1}</span>
                                    <Glyph glyph={leaf.glyph} />
                                    <Crossing crosses={crossing.has(leaf.play)} />
                                    <span>{leaf.text}</span>
                                  </button>
                                </li>
                              ))}
                            </ol>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              );
            })}
      </ol>
    </section>
  );
}

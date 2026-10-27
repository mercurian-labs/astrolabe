import {
  Facet,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { agentLog, arrivingEntries, setAgentLog } from "./changeState.ts";

// The arrival of agent writes, by presentation alone: a write lands in the document at once
// (the text is right at every instant), and each range it inserted is drawn from its start,
// the tail hidden in place (laid out but invisible) by a mark that shrinks every frame. Nothing
// here changes the document, the selection, or focus.

/** How long a range of `length` characters takes to reveal: 8 ms each, within bounds. */
function revealDuration(length: number) {
  return Math.min(800, Math.max(150, length * 8));
}

/**
 * Syntax nodes (by Lezer name) the reveal's boundary never rests inside: inline constructs
 * whose rendering pads them, so splitting one between its shown and hidden parts would pad
 * each piece and widen the line. A language layer provides them (the Markdown live preview
 * does); the default is none.
 */
export const revealAtomicNodes = Facet.define<readonly string[], ReadonlySet<string>>({
  combine: (values) => new Set(values.flat()),
});

/**
 * `boundary`, moved to the end of the outermost atomic node it falls strictly inside (and
 * never past `to`), so such a construct is revealed whole.
 */
function stepOverAtomic(state: EditorState, boundary: number, to: number) {
  const atomic = state.facet(revealAtomicNodes);
  if (atomic.size === 0 || boundary >= to) return boundary;
  let end = boundary;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(boundary, 1);
    node;
    node = node.parent
  ) {
    if (atomic.has(node.name) && node.from < boundary && node.to > boundary)
      end = Math.max(end, node.to);
  }
  return Math.min(end, to);
}

/** How long a ghost keeps the arriving class after its entry was written. */
const ARRIVAL_MS = 300;

export interface RevealOptions {
  /** Read when a write arrives: whether to reveal it. Defaults to on. */
  isOn?: () => boolean;
  /** The clock, in wall-clock milliseconds (comparable with an entry's `at`). */
  now?: () => number;
  /** Runs `frame` on the next animation frame; returns a cancel function. */
  schedule?: (frame: () => void) => () => void;
  /** Runs `done` after `ms` milliseconds; returns a cancel function. */
  wait?: (done: () => void, ms: number) => () => void;
}

interface Reveal {
  entryId: string;
  opIndex: number;
  /** The inserted range, mapped through changes. */
  from: number;
  to: number;
  /**
   * Where the hidden part starts, mapped through changes like `from` and `to` (sticking to
   * the text before it), so characters already drawn stay drawn whatever is edited before.
   */
  boundary: number;
  /** The range's length when it landed, which the pace is measured against. */
  length: number;
  start: number;
  duration: number;
}

interface RevealState {
  reveals: readonly Reveal[];
  /** Entries whose ghosts are still arriving. */
  arriving: ReadonlySet<string>;
}

const EMPTY: RevealState = { reveals: [], arriving: new Set() };

/** A frame: every reveal advances to `now`, and those named in `finish` end at once. */
const advanceReveals = StateEffect.define<{ now: number; finish: ReadonlySet<string> }>();
/** An entry's ghosts stop arriving. */
const arrived = StateEffect.define<string>();

const revealKey = (reveal: Reveal) => `${reveal.entryId}:${reveal.opIndex}`;

// The hidden part is drawn but invisible: it keeps its layout, so the paragraph has its full
// height from the moment the write lands and nothing moves as the reveal advances.
const hideTail = Decoration.mark({ class: "atlas-agent-reveal-hidden" });

// `visibility: hidden` rather than a transparent colour: it hides the text and the agent's
// insertion tint inside it (the mark wraps those marks, see `Prec.lowest` below), and the
// spans keep their boxes, so CodeMirror's measuring and caret placement are unaffected.
const revealTheme = EditorView.baseTheme({
  ".atlas-agent-reveal-hidden": { visibility: "hidden" },
});

function tail(reveal: Reveal) {
  return { from: Math.min(Math.max(reveal.boundary, reveal.from), reveal.to), to: reveal.to };
}

/** Whether any of the transaction's changes, in old positions, touch the hidden tail. */
function editedTail(reveal: Reveal, tr: Transaction) {
  const { from, to } = tail(reveal);
  let touched = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA <= to && toA >= from) touched = true;
  });
  return touched;
}

/** Whether any selection range touches the hidden tail, its edges included. */
function selectedTail(reveal: Reveal, state: EditorState) {
  const { from, to } = tail(reveal);
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/** Whether the person asked for reduced motion. */
export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * While `isOn()`, draws each new log entry's inserted ranges in from their start over 150 to 800 ms
 * (8 ms a character) and fades its ghosts in; the document lands at once and hidden text keeps its
 * layout, so nothing moves. Finishes early on a selection or edit in the hidden part, the entry leaving
 * the log, or a live-preview replace over it. Off under reduced motion. Needs `agentChanges`.
 */
export function revealAgentChanges(options: RevealOptions = {}): Extension {
  const isOn = options.isOn ?? (() => true);
  const now = options.now ?? (() => performance.timeOrigin + performance.now());
  const schedule =
    options.schedule ??
    ((frame: () => void) => {
      const id = requestAnimationFrame(() => frame());
      return () => cancelAnimationFrame(id);
    });
  const wait =
    options.wait ??
    ((done: () => void, ms: number) => {
      const id = setTimeout(done, ms);
      return () => clearTimeout(id);
    });

  const revealField = StateField.define<RevealState>({
    // Ghosts of entries already in the log that are younger than the arrival window still
    // fade in; their text does not reveal, since it was there before the editor.
    create(state) {
      const entries = agentLog(state)?.entries ?? [];
      if (entries.length === 0 || !isOn() || prefersReducedMotion()) return EMPTY;
      const time = now();
      const young = entries.filter((entry) => time - entry.at < ARRIVAL_MS);
      return young.length === 0
        ? EMPTY
        : { reveals: [], arriving: new Set(young.map((entry) => entry.id)) };
    },
    update(value, tr) {
      let { reveals, arriving } = value;
      if (tr.docChanged && reveals.length > 0) {
        reveals = reveals
          .filter((reveal) => !editedTail(reveal, tr))
          .map((reveal) => {
            const from = tr.changes.mapPos(reveal.from, 1);
            const to = Math.max(from, tr.changes.mapPos(reveal.to, -1));
            const boundary = tr.changes.mapPos(reveal.boundary, -1);
            return { ...reveal, from, to, boundary: Math.min(Math.max(boundary, from), to) };
          })
          .filter((reveal) => reveal.boundary < reveal.to);
      }
      for (const effect of tr.effects) {
        if (effect.is(setAgentLog)) {
          const ids = new Set(effect.value.map((entry) => entry.id));
          // A reveal whose entry left the log has nothing left to show.
          reveals = reveals.filter((reveal) => ids.has(reveal.entryId));
          if ([...arriving].some((id) => !ids.has(id))) {
            arriving = new Set([...arriving].filter((id) => ids.has(id)));
          }
          const known = new Set(agentLog(tr.startState)?.entries.map((entry) => entry.id));
          const landed = effect.value.filter((entry) => !known.has(entry.id));
          if (landed.length === 0 || !isOn() || prefersReducedMotion()) continue;
          const start = now();
          const added: Reveal[] = [];
          for (const entry of landed) {
            for (const [opIndex, op] of entry.ops.entries()) {
              if (op.to <= op.from) continue;
              const duration = revealDuration(op.to - op.from);
              added.push({
                entryId: entry.id,
                opIndex,
                from: op.from,
                to: op.to,
                boundary: op.from,
                length: op.to - op.from,
                start,
                duration,
              });
            }
          }
          reveals = [...reveals, ...added];
          const young = landed.filter((entry) => start - entry.at < ARRIVAL_MS);
          if (young.length > 0)
            arriving = new Set([...arriving, ...young.map((entry) => entry.id)]);
        } else if (effect.is(advanceReveals)) {
          const { now: time, finish } = effect.value;
          reveals = reveals
            .map((reveal) => {
              // The hidden part is never edited (an edit there ends the reveal), so how much
              // of it is left follows from the landed length and the time alone.
              const progress = Math.min(1, (time - reveal.start) / reveal.duration);
              const hidden = Math.ceil(reveal.length * (1 - progress));
              const boundary = stepOverAtomic(
                tr.state,
                Math.max(reveal.boundary, reveal.to - hidden),
                reveal.to,
              );
              return { ...reveal, boundary };
            })
            .filter((reveal) => reveal.boundary < reveal.to && !finish.has(revealKey(reveal)));
        } else if (effect.is(arrived) && arriving.has(effect.value)) {
          arriving = new Set([...arriving].filter((id) => id !== effect.value));
        }
      }
      // The hidden part only ever holds the write's own characters: the selection touching
      // it ends the reveal (this also covers a caret already there when the write lands).
      if (reveals.length > 0) reveals = reveals.filter((reveal) => !selectedTail(reveal, tr.state));
      if (reveals === value.reveals && arriving === value.arriving) return value;
      return reveals.length === 0 && arriving.size === 0 ? EMPTY : { reveals, arriving };
    },
    provide: (field) => [
      // Lowest precedence draws the hiding mark around the insertion marks (B21 checks the
      // nesting), so their tint is hidden with the text instead of showing as an empty block.
      Prec.lowest(
        EditorView.decorations.from(field, (value): DecorationSet =>
          value.reveals.length === 0
            ? Decoration.none
            : Decoration.set(
                value.reveals.map((reveal) => hideTail.range(tail(reveal).from, reveal.to)),
                true,
              ),
        ),
      ),
      arrivingEntries.from(field, (value) => value.arriving),
    ],
  });

  /**
   * The reveals whose hidden part lies inside a range another decoration replaces (a
   * table, rendered math, frontmatter, a folded callout): there is nothing there to animate.
   * Read from the view's decoration sources each frame, so it needs no live-preview API.
   */
  const insideReplaced = (view: EditorView, reveals: readonly Reveal[]) => {
    const finish = new Set<string>();
    for (const source of view.state.facet(EditorView.decorations)) {
      const set = typeof source === "function" ? source(view) : source;
      for (const reveal of reveals) {
        const { from, to } = tail(reveal);
        set.between(from, to, (rangeFrom, rangeTo, decoration) => {
          if (!decoration.point || rangeTo <= rangeFrom) return;
          // Contained, not merely overlapping: a hidden marker or a bullet widget inside the
          // text does not stop the reveal around it.
          if (rangeFrom <= from && rangeTo >= to) finish.add(revealKey(reveal));
        });
      }
    }
    return finish;
  };

  const animator = ViewPlugin.define((view) => {
    let destroyed = false;
    let cancelFrame: (() => void) | null = null;
    const timers = new Map<string, () => void>();

    const frame = () => {
      cancelFrame = null;
      const { reveals } = view.state.field(revealField);
      if (destroyed || reveals.length === 0) return;
      view.dispatch({
        effects: advanceReveals.of({ now: now(), finish: insideReplaced(view, reveals) }),
      });
    };

    // Runs a frame loop while reveals remain, and one timer per arriving entry.
    const sync = (state: EditorState) => {
      const { reveals, arriving } = state.field(revealField);
      if (reveals.length > 0 && !cancelFrame) cancelFrame = schedule(frame);
      if (reveals.length === 0 && cancelFrame) {
        cancelFrame();
        cancelFrame = null;
      }
      const entries = agentLog(state)?.entries ?? [];
      for (const id of arriving) {
        if (timers.has(id)) continue;
        const at = entries.find((entry) => entry.id === id)?.at ?? 0;
        const delay = Math.max(0, ARRIVAL_MS - (now() - at));
        timers.set(
          id,
          wait(() => {
            timers.delete(id);
            if (!destroyed) view.dispatch({ effects: arrived.of(id) });
          }, delay),
        );
      }
    };

    sync(view.state);
    return {
      update(update) {
        if (update.state.field(revealField) !== update.startState.field(revealField)) {
          sync(update.state);
        }
      },
      destroy() {
        destroyed = true;
        cancelFrame?.();
        for (const cancel of timers.values()) cancel();
        timers.clear();
      },
    };
  });

  return [revealField, animator, revealTheme];
}

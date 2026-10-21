import { StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { ySyncFacet } from "y-codemirror.next";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { readAgents } from "./agentAwareness.ts";
import {
  agentChangeLog,
  resolveAgentChanges,
  type AgentChange,
  type ClockRange,
} from "./changeLog.ts";
import {
  agentChangesConfig,
  arrivingEntries,
  agentLog,
  agentLogField,
  liveTurns,
  setAgentLog,
  setLiveTurns,
  type AgentLogState,
} from "./changeState.ts";
import { closeGhostPopover, ghostDecorations, ghostPopoverStale } from "./ghosts.ts";
import { prefersReducedMotion } from "./reveal.ts";

export {
  clearAgentChanges,
  observeAgentChanges,
  readAgentChanges,
  type AgentChange,
  type AgentChangeAuthor,
  type AgentChangeOp,
} from "./changeLog.ts";
export {
  acceptAgentChange,
  acceptTurn,
  dismissAgentDeletion,
  nextAgentChange,
  previousAgentChange,
  restoreAgentDeletion,
  revertAgentChange,
  revertTurn,
} from "./changeCommands.ts";
export { agentChangeBar } from "./changeBar.ts";
export { revealAgentChanges, type RevealOptions } from "./reveal.ts";

/** A run of text inserted by one Yjs client, in index space after the transaction. */
export interface ClientInsertion {
  from: number;
  to: number;
  client: number;
}

/** A run of one client's characters that one transaction inserted, with consecutive clocks. */
interface InsertedRun extends ClientInsertion {
  /** The Yjs clock of the run's first character; the rest follow one per character. */
  clock: number;
}

/**
 * The runs of `event.target` that agent clients inserted in this transaction, split
 * wherever the clocks stop being consecutive.
 */
function insertedRuns(event: Y.YTextEvent, agentClients: ReadonlySet<number>): InsertedRun[] {
  // Cheap prefilter so a user's keystroke never walks the text: only a client whose
  // state-vector clock advanced in this transaction can have inserted anything.
  const { beforeState, afterState } = event.transaction;
  let agentWrote = false;
  for (const client of agentClients) {
    if ((afterState.get(client) ?? 0) > (beforeState.get(client) ?? 0)) {
      agentWrote = true;
      break;
    }
  }
  if (!agentWrote) return [];

  // `event.changes.added` stays empty for Y.Text events, so walk the items and ask
  // `event.adds`, which compares each item's clock with the pre-transaction state vector.
  // The walk reads the private `_start` / `right` item list: no public Yjs API yields the
  // text's items with their client ids (per-client history needs `gc: false` snapshots),
  // which is why package.json pins `yjs` to an exact version.
  const runs: InsertedRun[] = [];
  let index = 0;
  for (let item = event.target._start; item !== null; item = item.right) {
    if (item.deleted || !item.countable) continue;
    const { client, clock } = item.id;
    if (agentClients.has(client) && event.adds(item)) {
      const last = runs.at(-1);
      if (
        last &&
        last.to === index &&
        last.client === client &&
        last.clock + (last.to - last.from) === clock
      ) {
        last.to += item.length;
      } else {
        runs.push({ from: index, to: index + item.length, client, clock });
      }
    }
    index += item.length;
  }
  return runs;
}

/**
 * The ranges of `event.target` that agent clients inserted in this transaction. Attribution
 * reads the Yjs client id of each inserted item, because transaction origins do not travel
 * over the wire. Positions are indexes into the text as it stands after the transaction.
 */
export function agentInsertions(
  event: Y.YTextEvent,
  agentClients: ReadonlySet<number>,
): ClientInsertion[] {
  const insertions: ClientInsertion[] = [];
  for (const { from, to, client } of insertedRuns(event, agentClients)) {
    const last = insertions.at(-1);
    if (last && last.to === from && last.client === client) last.to = to;
    else insertions.push({ from, to, client });
  }
  return insertions;
}

interface AgentRange extends InsertedRun {
  color: string;
}

/** A client's clock range whose characters lose their marks (their entry left the log). */
interface ClockCarve extends ClockRange {
  client: number;
}

const addAgentRanges = StateEffect.define<readonly AgentRange[]>();
const carveAgentClocks = StateEffect.define<readonly ClockCarve[]>();

interface StoredMarkSpec {
  color: string;
  client: number;
  clock: number;
}

/**
 * A stored insertion mark: it knows the client and the clock of its first character, so a
 * character's clock is the mark's clock plus its offset into the mark. Marks are cut
 * wherever that stops holding (text typed or deleted inside), so it holds for every piece.
 */
function storedMark(spec: StoredMarkSpec): Decoration {
  return Decoration.mark({
    class: "atlas-agent-change",
    attributes: { style: `--atlas-agent-color: ${spec.color}` },
    ...spec,
  });
}

function markSpec(mark: Decoration): StoredMarkSpec {
  const { color, client, clock } = mark.spec;
  return { color: String(color), client: Number(client), clock: Number(clock) };
}

/** The piece of `mark` (which starts at `markFrom`) that starts at `from`. */
function markFrom(mark: Decoration, markFromPos: number, from: number) {
  const spec = markSpec(mark);
  return from === markFromPos
    ? mark
    : storedMark({ ...spec, clock: spec.clock + from - markFromPos });
}

const displayMarks = new Map<string, Decoration>();

function displayMark(color: string, settled: boolean): Decoration {
  const key = settled ? `${color} settled` : color;
  let mark = displayMarks.get(key);
  if (!mark) {
    mark = Decoration.mark({
      class: settled ? "atlas-agent-change atlas-agent-change-settled" : "atlas-agent-change",
      attributes: { style: `--atlas-agent-color: ${color}` },
    });
    displayMarks.set(key, mark);
  }
  return mark;
}

/** Removes `[from, to)` from every agent range it falls inside, splitting ranges it cuts. */
function carve(ranges: DecorationSet, from: number, to: number): DecorationSet {
  const pieces: Range<Decoration>[] = [];
  let overlaps = false;
  ranges.between(from, to, (rangeFrom, rangeTo, mark) => {
    if (rangeFrom >= to || rangeTo <= from) return;
    overlaps = true;
    if (rangeFrom < from) pieces.push(mark.range(rangeFrom, from));
    if (rangeTo > to) pieces.push(markFrom(mark, rangeFrom, to).range(to, rangeTo));
  });
  if (!overlaps) return ranges;
  return ranges.update({
    filterFrom: from,
    filterTo: to,
    filter: (rangeFrom, rangeTo) => rangeFrom >= to || rangeTo <= from,
    add: pieces,
    sort: true,
  });
}

/** The positions of the marked characters whose client and clock fall in `carves`. */
function clockPositions(ranges: DecorationSet, carves: readonly ClockCarve[]) {
  const positions: { from: number; to: number }[] = [];
  for (let iter = ranges.iter(); iter.value; iter.next()) {
    const { client, clock } = markSpec(iter.value);
    const length = iter.to - iter.from;
    for (const cut of carves) {
      if (cut.client !== client) continue;
      const from = Math.max(clock, cut.from);
      const to = Math.min(clock + length, cut.to);
      if (from < to) positions.push({ from: iter.from + from - clock, to: iter.from + to - clock });
    }
  }
  return positions;
}

// Agent ranges live in CodeMirror positions and map through every change. Every change
// cuts the ranges it lands in before mapping (so each piece's first clock stays true), and
// any insertion carves itself out of the ranges it lands in, so text typed inside an
// agent's insertion is never attributed to the agent; agent insertions are added back by
// `addAgentRanges`, and an entry leaving the log carves out exactly its write's characters.
const agentRangesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(ranges, tr) {
    let next = ranges;
    if (tr.docChanged) {
      // Cut at every change first, in the old positions: deleted text leaves its mark and
      // an insertion point splits the mark, so no piece spans foreign or missing text.
      tr.changes.iterChangedRanges((fromA, toA) => {
        next = carve(next, fromA, toA);
      });
      next = next.map(tr.changes);
      tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
        if (toB > fromB) next = carve(next, fromB, toB);
      });
    }
    for (const effect of tr.effects) {
      if (effect.is(carveAgentClocks)) {
        for (const range of clockPositions(next, effect.value)) {
          next = carve(next, range.from, range.to);
        }
      }
      if (!effect.is(addAgentRanges)) continue;
      const length = tr.state.doc.length;
      next = next.update({
        add: effect.value
          .filter((range) => range.from < range.to && range.to <= length)
          .map((range) => storedMark(range).range(range.from, range.to)),
        sort: true,
      });
    }
    return next;
  },
});

/** The insertion marks, drawn dimmer where their write's entry is settled. */
function insertionMarks(ranges: DecorationSet, log: AgentLogState | undefined): DecorationSet {
  const settled = log?.entries.filter((entry) => !log.live.has(entry.turnId)) ?? [];
  if (settled.length === 0) return ranges;
  const marks: Range<Decoration>[] = [];
  for (let iter = ranges.iter(); iter.value; iter.next()) {
    const { color, client, clock } = markSpec(iter.value);
    // A mark piece is one write's characters, so its first clock names the write.
    const isSettled = settled.some(
      (entry) => entry.client === client && entry.clock.from <= clock && clock < entry.clock.to,
    );
    marks.push(displayMark(color, isSettled).range(iter.from, iter.to));
  }
  return Decoration.set(marks, true);
}

/** The clock ranges of entries that left the log. */
function leftClocks(before: readonly AgentChange[], after: readonly AgentChange[]): ClockCarve[] {
  const kept = new Set(after.map((entry) => entry.id));
  return before
    .filter((entry) => !kept.has(entry.id))
    .map((entry) => ({ client: entry.client, ...entry.clock }));
}

const agentChangesTheme = EditorView.baseTheme({
  ".atlas-agent-change": {
    backgroundColor:
      "color-mix(in srgb, var(--atlas-agent-color) var(--atlas-agent-change-strength, 22%), transparent)",
    borderRadius: "2px",
  },
  // A settled turn's changes stay reviewable, drawn dimmer.
  ".atlas-agent-change.atlas-agent-change-settled": {
    backgroundColor:
      "color-mix(in srgb, var(--atlas-agent-color) var(--atlas-agent-change-settled-strength, 10%), transparent)",
  },
  ".atlas-agent-ghost": {
    color: "color-mix(in srgb, var(--atlas-agent-color) 70%, currentColor)",
    backgroundColor:
      "color-mix(in srgb, var(--atlas-agent-color) var(--atlas-agent-ghost-strength, 10%), transparent)",
    borderRadius: "2px",
    whiteSpace: "pre-wrap",
    cursor: "pointer",
  },
  ".atlas-agent-ghost-text": { textDecorationColor: "var(--atlas-agent-color)" },
  ".atlas-agent-ghost-more": {
    marginLeft: "0.4em",
    fontSize: "0.85em",
    opacity: "0.8",
  },
  ".atlas-agent-ghost.atlas-agent-change-settled": { opacity: "0.6" },
  // A ghost of a write that just landed fades in once; reduced motion skips it.
  "@keyframes atlas-agent-ghost-arrive": { from: { opacity: "0" } },
  ".atlas-agent-ghost-arriving": { animation: "atlas-agent-ghost-arrive 300ms ease-out" },
  "@media (prefers-reduced-motion: reduce)": {
    ".atlas-agent-ghost-arriving": { animation: "none" },
  },
  ".atlas-agent-ghost-popover": {
    position: "fixed",
    zIndex: "100",
    display: "flex",
    gap: "2px",
    padding: "3px",
    border: "1px solid var(--atlas-md-border-color, #e4e0d8)",
    borderRadius: "6px",
    background: "var(--atlas-md-menu-bg, #ffffff)",
    color: "var(--atlas-md-menu-color, #1f1d1a)",
    boxShadow: "var(--atlas-md-menu-shadow, 0 6px 20px rgba(31, 29, 26, 0.16))",
    fontSize: "0.85em",
    lineHeight: "1.4",
  },
  "&dark .atlas-agent-ghost-popover": {
    borderColor: "var(--atlas-md-border-color, #33312d)",
    background: "var(--atlas-md-menu-bg, #24221f)",
    color: "var(--atlas-md-menu-color, #ebe8e2)",
  },
  ".atlas-agent-ghost-action, .atlas-agent-bar-button": {
    font: "inherit",
    padding: "0.2em 0.6em",
    border: "none",
    borderRadius: "4px",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
  },
  ".atlas-agent-ghost-action:hover, .atlas-agent-ghost-action-focused, .atlas-agent-bar-button:hover":
    { background: "var(--atlas-md-menu-hover-bg, rgba(127, 127, 127, 0.14))" },
  ".atlas-agent-bar": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px",
    padding: "4px 8px",
    fontSize: "0.8em",
    background: "var(--atlas-bg, inherit)",
  },
  ".atlas-agent-bar-count": { flex: "1", opacity: "0.75" },
});

/**
 * Agent changes in `text`: highlights what agent peers insert, in each agent's colour, and
 * shows the agent change log (`applyFileText` with a `log` author records it) as ghosts
 * for what each write deleted, dimmed once no agent presence carries the entry's turn.
 * Agents are the awareness states declared with `declareAgent`. Use alongside
 * `yCollab(text, …)` on the same view: ranges are recorded when Yjs applies the agent's
 * update and handed to the view once the transaction settles, by which point `yCollab`
 * has already applied the change. Review it with the commands this module exports, or add
 * `agentChangeBar()`.
 *
 * Attribution only sees agents that `awareness` knows about when their text arrives: an
 * insertion that lands before the agent's awareness state is never highlighted, and nothing
 * re-scans later. Each agent's awareness must be bound to the `Y.Doc` it writes with, since
 * its awareness client id is what matches the inserted items.
 *
 * Colours here pass through `safeAgentColor`, but y-codemirror.next writes remote
 * `user.color` / `user.colorLight` straight into style attributes, so a provider must
 * sanitise remote awareness colours before `yCollab` reads them.
 */
export function agentChanges(text: Y.Text, awareness: Awareness): Extension {
  const recorder = ViewPlugin.define((view) => {
    const doc = text.doc;
    const log = doc ? agentChangeLog(doc) : null;
    let pending: AgentRange[] = [];
    let textChanged = false;

    const onTextEvent = (event: Y.YTextEvent) => {
      textChanged = true;
      const agents = readAgents(awareness);
      if (agents.size === 0) return;
      for (const insertion of insertedRuns(event, new Set(agents.keys()))) {
        const agent = agents.get(insertion.client);
        if (agent) pending.push({ ...insertion, color: agent.color });
      }
    };
    // Runs once Yjs has called every observer, so `yCollab` has already mirrored the
    // transaction into the view and the log resolves against the same text the view shows.
    // A transaction this view's own sync made is skipped: it runs inside a view update, and
    // the log field maps local edits itself.
    const afterTransaction = (tr: Y.Transaction) => {
      const effects: StateEffect<unknown>[] = [];
      if (pending.length > 0) effects.push(addAgentRanges.of(pending));
      pending = [];
      const moved = textChanged && tr.origin !== view.state.facet(ySyncFacet);
      textChanged = false;
      const current = agentLog(view.state)?.entries ?? [];
      const logChanged = log !== null && tr.changed.has(log);
      if (doc && log && (logChanged || (moved && (current.length > 0 || log.length > 0)))) {
        const entries = resolveAgentChanges(doc, text, view.state.doc.length);
        const left = leftClocks(current, entries);
        if (left.length > 0) effects.push(carveAgentClocks.of(left));
        effects.push(setAgentLog.of(entries));
      }
      if (effects.length > 0) view.dispatch({ effects });
    };
    // Only a remote presence gaining or dropping a turn changes the live set; the user's own
    // cursor updates (made inside view updates) leave it equal and dispatch nothing.
    const onAwareness = () => {
      const live = liveTurns(awareness);
      const before = agentLog(view.state)?.live;
      if (before && before.size === live.size && [...live].every((turn) => before.has(turn))) {
        return;
      }
      view.dispatch({ effects: setLiveTurns.of(live) });
    };

    text.observe(onTextEvent);
    doc?.on("afterTransaction", afterTransaction);
    awareness.on("change", onAwareness);
    return {
      update(update) {
        const entries = agentLog(update.state)?.entries ?? [];
        const stillThere = (id: string, opIndex: number) =>
          entries.some((entry) => {
            const op = entry.id === id ? entry.ops[opIndex] : undefined;
            return op !== undefined && op.deleted !== "" && !op.dismissed;
          });
        if (ghostPopoverStale(update.view, stillThere)) closeGhostPopover(update.view);
      },
      destroy() {
        text.unobserve(onTextEvent);
        doc?.off("afterTransaction", afterTransaction);
        awareness.off("change", onAwareness);
        closeGhostPopover(view);
      },
    };
  });
  return [
    agentChangesConfig.of({ text, awareness }),
    agentRangesField,
    agentLogField,
    EditorView.decorations.compute([agentRangesField, agentLogField], (state) =>
      insertionMarks(state.field(agentRangesField), agentLog(state)),
    ),
    EditorView.decorations.compute([agentLogField, arrivingEntries], (state) =>
      ghostDecorations(agentLog(state), state.facet(arrivingEntries)),
    ),
    recorder,
    agentChangesTheme,
  ];
}

/** A vertical band of the window, in client coordinates. */
export interface Band {
  top: number;
  bottom: number;
}

/**
 * Whether a position drawn at `coords` lies inside `band`. A position with no coordinates
 * (outside the rendered viewport) and an empty band (an editor off screen or not laid out)
 * show nothing.
 */
export function visibleIn(coords: Band | null, band: Band): boolean {
  return (
    coords !== null &&
    band.bottom > band.top &&
    coords.top >= band.top &&
    coords.bottom <= band.bottom
  );
}

/** Space at the top and bottom of the window that the host's chrome covers. */
export interface Insets {
  top: number;
  bottom: number;
}

/**
 * The part of the window where the editor's content can be seen: the scroller's box, cut to
 * the window, minus the insets.
 */
function editorBand(view: EditorView, insets: Insets): Band {
  const scroller = view.scrollDOM.getBoundingClientRect();
  const windowHeight = view.dom.ownerDocument.defaultView?.innerHeight ?? scroller.bottom;
  return {
    top: Math.max(scroller.top, insets.top),
    bottom: Math.min(scroller.bottom, windowHeight - insets.bottom),
  };
}

/**
 * The `yMargin` that, with `EditorView.scrollIntoView(pos, { y: "start", yMargin })`, puts a
 * position `height` tall at the middle of `band` inside the scrolling `container` (both in
 * client coordinates): CodeMirror then scrolls so the position's top sits `yMargin` below the
 * container's top. When the band is too short for the centre, the position goes to the
 * band's top; with no insets this is the container's own centre.
 */
export function placementMargin(band: Band, container: Band, height: number): number {
  const centred = (band.top + band.bottom) / 2 - height / 2;
  const top = Math.max(band.top, Math.min(centred, band.bottom - height));
  return top - container.top;
}

/** How the follower scrolls: easing, or at once (reduced motion). */
export type FollowBehavior = "smooth" | "instant";

/** One element that can scroll the editor, and how far it can go each way from here. */
interface ScrollStep {
  element: Element | Window;
  /** The furthest it can scroll up (zero or negative) and down (zero or positive). */
  min: number;
  max: number;
}

/**
 * Everything that can scroll the editor into view, innermost first, as CodeMirror's
 * `scrollIntoView` walks it: the scroller and each ancestor with content to scroll, then
 * the window.
 */
function scrollChain(view: EditorView): ScrollStep[] {
  const doc = view.dom.ownerDocument;
  const steps: ScrollStep[] = [];
  for (
    let node: Element | null = view.scrollDOM;
    node && node !== doc.body && node !== doc.documentElement;
    node = node.parentElement
  ) {
    if (node.scrollHeight > node.clientHeight) {
      steps.push({
        element: node,
        min: -node.scrollTop,
        max: node.scrollHeight - node.clientHeight - node.scrollTop,
      });
    }
  }
  const window = doc.defaultView;
  if (window) {
    const root = doc.scrollingElement ?? doc.documentElement;
    steps.push({
      element: window,
      min: -window.scrollY,
      max: Math.max(0, root.scrollHeight - window.innerHeight - window.scrollY),
    });
  }
  return steps;
}

/**
 * Splits `distance` over `chain` the way CodeMirror does: each element scrolls as far as its
 * remaining range allows and passes the rest outward. Calls `scroll` once per element that
 * moves.
 */
function scrollAlong(
  chain: readonly ScrollStep[],
  distance: number,
  scroll: (container: Element | Window, top: number, behavior: FollowBehavior) => void,
  behavior: FollowBehavior,
) {
  let rest = distance;
  for (const step of chain) {
    if (rest === 0) break;
    const take = Math.min(Math.max(rest, step.min), step.max);
    if (take === 0) continue;
    scroll(step.element, take, behavior);
    rest -= take;
  }
}

/**
 * Where `pos`'s line is on screen: measured (`coords`) when the line is drawn, else estimated
 * from the height map (unrendered lines have estimated heights, hence the settle check).
 */
function lineBox(view: EditorView, pos: number, coords: Band | null): Band {
  if (coords) return { top: coords.top, bottom: coords.bottom };
  const block = view.lineBlockAt(pos);
  const top = view.documentTop + block.top;
  return { top, bottom: top + block.height };
}

/**
 * Scrolls `container` by `top` pixels. `instant` rather than `auto`, which would follow a
 * page's CSS `scroll-behavior: smooth` and animate under reduced motion anyway.
 */
function nativeScroll(container: Element | Window, top: number, behavior: FollowBehavior) {
  container.scrollBy({ top, behavior });
}

/** How long a smooth scroll is given to finish before the follower checks where it landed. */
const SETTLE_MS = 450;

export interface FollowOptions {
  /** Read at each agent cursor move: whether following is switched on. */
  isOn: () => boolean;
  /** Chrome covering the window's top and bottom (a sticky header), measured when needed. */
  insets?: () => Insets;
  /**
   * The band in which a position counts as visible, when it is not the editor's box in the
   * window minus the insets (and for tests, which have no layout).
   */
  band?: (view: EditorView) => Band;
  /** Scrolls one container by `top` pixels; defaults to the native `scrollBy`. */
  scroll?: (container: Element | Window, top: number, behavior: FollowBehavior) => void;
  /** Runs `done` after `ms` milliseconds; returns a cancel function. */
  wait?: (done: () => void, ms: number) => () => void;
}

const NO_INSETS: Insets = { top: 0, bottom: 0 };

/** An awareness state's cursor head, and a key to compare it by. */
function cursorKey(state: Record<string, unknown> | undefined) {
  const cursor: unknown = state?.cursor;
  const head: unknown = cursor ? Reflect.get(Object(cursor), "head") : undefined;
  return { head, key: JSON.stringify(head ?? null) };
}

/**
 * Keeps agent cursors in view while `isOn()` is true: when an agent presence's cursor moves
 * to a position that is not visible, the view scrolls to centre it. Agents move their cursor
 * to where they are about to write before the write lands (`parkAgentCursor`), so the write
 * lands where the person is already looking. Visible means inside the editor's box in the
 * window, minus the `insets` the host's chrome covers, and the scroll centres the position
 * in that band rather than in the window. The scroll is the browser's smooth scroll of the
 * scroller and its scrolling ancestors up to the window, each taking what its range allows
 * (instant under reduced motion), checked once more after it settles. A cursor move within view scrolls
 * nothing, the caret, selection, and focus are never touched, and log changes, reviews, and
 * the user's own edits never scroll.
 *
 * The follower starts from the cursors as they are when it mounts, reacts only to agents'
 * awareness changes, and scrolls in a microtask, never inside an editor update (a change
 * can arrive from yCollab's own cursor sync, which runs in one).
 *
 * Presentation never moves the scroll position on a remote change (live-preview spec,
 * principle 5); this is the one exception, and the person switches it on. Needs
 * `agentChanges` on the same view.
 */
export function followAgentChanges(options: FollowOptions): Extension {
  const { isOn, insets = () => NO_INSETS, scroll: scrollBy = nativeScroll } = options;
  const band = options.band ?? ((view: EditorView) => editorBand(view, insets()));
  const wait =
    options.wait ??
    ((done: () => void, ms: number) => {
      const id = setTimeout(done, ms);
      return () => clearTimeout(id);
    });
  return ViewPlugin.define((view) => {
    const config = view.state.facet(agentChangesConfig);
    if (!config) return {};
    const { text, awareness } = config;
    // The last cursor head seen per agent, seeded from the cursors already parked, so only a
    // move scrolls: not mounting, a turn ending, or a name changing.
    const heads = new Map<number, string>();
    const states = awareness.getStates();
    for (const client of readAgents(awareness).keys()) {
      heads.set(client, cursorKey(states.get(client)).key);
    }
    let destroyed = false;
    // The latest moved cursor head, kept relative: text that lands before the microtask runs
    // moves where it points, so it is resolved only then.
    let pending: unknown = undefined;
    // The settle check of the last scroll; a newer move replaces it.
    let cancelSettle: (() => void) | null = null;

    /**
     * Scrolls the container so the head's line sits at the band's centre, if it is outside
     * the band. The follower scrolls the container itself rather than dispatching a
     * CodeMirror scroll, so the browser eases it and a wheel movement interrupts it.
     */
    const follow = (head: unknown, settled: boolean) => {
      const doc = text.doc;
      if (destroyed || !doc || !isOn()) return;
      const index = resolveCursor(doc, head, text);
      if (index === null) return;
      const pos = Math.min(index, view.state.doc.length);
      const coords = view.coordsAtPos(pos);
      const visible = band(view);
      if (visibleIn(coords, visible)) return;
      const line = lineBox(view, pos, coords);
      // Centre within the band, not the window, so the chrome the insets describe never
      // covers where the write lands; the band is in client coordinates, so measure from 0.
      const target = placementMargin(visible, { top: 0, bottom: 0 }, line.bottom - line.top);
      const behavior = prefersReducedMotion() ? "instant" : "smooth";
      scrollAlong(scrollChain(view), line.top - target, scrollBy, behavior);
      if (settled) return;
      // Unrendered lines have estimated heights: once the scroll has settled, look again
      // with the line drawn, and correct once if it still is not in the band.
      cancelSettle = wait(() => {
        cancelSettle = null;
        follow(head, true);
      }, SETTLE_MS);
    };

    const scroll = () => {
      const head = pending;
      pending = undefined;
      if (head === undefined) return;
      cancelSettle?.();
      cancelSettle = null;
      follow(head, false);
    };

    const onChange = (change: { added: number[]; updated: number[]; removed: number[] }) => {
      for (const client of change.removed) heads.delete(client);
      const agents = readAgents(awareness);
      const current = awareness.getStates();
      let moved: unknown = undefined;
      for (const client of [...change.added, ...change.updated]) {
        if (!agents.has(client)) continue;
        const { head, key } = cursorKey(current.get(client));
        if (heads.get(client) === key) continue;
        heads.set(client, key);
        if (head) moved = head;
      }
      if (moved === undefined) return;
      const scheduled = pending !== undefined;
      pending = moved;
      if (!scheduled) queueMicrotask(scroll);
    };
    awareness.on("change", onChange);
    return {
      destroy() {
        destroyed = true;
        cancelSettle?.();
        awareness.off("change", onChange);
      },
    };
  });
}

/** The index a remote awareness cursor position points at in `text`, or null. */
function resolveCursor(doc: Y.Doc, head: unknown, text: Y.Text): number | null {
  try {
    const position = Y.createRelativePositionFromJSON(head);
    const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc);
    return absolute && absolute.type === text ? absolute.index : null;
  } catch {
    return null;
  }
}

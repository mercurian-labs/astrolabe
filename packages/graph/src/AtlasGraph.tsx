/**
 * A thin React wrapper around a `GraphRenderer`: it derives universe, layout, reading, and view
 * from props; the renderer owns every frame. `createRenderer` builds it, so a host loads only the
 * renderer it draws with (the app: `createLeanRenderer`). A new factory keeps selection, pick,
 * play, and flat view. Hosts import `@mercurian/graph/styles.css` once and set the `--atlas-*`
 * properties (see `render/theme.ts`) on an ancestor.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";

import { LayoutCache } from "./layout/homeLayout.ts";
import { GatheringCache } from "./layout/gatheredReading.ts";
import { mapsPlacing, lensPlacement } from "./model/lenses.ts";
import type { Boundaries, Memory, MemoryLink } from "./model/memory.ts";
import {
  closeContainer,
  frameCapacity,
  openContainer,
  readingNotes,
  revealNotes,
  sameClosed,
  spanLevel,
  storyLevel,
} from "./model/level.ts";
import {
  focusAtLevel,
  pickedPlays,
  playFocus,
  removalsAt,
  memoryBefore,
  type PlayFocus,
  type PlayPick,
} from "./model/plays.ts";
import {
  applyFeatures,
  boundaryIndex,
  crossingText,
  dataFlowCounts,
  shownLinks,
  silhouettes,
  type Silhouette,
} from "./model/features.ts";
import { readingAt, threadIndex, threadUniverse, type Reading } from "./model/reading.ts";
import type { GraphFilters } from "./model/search.ts";
import type { GraphSettings } from "./model/settings.ts";
import { kindLine, sourceLine } from "./model/kinds.ts";
import {
  firstParagraph,
  noteSource,
  noteText,
  turnGrew,
  type ThreadRecord,
  type ThreadTurn,
} from "./model/thread.ts";
import { buildUniverse, growUniverse, type Universe } from "./model/universe.ts";
import { deriveView } from "./model/view.ts";
import { cursorRows, turnTour, type TourInner, type TourVisit } from "./model/tour.ts";
import { CursorPlays } from "./CursorPlays.tsx";
import { popoverPlace } from "./render/cursor.ts";
import type { CursorAt } from "./render/storyteller.ts";
import type { BenchDriver } from "./render/probe.ts";
import {
  handover,
  isFlatMode,
  type BenchResult,
  type GraphRenderer,
  type Handover,
  type HoverTarget,
  type RenderMode,
  type RendererFactory,
  type RendererStats,
} from "./render/renderer.ts";

export interface AtlasGraphHandle {
  /** Frame the shown notes; in a codebase, at the level that tells the whole reading. */
  fit(): void;
  /**
   * Open whatever closed containers hold the notes of `pick` (a play, or
   * several) and frame them: what choosing a symbol's play by hand does.
   */
  reveal(pick: PlayPick): void;
  resumeFollowing(): void;
  stats(now: number): RendererStats;
  /** Glide every node for about three seconds and report the frame times; null before a renderer exists. */
  bench(seconds?: number): Promise<BenchResult | null>;
  /** Let go of the picked note, if any. */
  clearPick(): void;
  /** The bench's hold on the current renderer, or null before one exists. */
  driver(): BenchDriver | null;
}

export interface AtlasLayoutInfo {
  readonly ms: number;
  readonly nodes: number;
  readonly edges: number;
  readonly shownNodes: number;
  readonly shownEdges: number;
  readonly flat: boolean;
  readonly mode: RenderMode;
}

export interface AtlasGraphProps {
  readonly memory: Memory;
  /** The thread beside which the graph stands; without one, the graph shows the whole memory. */
  readonly thread?: ThreadRecord | null;
  /** The checkpoint whose reading to show, as an index into the thread's turns. */
  readonly checkpoint?: number;
  /** Show every note ("whole memory") instead of only what the thread reached. */
  readonly whole?: boolean;
  /** Narrow the reading to the checkpoint's own turn. */
  readonly thisTurnOnly?: boolean;
  /**
   * The selected play of the checkpoint's turn, by its place in the turn's
   * events, or several (a file's plays): it becomes the story (its notes in
   * front, its links alone in full) and holds until cleared. The host clears
   * it when the checkpoint changes.
   */
  readonly play?: PlayPick | null;
  /** Escape in the graph clears the selected play (after any pick). */
  readonly onPlayChange?: (play: PlayPick | null) => void;
  /**
   * The agent's cursor reached a play (its place in the turn), or left the
   * last (null): light the play-by-play's row in step.
   */
  readonly onCursor?: (play: number | null) => void;
  /**
   * The notes the record lists as removed (a code story's `removed`): a turn
   * whose unlink leaves one with no link removes it, and says so.
   */
  readonly removed?: ReadonlyArray<string>;
  /**
   * The agent is working a turn: the landing story holds while it runs, and
   * falls after its landing window once it ends. A running turn alone moves nothing.
   */
  readonly turnRunning?: boolean;
  /**
   * How the graph is drawn: "3d" (the web in space), "flat" (the same web
   * settled with z pinned, under an orthographic camera), or the flat reading
   * on a stripped-down 2D renderer: "lean" (Three.js) or "pixi" (Pixi.js).
   */
  readonly mode?: RenderMode;
  /**
   * Builds the renderer for `mode`: `createLeanRenderer` for "lean", or one of `RENDERERS`
   * (`render/renderers.ts`, the playground's). Keep its identity: a new one replaces the renderer.
   */
  readonly createRenderer: RendererFactory;
  readonly settings: GraphSettings;
  readonly filters: GraphFilters;
  /** Shown lenses, by position in `memory.lenses`. */
  readonly lensSlots?: ReadonlyArray<number>;
  /** A written note was clicked: open it in the editor. */
  readonly onOpenNote?: (id: string) => void;
  /** A frontier node was clicked: open the frontier door for it. */
  readonly onFrontier?: (id: string) => void;
  readonly onFollowingChange?: (following: boolean) => void;
  /**
   * The turn's moves in a popover beside the agent's cursor, standing in for
   * its chip (see `CursorPlays`): the host opens and closes it. Choosing a
   * row goes through `onPlayChange`.
   */
  readonly popover?: boolean;
  /** The chip was clicked (open it) or the popover closed: the host decides. */
  readonly onPopoverChange?: (open: boolean) => void;
  /**
   * When the following chip shows: "always" (saying so while following), or
   * "paused" (only once the reader took the camera, with Resume).
   */
  readonly showFollowing?: "always" | "paused";
  /**
   * Draw only the story's group and its parent as regions, the ancestors above
   * them bare and named as the parent's path: for a narrow panel. Off, every
   * open container draws.
   */
  readonly quietAncestors?: boolean;
  /**
   * Open the folders that hold the story while the frame can hold what shows
   * (see `spanLevel`'s `fill`): a story spanning the repository's top reads as
   * its folders, and a wider frame shows at least what a narrower one did.
   */
  readonly fillFrame?: boolean;
  readonly onLayout?: (info: AtlasLayoutInfo) => void;
  /** A font file (woff, ttf, or otf) for labels. */
  readonly labelFont?: string;
  /** Changing this re-reads the `--atlas-*` colors. */
  readonly themeKey?: string;
  /** A codebase's declared layers and the crossings it allows (drawn while `settings.features.boundaries`). */
  readonly boundaries?: Boundaries;
  readonly ref?: Ref<AtlasGraphHandle>;
}

const NO_SILHOUETTES: ReadonlyArray<Silhouette> = [];

/** How long a hover lingers before the popover opens. */
const POPOVER_DELAY_MS = 500;
const NO_LENSES: ReadonlyArray<number> = [];
const NO_CLOSED: ReadonlySet<number> = new Set();
const NO_REMOVED: ReadonlyArray<string> = [];
const NO_REMOVALS: ReadonlyMap<number, string> = new Map();
const NO_VISITS: ReadonlyArray<TourVisit> = [];
/** The level's frame until the host is measured: about 1100 × 760 pixels. */
const DEFAULT_CAPACITY = frameCapacity(1100, 760);

/** The reader's drilling at one reading: the closed containers, and what they opened (last first to close). */
interface Drill {
  readonly key: string;
  readonly closed: ReadonlySet<number>;
  readonly opened: ReadonlyArray<number>;
}

/** Whether `container` holds `note`, at any depth (or is it). */
function holdsNote(universe: { readonly parentOf: Int32Array }, container: number, note: number) {
  for (let at = note; at >= 0; at = universe.parentOf[at] ?? -1) if (at === container) return true;
  return false;
}

/**
 * The checkpoint each thread last landed on, across every graph on the page: a graph
 * mounted again (a tab switch, a panel that moved to a wide pane) frames that checkpoint
 * without landing it again, so its tour does not replay.
 */
const landings = new Map<string, number>();

/** Layouts are cached per memory and forces, across every graph on the page. */
const layoutCache = new LayoutCache();
/** Gathered readings, cached per layout and reading options, across every graph on the page. */
const gatheringCache = new GatheringCache();

export function AtlasGraph(props: AtlasGraphProps) {
  const {
    memory: givenMemory,
    thread: givenThread = null,
    checkpoint = 0,
    whole = false,
    thisTurnOnly = false,
    play = null,
    onPlayChange,
    onCursor,
    removed = NO_REMOVED,
    turnRunning = false,
    mode = "3d",
    createRenderer,
    settings,
    filters,
    lensSlots = NO_LENSES,
    onOpenNote,
    onFrontier,
    onFollowingChange,
    popover: cursorPopover = false,
    onPopoverChange,
    showFollowing = "always",
    quietAncestors = false,
    fillFrame = false,
    onLayout,
    labelFont,
    themeKey,
    boundaries,
    ref,
  } = props;
  // The design features: data and failure flow change what the memory holds (see `applyFeatures`).
  const { features } = settings;
  const { memory, thread } = useMemo(
    () =>
      applyFeatures(givenMemory, givenThread, {
        dataEdges: features.dataEdges,
        failureEdges: features.failureEdges,
      }),
    [givenMemory, givenThread, features.dataEdges, features.failureEdges],
  );
  const anyFeature = Object.values(features).some(Boolean);
  const hostRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<GraphRenderer | null>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  /** The flat view and following state a replaced renderer leaves for the next one. */
  const carried = useRef<Handover | null>(null);
  /** The universe the current renderer was handed, and the reading it last framed. */
  const shown = useRef<{ readonly renderer: GraphRenderer; readonly universe: unknown } | null>(
    null,
  );
  const followed = useRef<{ readonly renderer: GraphRenderer; readonly key: string } | null>(null);
  const landed = useRef<string | null>(null);
  // A pick belongs to the universe it was made in: a new memory starts with nothing picked.
  const [pick, setPick] = useState<{ readonly universe: string; readonly id: string } | null>(null);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [lingered, setLingered] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  /** The play the agent's cursor is telling: the popover lights its visit's rows. */
  const [cursorPlay, setCursorPlay] = useState<number | null>(null);
  /** The cursor as last drawn, and the popover riding beside it, placed outside React. */
  const cursorAt = useRef<CursorAt | null>(null);
  const popoverElement = useRef<HTMLDivElement | null>(null);
  const placePopover = useRef(() => {
    const element = popoverElement.current;
    const at = cursorAt.current;
    if (element === null || at === null) return;
    // Its natural height first (a cap it was given earlier would feed back into the choice).
    element.style.maxHeight = "";
    const { left, top, maxHeight } = popoverPlace(
      at,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: at.width, height: at.height },
    );
    element.style.maxHeight = maxHeight === null ? "" : `${Math.floor(maxHeight)}px`;
    element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    element.dataset.placed = "true";
  });

  const built = useMemo(
    () =>
      thread === null
        ? buildUniverse(memory.id, memory)
        : // The thread's index is the one every reading overlays: built once, shared.
          buildUniverse(
            `${memory.id}/${thread.id}`,
            threadUniverse(memory, thread),
            threadIndex(memory, thread),
          ),
    [memory, thread],
  );
  // A thread that grew (its working turn wrote a file) keeps every note's index, so the
  // renderer, the cursor's tour, and what it has told carry on (see `growUniverse`). The
  // universe last shown is kept from render to render, as React keeps a previous value.
  const [grown, setGrown] = useState<{ built: Universe; universe: Universe }>(() => ({
    built,
    universe: built,
  }));
  let universe = grown.universe;
  if (grown.built !== built) {
    universe = growUniverse(grown.universe, built);
    setGrown({ built, universe });
  }
  const pickedId = pick !== null && pick.universe === universe.key ? pick.id : null;
  const flat = isFlatMode(mode);
  const { centerForce, repelForce, linkDistance } = settings;
  const layout = useMemo(
    () => layoutCache.get(universe, { centerForce, repelForce, linkDistance }, flat ? 2 : 3),
    [universe, centerForce, repelForce, linkDistance, flat],
  );
  const reading = useMemo(
    () =>
      thread === null
        ? null
        : readingAt(memory, thread, checkpoint, { depth: settings.depth, thisTurnOnly }),
    [memory, thread, checkpoint, settings.depth, thisTurnOnly],
  );
  // The thread's reading gathers its notes to the front; the whole memory rests at home.
  const inReading = thread !== null && !whole;
  // The plays of this checkpoint's turn that remove a note, and those notes.
  const removals = useMemo(
    () =>
      thread === null || removed.length === 0
        ? NO_REMOVALS
        : removalsAt(memory, thread, checkpoint, removed),
    [memory, thread, checkpoint, removed],
  );
  const removedNow = useMemo(() => new Set(removals.values()), [removals]);

  // A codebase's reading is told at a level (`model/level.ts`): each landing
  // closes containers by the span of its story and what fits the frame; the
  // reader drills in and out from there until the reading moves.
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    // The frame's real size, once laid out: a host hidden or mid-resize (0 × 0) keeps the
    // level it had rather than collapsing to a frame that holds nothing.
    const measure = () => {
      if (host.clientWidth <= 0 || host.clientHeight <= 0) return;
      setCapacity(frameCapacity(host.clientWidth, host.clientHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  // The level's frame is chosen at each landing from the frame's size. A resize re-fits it only
  // while the tour is in (the cursor tells nothing and nothing is drilled open): a tour out, or a
  // reader's drill, keeps its level, so a change of size never re-lands or restarts the tour.
  const [drill, setDrill] = useState<Drill | null>(null);
  const landingKey = `${universe.key}/${checkpoint}/${settings.depth}/${thisTurnOnly}/${inReading}`;
  const [fit, setFit] = useState({ key: landingKey, capacity });
  let levelCapacity = fit.capacity;
  const quiet =
    cursorPlay === null && (drill === null || drill.key !== `${landingKey}/${fit.capacity}`);
  if (fit.key !== landingKey || (fit.capacity !== capacity && quiet)) {
    levelCapacity = capacity;
    setFit({ key: landingKey, capacity });
  }
  const level = useMemo(
    () =>
      universe.tree && inReading
        ? {
            key: `capacity ${levelCapacity}${fillFrame ? " filled" : ""}`,
            closedAt: (at: Reading) => storyLevel(universe, at, levelCapacity, fillFrame),
          }
        : undefined,
    [universe, inReading, levelCapacity, fillFrame],
  );
  const held = useMemo(
    () => (reading === null || level === undefined ? [] : readingNotes(universe, reading)),
    [universe, reading, level],
  );
  const ownClosed = useMemo(
    () => (level === undefined || reading === null ? NO_CLOSED : level.closedAt(reading)),
    [level, reading],
  );
  const levelKey = `${landingKey}/${levelCapacity}`;
  const drilled = drill !== null && drill.key === levelKey ? drill : null;
  const closed = drilled?.closed ?? ownClosed;
  /** What the camera frames once the next view lands: the reading (a Fit), or these notes. */
  const frameNext = useRef<"fit" | ReadonlyArray<number> | null>(null);
  const drillTo = (
    next: ReadonlySet<number>,
    opened: ReadonlyArray<number>,
    frame: "fit" | ReadonlyArray<number> | null,
  ) => {
    frameNext.current = frame;
    setDrill({ key: levelKey, closed: next, opened });
  };

  // The containers opened past the landing's level (by the tour or a drill): their inner structure draws quietly.
  const opened = useMemo(
    () => new Set([...ownClosed].filter((container) => !closed.has(container))),
    [ownClosed, closed],
  );
  // Boundaries: the declared layers over the universe, only while the feature is on.
  const layered = useMemo(
    () =>
      features.boundaries && boundaries !== undefined && universe.tree
        ? boundaryIndex(universe, boundaries)
        : undefined,
    [features.boundaries, boundaries, universe],
  );
  // The layers draw as regions at the survey level only: nothing opened past the landing's.
  const showLayers = layered !== undefined && level !== undefined && opened.size === 0;
  const view = useMemo(
    () =>
      deriveView({
        universe,
        lenses: memory.lenses,
        shownLensSlots: lensSlots,
        reading,
        whole: whole || thread === null,
        pickedId,
        depth: settings.depth,
        filters,
        ...(level === undefined ? {} : { closed, opened }),
        removedNow,
        ...(anyFeature ? { features } : {}),
        ...(layered === undefined ? {} : { boundaries: layered, showLayers }),
        quietAncestors,
      }),
    [
      quietAncestors,
      anyFeature,
      features,
      layered,
      showLayers,
      opened,
      removedNow,
      universe,
      memory.lenses,
      lensSlots,
      reading,
      whole,
      thread,
      pickedId,
      settings.depth,
      filters,
      level,
      closed,
    ],
  );
  const { nodeSize, depth } = settings;
  const gathering = useMemo(() => {
    if (!inReading || thread === null) return null;
    const context = {
      memory,
      thread,
      universe,
      layout,
      settings: { depth, nodeSize, linkDistance },
      thisTurnOnly,
      filters,
      ...(level === undefined ? {} : { level }),
    };
    // A pick lights and grows notes where they stand: it never regathers the reading.
    return gatheringCache.at(context, checkpoint, drilled === null ? undefined : drilled.closed);
  }, [
    level,
    drilled,
    inReading,
    memory,
    thread,
    universe,
    layout,
    depth,
    nodeSize,
    linkDistance,
    thisTurnOnly,
    filters,
    checkpoint,
  ]);

  const turn = thread?.turns[checkpoint];
  // The turn's moves at the level shown, for the agent's cursor: each play's
  // note as what shows for it. (The renderer ignores the same moves handed again.)
  // The notes as the turn found them: what its plays are named against.
  const before = useMemo(
    () => (thread === null ? null : memoryBefore(memory, thread, checkpoint)),
    [memory, thread, checkpoint],
  );
  // The cursor's tour, at the level the landing chose: a container the turn
  // worked inside opens as the cursor reaches it (see `model/tour.ts`).
  // `only` tells those plays alone: what a working turn appended.
  const tourOf = useCallback(
    (only: ReadonlySet<number> | null = null): ReadonlyArray<TourVisit> => {
      if (turn === undefined || !inReading || before === null) return NO_VISITS;
      const viewAt = (at: ReadonlySet<number>) =>
        deriveView({
          universe,
          lenses: memory.lenses,
          shownLensSlots: [],
          reading,
          whole: false,
          pickedId: null,
          depth: settings.depth,
          filters,
          ...(level === undefined ? {} : { closed: at }),
          removedNow,
        });
      return turnTour(turn, universe, ownClosed, viewAt, held, before, removals, only);
    },
    [
      turn,
      inReading,
      before,
      universe,
      memory.lenses,
      reading,
      settings.depth,
      filters,
      level,
      removedNow,
      ownClosed,
      held,
      removals,
    ],
  );
  const moves = useMemo(() => tourOf(), [tourOf]);
  const focus = useMemo(
    () =>
      play === null || turn === undefined
        ? null
        : focusAtLevel(playFocus(universe, turn, play), view, universe),
    [universe, turn, play, view],
  );

  // Silhouettes: the shapes the shown graph makes, found again whenever the view changes.
  const shapes = useMemo(
    () =>
      features.silhouettes
        ? silhouettes(
            shownLinks(
              universe,
              view,
              (link) => reading === null || reading.linkStands(link),
              (link) => (reading === null ? link.resolution : reading.linkResolution(link)),
            ),
            (index) => universe.nodes[index]?.kind,
          )
        : NO_SILHOUETTES,
    [features.silhouettes, universe, view, reading],
  );
  const [tagHover, setTagHover] = useState<{
    readonly shapes: ReadonlyArray<Silhouette>;
    readonly index: number;
  } | null>(null);
  useEffect(() => {
    renderer?.setTags(shapes);
  }, [renderer, shapes]);
  // A hovered tag lights its members, and the shown links among them quietly, in place of the play.
  const hovered =
    tagHover !== null && tagHover.shapes === shapes ? shapes[tagHover.index] : undefined;
  const lit = useMemo((): PlayFocus | null => {
    if (hovered === undefined) return focus;
    const members = new Set(hovered.members);
    const quiet = [...view.edges].filter((index) => {
      const edge = universe.edges[index];
      return edge !== undefined && members.has(edge.a) && members.has(edge.b);
    });
    return { kind: "many", nodes: hovered.members, links: [], quiet };
  }, [hovered, focus, view, universe]);
  // The renderer's tag callback outlives renders: it reads the tags it was handed through a ref.
  const shapesRef = useRef(shapes);
  useLayoutEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  // The renderer's callbacks outlive renders; they read the latest props through a ref.
  const fitRef = useRef(() => {});
  const revealRef = useRef((_pick: PlayPick) => {});
  useLayoutEffect(() => {
    fitRef.current = () => {
      if (level === undefined) rendererRef.current?.fit();
      else drillTo(spanLevel(universe, held, held, levelCapacity, fillFrame), [], "fit");
    };
    revealRef.current = (pick) => {
      if (level === undefined || turn === undefined) return;
      const notes = pickedPlays(pick)
        .flatMap((index) => {
          const event = turn.events[index];
          if (event === undefined || event.kind === "resolve") return [];
          return event.kind === "link" || event.kind === "unlink"
            ? [event.from, event.to]
            : [event.note];
        })
        .map((id) => universe.indexOf.get(id))
        .filter((index): index is number => index !== undefined);
      // What a reveal opens is the reader's: a tour passing through leaves it open.
      const next = revealNotes(universe, closed, notes, held);
      const opening = [...closed].filter((container) => !next.has(container));
      drillTo(next, [...(drilled?.opened ?? []), ...opening], notes);
    };
  });

  // Drilling: a closed container opens to its children, an open one closes again.
  const openAt = (index: number) =>
    drillTo(
      openContainer(universe, closed, index, held),
      [...(drilled?.opened ?? []), index],
      [index],
    );
  const closeAt = (index: number) =>
    drillTo(
      closeContainer(universe, closed, index),
      (drilled?.opened ?? []).filter((each) => each !== index),
      [index],
    );
  // The tour opens a container to tell inside it and closes only what it opened, on the drill as it
  // stands (the reader may have changed it meanwhile). Back at the landing's level with nothing of
  // the reader's open, the survey is the level again. The camera glides in and out only while
  // following.
  const tourOpened = useRef<{ key: string; containers: Set<number> }>({
    key: "",
    containers: new Set(),
  });
  const tourDrill = (inner: TourInner, open: boolean) => {
    if (tourOpened.current.key !== levelKey) {
      tourOpened.current = { key: levelKey, containers: new Set() };
    }
    const mine = tourOpened.current.containers;
    const standing = (prev: Drill | null) => (prev?.key === levelKey ? prev : null);
    if (open) {
      const current = standing(drill);
      if (!(current?.closed ?? ownClosed).has(inner.container)) return;
      mine.add(inner.container);
      if (following) frameNext.current = [inner.container];
      setDrill((prev) => {
        const now = standing(prev);
        return {
          key: levelKey,
          closed: openContainer(universe, now?.closed ?? ownClosed, inner.container, held),
          opened: now?.opened ?? [],
        };
      });
      return;
    }
    // Back out: the renderer returns the camera to where the survey stood before opening.
    if (!mine.delete(inner.container)) return;
    frameNext.current = null;
    setDrill((prev) => {
      const now = standing(prev);
      const next = closeContainer(universe, now?.closed ?? ownClosed, inner.container);
      const opened = now?.opened ?? [];
      return sameClosed(next, ownClosed) && opened.length === 0
        ? null
        : { key: levelKey, closed: next, opened };
    });
  };
  const latest = useRef({
    universe,
    reading,
    onOpenNote,
    onFrontier,
    onFollowingChange,
    onCursor,
    cursorPopover,
    onPopoverChange,
    closed,
    view,
    openAt,
    closeAt,
    tourDrill,
  });
  useLayoutEffect(() => {
    latest.current = {
      universe,
      reading,
      onOpenNote,
      onFrontier,
      onFollowingChange,
      onCursor,
      cursorPopover,
      onPopoverChange,
      closed,
      view,
      openAt,
      closeAt,
      tourDrill,
    };
  });

  // One renderer per factory; "3d" and "flat" share the Atlas renderer and glide between each other.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const created = createRenderer(host, {
      onHover: setHover,
      onPick: (index) => {
        const { universe, reading, onOpenNote, onFrontier, closed, view } = latest.current;
        const node = universe.nodes[index];
        if (node === undefined) return;
        // A closed container opens instead of being picked.
        if (closed.has(index) && view.nodeAt.has(index)) {
          latest.current.openAt(index);
          return;
        }
        setPick({ universe: universe.key, id: node.id });
        const note = (reading?.state ?? universe.index).byId.get(node.id);
        if (note?.frontier === true) onFrontier?.(node.id);
        else onOpenNote?.(node.id);
      },
      onBackground: () => setPick(null),
      onRegion: (index) => latest.current.closeAt(index),
      onCursor: (play) => {
        setCursorPlay(play);
        latest.current.onCursor?.(play);
      },
      onCursorChip: () => {
        const { onPopoverChange, cursorPopover } = latest.current;
        if (onPopoverChange === undefined) setPick(null);
        else onPopoverChange(!cursorPopover);
      },
      onCursorAt: (at) => {
        cursorAt.current = at;
        placePopover.current();
      },
      onTag: (index) => setTagHover(index === null ? null : { shapes: shapesRef.current, index }),
      onCursorDrill: (inner, open) => latest.current.tourDrill(inner, open),
      onFollowingChange: (value) => {
        setFollowing(value);
        latest.current.onFollowingChange?.(value);
      },
    });
    rendererRef.current = created;
    setRenderer(created);
    return () => {
      // A new renderer is a cut: it takes over this one's flat view.
      carried.current = { view: created.flatView(), following: created.following };
      created.dispose();
      rendererRef.current = null;
      setHover(null);
    };
  }, [createRenderer]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => fitRef.current(),
      reveal: (pick) => revealRef.current(pick),
      resumeFollowing: () => rendererRef.current?.resumeFollowing(),
      bench: (seconds) => rendererRef.current?.bench(seconds) ?? Promise.resolve(null),
      clearPick: () => setPick(null),
      driver: () => rendererRef.current?.driver() ?? null,
      stats: (now) =>
        rendererRef.current?.stats(now) ?? {
          mode: "3d",
          drawCalls: 0,
          renderMs: [0, 0],
          prepMs: [0, 0],
          framesLastSecond: 0,
          totalFrames: 0,
          animating: false,
          inView: 0,
          slots: 0,
          shown: 0,
          labels: 0,
          radiusPx: [0, 0, 0],
          edgePx: [0, 0],
          beads: 0,
        },
    }),
    [],
  );

  // Declared before the graph so a new graph starts with the right font, settings, and colors.
  useEffect(() => {
    renderer?.setLabelFont(labelFont);
  }, [renderer, labelFont]);

  useEffect(() => {
    renderer?.setSettings(settings);
  }, [renderer, settings]);

  useEffect(() => {
    renderer?.setThemeKey(themeKey);
  }, [renderer, themeKey]);

  useEffect(() => {
    renderer?.setTurnRunning(turnRunning);
  }, [renderer, turnRunning]);

  useEffect(() => {
    if (renderer === null) return;
    if (shown.current?.renderer !== renderer || shown.current.universe !== universe) {
      shown.current = { renderer, universe };
      renderer.setGraph(universe, layout, flat);
    } else {
      renderer.setLayout(layout, flat);
    }
  }, [renderer, universe, layout, flat]);

  useEffect(() => {
    if (renderer === null) return;
    renderer.setView(view, { gathering, reading: inReading, layout, thisTurnOnly });
    // A drill or a Fit frames once its view has landed.
    const frame = frameNext.current;
    frameNext.current = null;
    if (frame === "fit") renderer.fit();
    else if (frame !== null) {
      const shownFor = (index: number) => view.holders.get(index) ?? index;
      const inside = held.filter((note) => frame.some((top) => holdsNote(universe, top, note)));
      // Only what shows now: a container that just opened is a region, no longer a node.
      const shownNow = [...new Set((inside.length > 0 ? inside : frame).map(shownFor))].filter(
        (index) => view.nodeAt.has(index),
      );
      renderer.frame(shownNow);
    }
  }, [renderer, view, gathering, inReading, layout, thisTurnOnly, held, universe]);

  // A level re-fitted to a resized frame (the tour in, nothing drilled) is framed anew, while
  // following: the survey fits the frame it is now.
  const refitted = useRef<{ readonly key: string; readonly capacity: number } | null>(null);
  useEffect(() => {
    if (renderer === null) return;
    const last = refitted.current;
    refitted.current = { key: landingKey, capacity: levelCapacity };
    if (last?.key === landingKey && last.capacity !== levelCapacity && renderer.following) {
      renderer.fit();
    }
  }, [renderer, landingKey, levelCapacity]);

  // Declared before the landing: a landing tours the checkpoint's own moves. The same turn
  // grown (the agent wrote another file) extends the tour instead: the cursor goes on to
  // tell what is new without telling the rest again.
  const toldTurn = useRef<{
    readonly renderer: GraphRenderer;
    readonly key: string;
    readonly checkpoint: number;
    readonly turn: ThreadTurn | undefined;
  } | null>(null);
  useEffect(() => {
    if (renderer === null) return;
    const last = toldTurn.current;
    const extend =
      last !== null &&
      last.renderer === renderer &&
      last.key === universe.key &&
      last.checkpoint === checkpoint &&
      last.turn !== turn &&
      turnGrew(last.turn, turn);
    toldTurn.current = { renderer, key: universe.key, checkpoint, turn };
    if (!extend || last.turn === undefined || turn === undefined) {
      renderer.setMoves(moves);
      return;
    }
    // The tour of the appended plays alone: in their order, with their own verbs.
    const appended = new Set<number>();
    for (let play = last.turn.events.length; play < turn.events.length; play += 1) {
      appended.add(play);
    }
    renderer.setMoves(moves, tourOf(appended));
    // While following, the camera glides to keep the grown story in the frame.
    renderer.follow(view.risen);
  }, [renderer, moves, tourOf, universe.key, checkpoint, turn, view.risen]);

  // The gathered reading is framed, if following, whenever the checkpoint or
  // its narrowing changes. Each checkpoint lands once: its story lights and its
  // new links ring; narrowing to the turn is not a landing.
  // A new renderer frames the reading too, but a checkpoint already landed is not landed again.
  useEffect(() => {
    if (renderer === null) return;
    const key = `${universe.key}/${checkpoint}/${thisTurnOnly}`;
    if (followed.current?.renderer === renderer && followed.current.key === key) return;
    followed.current = { renderer, key };
    renderer.follow(view.risen);
    const landing = `${universe.key}/${checkpoint}`;
    if (landed.current === landing) return;
    const remounted = landed.current === null && landings.get(universe.key) === checkpoint;
    landed.current = landing;
    landings.set(universe.key, checkpoint);
    if (!remounted) renderer.landLinks();
  }, [renderer, universe, view, checkpoint, thisTurnOnly]);

  useEffect(() => {
    renderer?.setPlay(lit);
  }, [renderer, lit]);

  // One play chosen puts the agent's cursor on it, once the turn's visits are in; letting go sends it home.
  useEffect(() => {
    if (renderer === null) return;
    if (play === null) renderer.cursorTo(null);
    else if (typeof play === "number" && moves.some((visit) => visit.plays.includes(play))) {
      renderer.cursorTo(play);
    }
  }, [renderer, play, moves]);

  // After a cut between families, the new renderer takes over the old one's
  // flat view (when both are flat) and, always, whether it was following.
  useEffect(() => {
    const plan = handover(carried.current, flat);
    if (renderer === null || plan === null) return;
    carried.current = null;
    renderer.adoptView(plan.view, plan.following);
    setFollowing(renderer.following);
  }, [renderer, flat]);

  useEffect(() => {
    onLayout?.({
      ms: layout.ms,
      nodes: universe.nodes.length,
      edges: universe.edges.length,
      shownNodes: view.shownNodes,
      shownEdges: view.shownEdges,
      flat,
      mode,
    });
  }, [onLayout, layout, universe, view, flat, mode]);

  const hoverKey = hover === null ? null : `${hover.kind}:${hover.index}`;
  useEffect(() => {
    if (hoverKey === null || !hoverKey.startsWith("node:")) return;
    const timer = setTimeout(() => setLingered(hoverKey), POPOVER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hoverKey]);
  const popover = hoverKey !== null && lingered === hoverKey;

  // Escape lets go of the pick first, then closes what the reader last opened, then the selected play.
  const playSelected = focus !== null;
  const lastOpened = drilled?.opened.at(-1);
  useEffect(() => {
    if (pickedId === null && !playSelected && lastOpened === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pickedId !== null) setPick(null);
      else if (lastOpened !== undefined) latest.current.closeAt(lastOpened);
      else onPlayChange?.(null);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [pickedId, playSelected, onPlayChange, lastOpened]);

  // The popover: open while the host says so and the turn has moves to list.
  const popoverShown = cursorPopover && inReading && turn !== undefined && turn.events.length > 0;
  useEffect(() => {
    renderer?.setCursorPopover(popoverShown);
  }, [renderer, popoverShown]);
  // The rows lit: the chosen plays, else the play the cursor is on. The other plays its visit
  // stands for (a file amended twice, told once) carry a quieter mark, never the full light.
  const { lit: litPlays, near: nearPlays } = useMemo(
    () => cursorRows(play === null ? null : pickedPlays(play), cursorPlay, moves),
    [play, cursorPlay, moves],
  );
  // Choosing a row is choosing a play by hand: a single move opens whatever closed container holds it.
  const choosePlay = (pick: PlayPick | null) => {
    onPlayChange?.(pick);
    if (typeof pick === "number") revealRef.current(pick);
  };
  // Placed as it opens and whenever its size changes; the cursor's moves place it in between.
  useLayoutEffect(() => {
    const element = popoverElement.current;
    if (!popoverShown || element === null) return;
    placePopover.current();
    const observer = new ResizeObserver(() => placePopover.current());
    observer.observe(element);
    return () => observer.disconnect();
  }, [popoverShown]);

  const state = reading?.state ?? universe.index;
  const placement = useMemo(
    () => lensPlacement(memory.lenses, lensSlots),
    [memory.lenses, lensSlots],
  );

  let overlay = null;
  if (hover?.kind === "node" && popover) {
    const id = universe.nodes[hover.index]?.id;
    const note = id === undefined ? undefined : state.byId.get(id);
    if (id !== undefined && note !== undefined) {
      const outgoing = [...(state.outgoing.get(id) ?? [])];
      const redLinks = outgoing.filter((target) => state.byId.get(target)?.frontier === true);
      const maps = mapsPlacing(memory.lenses, id);
      // A codebase's note says what it is (in its shape's glyph) and where it is defined.
      const kind = universe.nodes[hover.index]?.kind;
      const parent = universe.nodes[universe.parentOf[hover.index] ?? -1]?.name;
      const source = thread === null ? null : noteSource(thread, checkpoint, id);
      // Signatures: the declaration and the doc's first paragraph, the latest the record gives.
      const signature = features.signatures
        ? ((thread === null ? undefined : noteText(thread, checkpoint, id, "signature")) ??
          note.signature)
        : undefined;
      const doc = features.signatures
        ? ((thread === null ? undefined : noteText(thread, checkpoint, id, "doc")) ?? note.doc)
        : undefined;
      // Data flow: how many standing functions take or give this type.
      const flows =
        features.dataEdges && (kind === "type" || kind === "interface" || kind === "enum")
          ? dataFlowCounts(
              universe,
              hover.index,
              (link) => reading === null || reading.linkStands(link),
            )
          : null;
      overlay = (
        <div className="atlas-popover" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {kind === undefined ? null : (
            <div className="atlas-popover-kind">{kindLine(kind, parent)}</div>
          )}
          {signature === undefined ? null : (
            <code className="atlas-popover-signature">{signature}</code>
          )}
          {doc === undefined || firstParagraph(doc) === "" ? null : (
            <div className="atlas-popover-doc">{firstParagraph(doc)}</div>
          )}
          {flows === null ? null : (
            <div className="atlas-popover-flow">
              accepted by {flows.accepted} · returned by {flows.returned}
            </div>
          )}
          <div className="atlas-popover-name">{note.name}</div>
          {source === null ? null : (
            <div className="atlas-popover-source">{sourceLine(source.path, source.range)}</div>
          )}
          <dl>
            <dt>Links</dt>
            <dd>
              {state.incoming.get(id)?.size ?? 0} in · {outgoing.length} out
            </dd>
            <dt>Maps</dt>
            <dd>{maps.length > 0 ? maps.join(", ") : "none"}</dd>
            <dt>Red links</dt>
            <dd>{redLinks.length > 0 ? redLinks.join(", ") : "none"}</dd>
            {note.frontier ? (
              <>
                <dt>State</dt>
                <dd>not yet written</dd>
              </>
            ) : note.lastChanged === undefined ? null : (
              <>
                <dt>Changed</dt>
                <dd>{note.lastChanged}</dd>
              </>
            )}
          </dl>
        </div>
      );
    }
  } else if (hover?.kind === "edge") {
    const key = universe.edges[hover.index]?.key;
    const names = key === undefined ? [] : (placement.edgeNames.get(key) ?? []);
    // A codebase's links say what they are (calls, inherits…) and how sure the indexer was.
    const typed = (universe.edgeLinks[hover.index] ?? []).filter(
      (link) => link.kind !== undefined && (reading === null || reading.linkStands(link)),
    );
    const nameOf = (id: string) => state.byId.get(id)?.name ?? id;
    // How sure each link is now: a re-resolution replayed up to the checkpoint.
    const resolutionOf = (link: MemoryLink) =>
      reading === null ? link.resolution : reading.linkResolution(link);
    const crossing = (link: MemoryLink) =>
      layered === undefined || boundaries === undefined
        ? null
        : crossingText(boundaries, layered, universe, link, resolutionOf(link));
    if (names.length > 0 || typed.length > 0) {
      overlay = (
        <div
          className="atlas-popover atlas-edge-tip"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          {typed.map((link) => (
            <div key={`${link.from}/${link.to}/${link.kind}`}>
              <b>{link.kind}</b>
              {resolutionOf(link) === undefined ? null : (
                <span className="atlas-muted"> ({resolutionOf(link)})</span>
              )}
              <div className="atlas-muted">
                {nameOf(link.from)} → {nameOf(link.to)}
              </div>
              {crossing(link) === null ? null : (
                <div className="atlas-popover-warning">{crossing(link)}</div>
              )}
            </div>
          ))}
          {names.map((name) => (
            <div key={`${name.lens}/${name.from}/${name.to}`}>
              <span className={`atlas-lens-swatch atlas-lens-${name.slot + 1}`} />
              <b>{name.type}</b> <span className="atlas-muted">({name.lens})</span>
              <div className="atlas-muted">
                {name.from} → {name.to}
              </div>
            </div>
          ))}
        </div>
      );
    }
  }

  return (
    <div className="atlas-graph">
      <div ref={hostRef} className="atlas-graph-canvas" />
      {overlay}
      {popoverShown && turn !== undefined && before !== null ? (
        <CursorPlays
          ref={popoverElement}
          turn={turn}
          notes={before}
          removals={removals}
          selected={play}
          lit={litPlays}
          near={nearPlays}
          onSelect={choosePlay}
          onClose={() => onPopoverChange?.(false)}
        />
      ) : null}
      {thread !== null && (showFollowing === "always" || !following) ? (
        <div className="atlas-following" data-following={following}>
          {following ? (
            <span>Following the agent</span>
          ) : (
            <>
              <span>Not following</span>
              <button type="button" onClick={() => rendererRef.current?.resumeFollowing()}>
                Resume
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

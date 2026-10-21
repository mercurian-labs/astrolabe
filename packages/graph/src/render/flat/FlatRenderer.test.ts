import { Vector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import almagest from "../../../fixtures/almagest.json";
import graphModelStory from "../../../../code-graph/fixtures/graph-model.story.json";
import { syntheticMemory } from "../../../fixtures/synthetic.ts";
import { syntheticThread } from "../../../fixtures/syntheticThread.ts";
import { ATLAS_THREAD } from "../../../fixtures/thread.ts";
import {
  DEGREE_SCALE_CAP,
  layoutUniverse,
  READING_RADIUS_SHARE,
} from "../../layout/forceLayout.ts";
import { FORCE_LAYOUT_LIMIT, proceduralLayout } from "../../layout/proceduralLayout.ts";
import { GatheringCache } from "../../layout/gatheredReading.ts";
import { gatheringOffset } from "../../layout/gathering.ts";
import { playFocus } from "../../model/plays.ts";
import type { Memory } from "../../model/memory.ts";
import { readingAt, threadIndex, threadUniverse } from "../../model/reading.ts";
import type { ThreadRecord } from "../../model/thread.ts";
import { NO_FILTERS } from "../../model/search.ts";
import { DEFAULT_SETTINGS } from "../../model/settings.ts";
import { buildUniverse, growUniverse, type Universe } from "../../model/universe.ts";
import { deriveView } from "../../model/view.ts";
import { READING_PIXELS, readingFrame, storyCentre } from "../camera.ts";
import type { WorkCounter } from "../renderer.ts";
import type { FrameClock } from "../scheduler.ts";
import { applyTargets } from "../targets.ts";
import type { FlatDrawer, FlatFrame } from "./drawer.ts";
import { EdgeAttention } from "../../model/attention.ts";
import { memoryBefore } from "../../model/plays.ts";
import { turnTour, type TourInner } from "../../model/tour.ts";
import { StyleChannel } from "../nodeState.ts";
import { FlatRenderer } from "./FlatRenderer.ts";

// The lean and pixi drawers need WebGL, which happy-dom does not provide, so
// these tests drive the shared flat controller with a drawer that records the
// frames it is handed. The drawers themselves are walked in a browser.

/** Every ResizeObserver the renderers made, as a way to say "the host was resized". */
const resizeObservers: Array<() => void> = [];
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(callback: () => void) {
      resizeObservers.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);

function manualClock() {
  let pending: ((now: number) => void) | null = null;
  let now = 1000;
  const clock: FrameClock = {
    request: (callback) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  };
  return {
    clock,
    get pending() {
      return pending !== null;
    },
    get now() {
      return now;
    },
    /** Let `ms` pass with no frame (a timer's wait). */
    advance(ms: number) {
      now += ms;
    },
    run(limit = 2000) {
      let frames = 0;
      while (pending !== null && frames < limit) {
        const callback = pending;
        pending = null;
        now += 16;
        callback(now);
        frames += 1;
      }
      return frames;
    },
  };
}

/**
 * `renderMs` is what the recording drawer reports for its render call; null
 * renders nothing. `whole` shows the whole memory (no gathering). `synced`
 * runs performance.now and timers on the manual clock, for what the renderer
 * times by the wall clock (rises, the story's fall).
 */
function setup(
  renderMs: number | null = 2.5,
  {
    whole = false,
    synced = false,
    memory = almagest,
    thread = ATLAS_THREAD,
    counter,
    observe = (built) => built,
    sized = true,
  }: {
    whole?: boolean;
    synced?: boolean;
    memory?: Memory;
    thread?: ThreadRecord;
    counter?: WorkCounter;
    /** Stand in for the universe, e.g. to count what reads it. */
    observe?: (universe: Universe) => Universe;
    /** The host has its size from the start (false: 0 × 0 until the test sizes it). */
    sized?: boolean;
  } = {},
) {
  const universe = observe(
    buildUniverse(
      `${memory.id}/thread`,
      threadUniverse(memory, thread),
      threadIndex(memory, thread),
    ),
  );
  const layout =
    universe.nodes.length > FORCE_LAYOUT_LIMIT
      ? proceduralLayout(universe, DEFAULT_SETTINGS, 2)
      : layoutUniverse(universe, DEFAULT_SETTINGS, 2);
  const context = {
    memory,
    thread,
    universe,
    layout,
    settings: DEFAULT_SETTINGS,
    thisTurnOnly: false,
    filters: NO_FILTERS,
  };
  const cache = new GatheringCache();
  const gathering = whole ? null : cache.at(context, 0);
  const viewAt = (checkpoint: number, pickedId: string | null = null) =>
    deriveView({
      universe,
      lenses: memory.lenses,
      shownLensSlots: [],
      reading: readingAt(memory, thread, checkpoint, { depth: 1, thisTurnOnly: false }),
      whole,
      pickedId,
      depth: 1,
      filters: NO_FILTERS,
    });
  const view = viewAt(0);
  const container = document.createElement("div");
  if (sized) {
    Object.defineProperty(container, "clientWidth", { value: 1000 });
    Object.defineProperty(container, "clientHeight", { value: 700, configurable: true });
  }
  document.body.append(container);
  const frames: Array<
    Pick<FlatFrame, "camera" | "inView" | "labels" | "marks" | "agent"> & {
      /** The keys of the edges beads run on this frame. */
      readonly beadEdges: ReadonlyArray<string>;
    }
  > = [];
  let last: FlatFrame | null = null;
  const drawer: FlatDrawer = {
    setGraph: () => {},
    setLabelFont: () => {},
    draw: (frame) => {
      last = frame;
      frames.push({
        camera: frame.camera,
        inView: frame.inView,
        labels: frame.labels,
        marks: frame.marks,
        agent: frame.agent,
        beadEdges: Array.from(frame.beads.edge.subarray(0, frame.beads.count)).map(
          (slot) => frame.universe.edges[slot]?.key ?? "",
        ),
      });
      return renderMs;
    },
    resize: () => {},
    drawCalls: 3,
    edgesDrawn: 0,
    gl: null,
    memory: () => ({ textures: null, buffers: null }),
    dispose: () => {},
  };
  const callbacks = {
    onHover: vi.fn(),
    onPick: vi.fn(),
    onBackground: vi.fn(),
    onFollowingChange: vi.fn(),
    onCursor: vi.fn<(play: number | null) => void>(),
    /** The host's answer to the tour opening or closing a container; a test sets it. */
    drill: (_inner: TourInner, _open: boolean): void => {},
    onCursorDrill: (inner: TourInner, open: boolean) => callbacks.drill(inner, open),
  };
  const time = manualClock();
  if (synced) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockImplementation(() => time.now);
  }
  const renderer = new FlatRenderer(container, callbacks, "lean", () => drawer, {
    clock: time.clock,
    ...(counter === undefined ? {} : { counter }),
  });
  renderer.setSettings(DEFAULT_SETTINGS);
  renderer.setGraph(universe, layout);
  renderer.setView(view, { layout, gathering, reading: !whole, thisTurnOnly: false });
  renderer.follow(view.risen);
  const frame = () => {
    if (last === null) throw new Error("nothing drawn yet");
    return last;
  };
  return {
    renderer,
    container,
    frames,
    time,
    callbacks,
    gathering,
    view,
    universe,
    layout,
    viewAt,
    gatheringAt: (checkpoint: number) => cache.at(context, checkpoint),
    frame,
  };
}

/** A renderer's flat view, which it has once it has shown a view. */
function shownView(renderer: FlatRenderer) {
  const view = renderer.flatView();
  if (view === null) throw new Error("no view shown yet");
  return view;
}

describe("a fresh load", () => {
  it("hands no picture over from a renderer that never showed a view (a double mount)", () => {
    const container = document.createElement("div");
    const drawer: FlatDrawer = {
      setGraph: () => {},
      setLabelFont: () => {},
      draw: () => 1,
      resize: () => {},
      drawCalls: 0,
      edgesDrawn: 0,
      gl: null,
      memory: () => ({ textures: null, buffers: null }),
      dispose: () => {},
    };
    const unshown = new FlatRenderer(
      container,
      { onHover: vi.fn(), onPick: vi.fn(), onBackground: vi.fn(), onFollowingChange: vi.fn() },
      "lean",
      () => drawer,
      { clock: manualClock().clock },
    );
    expect(unshown.flatView()).toBeNull();
    unshown.dispose();
  });

  it("opens at the reading density once a late-sized host gets its size, as Fit would", () => {
    const { renderer, container, time, frame } = setup(2.5, { sized: false });
    time.run();
    // Sized only now: the opening frame is the one Fit gives.
    Object.defineProperty(container, "clientWidth", { value: 1000 });
    Object.defineProperty(container, "clientHeight", { value: 700 });
    resizeObservers.at(-1)?.();
    time.run();
    const opened = shownView(renderer).scale;
    const lone = frame().state.drawnRadius(frame().view.risen[0] ?? 0) * opened;
    renderer.fit();
    time.run();
    expect(shownView(renderer).scale).toBeCloseTo(opened, 6);
    expect(lone).toBeGreaterThan(3);
    renderer.dispose();
  });
});

describe("the flat controller", () => {
  it("opens at the reading density on the turn's story, then sleeps", () => {
    const { renderer, frames, time, gathering, view, frame } = setup();
    time.run();
    expect(time.pending).toBe(false);
    const last = frames.at(-1);
    expect(last).toBeDefined();
    const reading = readingFrame([...(gathering?.positions.values() ?? [])], () => 0);
    // Exactly the reading density: never zoomed out to fit.
    expect(last?.camera.scale).toBeCloseTo(READING_PIXELS / (reading?.span ?? 1), 6);
    // Centred on the story's notes where they land.
    const { state, view: slotView } = frame();
    const story = slotView.story.length > 0 ? slotView.story : slotView.risen;
    expect(story.length).toBeGreaterThan(0);
    const landing = (slot: number) =>
      new Vector3(
        (state.rest[slot * 3] ?? 0) + (state.offsets.targets[slot * 3] ?? 0),
        (state.rest[slot * 3 + 1] ?? 0) + (state.offsets.targets[slot * 3 + 1] ?? 0),
        0,
      );
    const reach = ((700 / 2) * (reading?.span ?? 1)) / READING_PIXELS;
    const centre = storyCentre(story.map(landing), reach);
    expect(last?.camera.x).toBeCloseTo(centre?.x ?? NaN, 3);
    expect(last?.camera.y).toBeCloseTo(centre?.y ?? NaN, 3);
    const inView = [...(last?.inView ?? [])].filter((flag) => flag === 1).length;
    expect(inView).toBeGreaterThan(0);
    const labelled = [...(last?.labels.opacity ?? [])].filter((opacity) => opacity > 0).length;
    expect(labelled).toBeGreaterThan(0);
    const stats = renderer.stats(0);
    expect(stats).toMatchObject({ mode: "lean", drawCalls: 3, inView });
    expect(view.shownNodes).toBeGreaterThanOrEqual(inView);
    // Render time is the drawer's render call alone; the rest of the frame is preparation.
    expect(stats.renderMs).toEqual([2.5, 2.5]);
    expect(stats.prepMs[1]).toBeGreaterThanOrEqual(stats.prepMs[0]);
    renderer.dispose();
  });

  it("times nothing for a frame whose drawer rendered nothing", () => {
    const { renderer, frames, time } = setup(null);
    time.run();
    expect(frames.length).toBeGreaterThan(0);
    expect(renderer.stats(0)).toMatchObject({ renderMs: [0, 0], prepMs: [0, 0] });
    renderer.dispose();
  });

  it("takes over another renderer's flat view and following state without a jump", () => {
    const { renderer, time, callbacks } = setup();
    time.run();
    renderer.adoptView({ x: 12, y: -7, scale: 3 }, false);
    expect(renderer.flatView()).toEqual({ x: 12, y: -7, scale: 3 });
    expect(renderer.following).toBe(false);
    expect(callbacks.onFollowingChange).toHaveBeenCalledWith(false);
    renderer.dispose();
  });

  it("zooms toward the pointer with the wheel, and the person's zoom stops following", () => {
    const { renderer, container, time } = setup();
    time.run();
    const before = shownView(renderer);
    // happy-dom's WheelEvent drops the pointer position, so it is set on the event.
    const wheel = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    Object.defineProperties(wheel, { clientX: { value: 500 }, clientY: { value: 350 } });
    container.dispatchEvent(wheel);
    const after = shownView(renderer);
    expect(after.scale).toBeCloseTo(before.scale * Math.exp(-0.15), 5);
    // The pointer sits at the canvas centre, so the centre stays put.
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(renderer.following).toBe(false);
    time.run();
    expect(time.pending).toBe(false);
    renderer.dispose();
  });
});

describe("a chosen play let go", () => {
  it("returns the camera to the reading while following, never leaving the frame empty", () => {
    const { renderer, time, view, frame } = setup(2.5, { synced: true });
    time.run();
    const landed = shownView(renderer);
    const note = view.risen[0] ?? -1;
    expect(note).toBeGreaterThanOrEqual(0);
    renderer.setMoves([
      { play: 0, plays: [0], verb: "read", note, to: -1, label: "read", links: [], inner: null },
    ]);
    renderer.cursorTo(0);
    // The play took the camera far away (a reveal frames what it opened).
    const far = [...view.nodes].findLast((index) => !view.risen.includes(index)) ?? note;
    renderer.frame([far]);
    time.run();
    const away = shownView(renderer);
    expect(Math.hypot(away.x - landed.x, away.y - landed.y)).toBeGreaterThan(1);
    expect(renderer.following).toBe(true);
    renderer.cursorTo(null);
    time.run();
    const back = shownView(renderer);
    expect(back.x).toBeCloseTo(landed.x, 3);
    expect(back.y).toBeCloseTo(landed.y, 3);
    // The story is in the frame again.
    const { inView, view: slots } = frame();
    const story = slots.story.length > 0 ? slots.story : slots.risen;
    expect(story.length).toBeGreaterThan(0);
    expect(story.every((slot) => inView[slot] === 1)).toBe(true);
    renderer.dispose();
  });
});

describe("still means still", () => {
  it("renders no frame for a running turn when nothing transitions", () => {
    const { renderer, frames, time } = setup();
    time.run();
    const drawn = frames.length;
    renderer.setTurnRunning(true);
    expect(time.pending).toBe(false);
    time.run();
    renderer.setTurnRunning(false);
    time.run();
    expect(frames.length).toBe(drawn);
    renderer.dispose();
  });

  it("never hovers a note that glides under a still pointer; only a pointer move hovers", () => {
    const { renderer, container, time, callbacks, view } = setup();
    time.run();
    const pointer = (x: number, y: number) => {
      // happy-dom's PointerEvent drops the position, so it is set on the event.
      const event = new PointerEvent("pointermove");
      Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } });
      container.dispatchEvent(event);
      time.run();
    };
    const hovered = () =>
      callbacks.onHover.mock.calls.filter(([target]) => target !== null && target.kind === "node");
    pointer(4, 4);
    expect(hovered()).toHaveLength(0);
    // Bring a note under the still pointer, as a glide would.
    const driver = renderer.driver();
    const node = view.risen[0] ?? 0;
    const at = driver.screenOf(node);
    expect(at).not.toBeNull();
    driver.pan(4 - (at?.[0] ?? 0), 4 - (at?.[1] ?? 0));
    time.run();
    pointer(4, 4);
    expect(hovered()).toHaveLength(0);
    // The pointer moves: now it hovers.
    pointer(5, 4);
    expect(hovered().at(-1)?.[0]).toMatchObject({ kind: "node", index: node });
    renderer.dispose();
  });
});

describe("hover, pick, and play never move a note", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Every node's offset target and drawn position, to compare before and after. */
  const still = (frame: FlatFrame) => ({
    targets: [...frame.state.offsets.targets],
    drawn: [...frame.state.snapshot()],
  });

  for (const whole of [false, true]) {
    it(`leaves every offset target and position alone in ${whole ? "the whole memory" : "a reading"}`, () => {
      const { renderer, time, view, universe, layout, viewAt, gathering, frame } = setup(2.5, {
        whole,
        synced: true,
      });
      time.run();
      const before = still(frame());
      const driver = renderer.driver();
      // A hover, held: the note and its links light, nothing moves, and the frames stop.
      const hovered = view.risen[0] ?? 0;
      const at = driver.screenOf(hovered);
      expect(at).not.toBeNull();
      driver.hover(at?.[0] ?? 0, at?.[1] ?? 0);
      expect(driver.view().hovering).toBe(true);
      const hoverFrames = time.run();
      expect(time.pending).toBe(false);
      // Settled within about half a second of 16 ms frames.
      expect(hoverFrames).toBeLessThanOrEqual(40);
      expect(still(frame())).toEqual(before);
      driver.hover(-1, -1);
      time.run();
      expect(still(frame())).toEqual(before);
      // A pick lights and grows its note; it rearranges nothing, even its neighbours.
      const picked = universe.nodes[hovered]?.id ?? null;
      const context = { layout, gathering, reading: !whole, thisTurnOnly: false };
      renderer.setView(viewAt(0, picked), context);
      time.run();
      expect(frame().state.offsets.targets).toEqual(new Float32Array(before.targets));
      expect([...frame().state.snapshot()]).toEqual(before.drawn);
      renderer.setView(viewAt(0), context);
      time.run();
      // Each of the checkpoint's plays in turn, then none.
      const turn = ATLAS_THREAD.turns[0];
      for (let index = 0; index < (turn?.events.length ?? 0); index += 1) {
        const play = turn === undefined ? null : playFocus(universe, turn, index);
        renderer.setPlay(play);
        time.run();
        expect(still(frame())).toEqual(before);
      }
      renderer.setPlay(null);
      time.run();
      expect(still(frame())).toEqual(before);
      renderer.dispose();
    });
  }
});

describe("rest is exact", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("re-applying unchanged targets leaves every spring settled and uploads nothing", () => {
    const { time, universe, layout, gathering, frame } = setup();
    time.run();
    // Everything per slot, as the renderer holds it.
    const { state, edgeStyle, view, universe: slots } = frame();
    const uploads = state.positionTexture.version;
    // The radius the renderer gave each degree, as it would give it again.
    const radiusOf = new Map<number, number>();
    view.nodeDegree.forEach((degree, index) =>
      radiusOf.set(degree, state.radius.targets[index] ?? 0),
    );
    const edgesOf: Array<Array<number>> = Array.from({ length: slots.nodes.length }, () => []);
    slots.edges.forEach((edge, index) => {
      if (edge.key === "") return;
      edgesOf[edge.a]?.push(index);
      edgesOf[edge.b]?.push(index);
    });
    const noteOf = (slot: number) => universe.indexOf.get(slots.nodes[slot]?.id ?? "") ?? -1;
    for (let again = 0; again < 3; again += 1) {
      applyTargets({
        view,
        universe: slots,
        edgesOf,
        state,
        edgeStyle,
        hover: -1,
        storyLit: false,
        play: null,
        radiusFor: (degree) => radiusOf.get(degree) ?? 0,
        offsetFor: (slot) => gatheringOffset(gathering, layout.positions, noteOf(slot)),
      });
    }
    expect(state.offsets.settled).toBe(true);
    expect(state.settled).toBe(true);
    expect(edgeStyle.settled).toBe(true);
    // A step with nothing to do reports nothing moving and uploads no positions.
    expect(state.step(1 / 60, 100)).toBe(false);
    expect(state.positionTexture.version).toBe(uploads);
  });

  it("after a checkpoint lands, positions stop changing exactly and the frames stop", () => {
    const { renderer, time, layout, viewAt, gatheringAt, frame } = setup(2.5, { synced: true });
    time.run();
    renderer.setView(viewAt(1), {
      layout,
      gathering: gatheringAt(1),
      reading: true,
      thisTurnOnly: false,
    });
    renderer.landLinks();
    time.run(5000);
    expect(time.pending).toBe(false);
    const { state } = frame();
    // Every node reads exactly its target: home plus its offset target, no wobble left.
    const landed = [...state.snapshot()];
    const expected = [...state.rest].map((home, at) => home + (state.offsets.targets[at] ?? 0));
    expect(landed).toEqual(expected.map((value) => Math.fround(value)));
    // The story falls at the end of its landing window: edges dim, nothing moves.
    time.advance(10_000);
    vi.advanceTimersByTime(10_000);
    time.run(5000);
    expect(time.pending).toBe(false);
    expect([...frame().state.snapshot()]).toEqual(landed);
    // And then nothing: no frame is asked for.
    const drawn = time.run();
    expect(drawn).toBe(0);
    renderer.dispose();
  });
});

describe("the working set", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The slot a note holds now, by the slot graph the last frame drew, or -1. */
  const slotIn = (frame: FlatFrame, universe: Universe, note: number) =>
    frame.universe.nodes.findIndex((node) => node.id === universe.nodes[note]?.id);

  it("keeps a staying note in its slot with its spring, and frees a leaving note's slot once it has faded", () => {
    const { renderer, time, layout, viewAt, gatheringAt, universe, frame } = setup(2.5, {
      synced: true,
    });
    const at = (checkpoint: number) => ({
      layout,
      gathering: gatheringAt(checkpoint),
      reading: true,
      thisTurnOnly: false,
    });
    renderer.setView(viewAt(3), at(3));
    time.run(5000);
    const later = viewAt(3);
    const earlier = viewAt(0);
    const stays = [...later.nodes].find((note) => earlier.nodeAt.has(note)) ?? -1;
    const leaves = [...later.nodes].find((note) => !earlier.nodeAt.has(note)) ?? -1;
    expect(stays).toBeGreaterThanOrEqual(0);
    expect(leaves).toBeGreaterThanOrEqual(0);
    const slot = slotIn(frame(), universe, stays);
    const spring = Array.from(frame().state.offsets.values.slice(slot * 3, slot * 3 + 3));
    const drawn = frame().state.current(slot, new Vector3()).clone();
    // Step back: the staying note keeps its slot and starts from where it stood (no re-glide).
    renderer.setView(earlier, at(0));
    time.run(1);
    expect(slotIn(frame(), universe, stays)).toBe(slot);
    const moved = frame().state.current(slot, new Vector3()).distanceTo(drawn);
    expect(moved).toBeLessThan(1);
    expect(spring.some((value) => value !== 0)).toBe(true);
    // The leaving note holds its slot while it fades…
    expect(slotIn(frame(), universe, leaves)).toBeGreaterThanOrEqual(0);
    time.run(5000);
    // …and gives it up at the next view once faded.
    renderer.setView(earlier, at(0));
    time.run(1);
    expect(slotIn(frame(), universe, leaves)).toBe(-1);
    expect(slotIn(frame(), universe, stays)).toBe(slot);
    renderer.dispose();
  });

  describe("at 100k notes", () => {
    const memory = syntheticMemory({ notes: 100_000 });
    const thread = syntheticThread(memory, { checkpoints: 12 });
    const counts = { project: 0, allocated: [] as Array<number> };
    const counter: WorkCounter = {
      count: (kind, amount) => {
        if (kind === "project") counts.project += amount;
        else counts.allocated.push(amount);
      },
    };

    it("holds slots for what shows and hovers at its cost", { timeout: 120_000 }, () => {
      counts.project = 0;
      counts.allocated.length = 0;
      const { renderer, time, view } = setup(2.5, { memory, thread, counter, synced: true });
      time.run(5000);
      expect(view.shownNodes).toBeLessThan(500);
      expect(renderer.stats(0).slots).toBeLessThanOrEqual(view.shownNodes * 2 + 64);
      expect(Math.max(...counts.allocated)).toBeLessThan(2000);
      const driver = renderer.driver();
      const note = driver.inView()[0] ?? -1;
      const at = driver.screenOf(note);
      expect(at).not.toBeNull();
      counts.project = 0;
      driver.hover(at?.[0] ?? 0, at?.[1] ?? 0);
      // One projection per note that shows, at most: never one per note of the memory.
      expect(counts.project).toBeGreaterThan(0);
      expect(counts.project).toBeLessThanOrEqual(view.shownNodes);
      renderer.dispose();
    });

    it(
      "steps a checkpoint without allocating or walking anything the size of the memory",
      { timeout: 120_000 },
      () => {
        counts.allocated.length = 0;
        const reads = { count: 0 };
        const { renderer, time, layout, viewAt, gatheringAt } = setup(2.5, {
          memory,
          thread,
          counter,
          synced: true,
          observe: (universe) => countingReads(universe, reads),
        });
        time.run(5000);
        counts.allocated.length = 0;
        reads.count = 0;
        const watch = watchForWholeMemory(50_000);
        try {
          for (const checkpoint of [1, 2, 3]) {
            renderer.setView(viewAt(checkpoint), {
              layout,
              gathering: gatheringAt(checkpoint),
              reading: true,
              thisTurnOnly: false,
            });
            renderer.landLinks();
            time.run(600);
          }
        } finally {
          const seen = watch.stop();
          expect(seen).toEqual([]);
        }
        // What the step read of the universe is what shows and its links, not the memory.
        expect(reads.count).toBeLessThan(20_000);
        expect(counts.allocated.every((size) => size < 2000)).toBe(true);
        renderer.dispose();
      },
    );
  });
});

/** The universe with its arrays counting every element read, into `reads`. */
function countingReads(universe: Universe, reads: { count: number }): Universe {
  const counting = <Item>(items: ReadonlyArray<Item>): ReadonlyArray<Item> =>
    new Proxy(items, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads.count += 1;
        return Reflect.get(target, key, receiver);
      },
    });
  return {
    ...universe,
    nodes: counting(universe.nodes),
    edges: counting(universe.edges),
    edgesOf: counting(universe.edgesOf),
  };
}

/**
 * Watch for anything the size of the memory while a step runs: a typed array
 * of `threshold` entries or more allocated, or a Map, Set, or Array that large
 * walked. `stop()` puts everything back and says what it saw.
 */
function watchForWholeMemory(threshold: number): { stop(): Array<string> } {
  const seen: Array<string> = [];
  const restore: Array<() => void> = [];
  const typed = [
    "Float32Array",
    "Float64Array",
    "Int8Array",
    "Int16Array",
    "Int32Array",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
  ] as const;
  for (const name of typed) {
    const Original = globalThis[name];
    const Watched = new Proxy(Original, {
      construct(target, args, newTarget) {
        const made: unknown = Reflect.construct(target, args, newTarget);
        const length: unknown = Reflect.get(Object(made), "length");
        if (typeof length === "number" && length >= threshold) seen.push(`new ${name}(${length})`);
        return Object(made);
      },
    });
    Object.defineProperty(globalThis, name, { value: Watched, configurable: true, writable: true });
    restore.push(() =>
      Object.defineProperty(globalThis, name, {
        value: Original,
        configurable: true,
        writable: true,
      }),
    );
  }
  const walks: Array<[object, PropertyKey, (self: object) => number]> = [];
  const sized = (self: object) => {
    const size: unknown = Reflect.get(self, "size");
    return typeof size === "number" ? size : 0;
  };
  const long = (self: object) => {
    const length: unknown = Reflect.get(self, "length");
    return typeof length === "number" ? length : 0;
  };
  for (const proto of [Map.prototype, Set.prototype]) {
    for (const key of ["forEach", "keys", "values", "entries", Symbol.iterator] as const) {
      walks.push([proto, key, sized]);
    }
  }
  for (const key of [
    "forEach",
    "map",
    "filter",
    "reduce",
    "some",
    "every",
    "slice",
    Symbol.iterator,
  ] as const) {
    walks.push([Array.prototype, key, long]);
  }
  for (const [proto, key, size] of walks) {
    const original: unknown = Reflect.get(proto, key);
    if (typeof original !== "function") continue;
    const watched = function (this: object, ...args: Array<unknown>): unknown {
      if (size(this) >= threshold)
        seen.push(`${proto.constructor.name}.${String(key)} over ${size(this)}`);
      return Reflect.apply(original, this, args);
    };
    Object.defineProperty(proto, key, { value: watched, configurable: true, writable: true });
    restore.push(() =>
      Object.defineProperty(proto, key, { value: original, configurable: true, writable: true }),
    );
  }
  return {
    stop: () => {
      for (const undo of restore.toReversed()) undo();
      return [...new Set(seen)];
    },
  };
}

describe("framing at the reading density", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A lone note at the reading density, and the most a hub grows to, in CSS pixels. */
  const lonePixels = READING_RADIUS_SHARE * READING_PIXELS;
  const hubPixels = lonePixels * DEGREE_SCALE_CAP;

  it("lands a code turn's wide reading at the density, notes at the same size as almagest's, only tens labelled", () => {
    const story = graphModelStory as { memory: Memory; thread: ThreadRecord };
    const {
      renderer,
      time,
      layout,
      viewAt,
      gatheringAt,
      gathering: first,
    } = setup(2.5, {
      memory: story.memory,
      thread: story.thread,
      synced: true,
    });
    time.run(5000);
    const at = 3;
    const view = viewAt(at);
    const gathering = gatheringAt(at);
    renderer.setView(view, { layout, gathering, reading: true, thisTurnOnly: false });
    renderer.follow(view.risen);
    renderer.landLinks();
    time.advance(10_000);
    vi.advanceTimersByTime(10_000);
    time.run(5000);
    expect(first).not.toBeNull();
    const reading = readingFrame([...gathering.positions.values()], () => 0);
    const camera = shownView(renderer);
    // The reading is wider than the frame, and the camera does not zoom out to hold it.
    expect((reading?.extent ?? 0) * camera.scale).toBeGreaterThan(700 / 2);
    expect(camera.scale).toBeCloseTo(READING_PIXELS / (reading?.span ?? 1), 6);
    const stats = renderer.stats(0);
    expect(stats.radiusPx[0]).toBeGreaterThanOrEqual(lonePixels - 1e-6);
    expect(stats.radiusPx[1]).toBeLessThanOrEqual(hubPixels + 1e-6);
    // Only what the frame holds is labelled: tens, not the whole reading.
    expect(stats.inView).toBeLessThan(view.shownNodes);
    expect(stats.labels).toBeLessThanOrEqual(stats.inView);
    renderer.dispose();
  });

  it("draws almagest's notes at the same size", () => {
    const { renderer, time } = setup();
    time.run();
    const stats = renderer.stats(0);
    expect(stats.radiusPx[0]).toBeGreaterThanOrEqual(lonePixels - 1e-6);
    expect(stats.radiusPx[1]).toBeLessThanOrEqual(hubPixels + 1e-6);
    renderer.dispose();
  });
});

describe("the lean and pixi drawers", () => {
  it.skip("construct only with WebGL, which happy-dom does not provide; walked in a browser instead", () => {});
});

describe("the agent's cursor tells a landing", () => {
  it("visits the turn's moves in play order, grows no story note, keeps quiet marks, and then sleeps", () => {
    const { renderer, time, layout, viewAt, gatheringAt, frame, frames, callbacks, universe } =
      setup(2.5, { synced: true });
    time.run();
    const checkpoint = 5;
    const turn = ATLAS_THREAD.turns[checkpoint];
    if (turn === undefined) throw new Error("the thread has no turn 6");
    const view = viewAt(checkpoint);
    renderer.setView(view, {
      layout,
      gathering: gatheringAt(checkpoint),
      reading: true,
      thisTurnOnly: false,
    });
    // Before anything lands the cursor is parked in the corner, saying Agent.
    expect(frame().agent.text).toBe("Agent");
    const visits = turnTour(
      turn,
      universe,
      new Set(),
      () => view,
      [],
      memoryBefore(almagest, ATLAS_THREAD, checkpoint),
      new Map(),
    );
    renderer.setMoves(visits);
    renderer.landLinks();
    const from = frames.length;
    // The tour (about four seconds) and its gestures; the story's beads run on while it is lit.
    time.run(700);
    // The cursor reached every visit, in the play-by-play's order, saying what it did.
    const visited = callbacks.onCursor.mock.calls
      .map(([play]) => play)
      .filter((play): play is number => play !== null);
    expect([...new Set(visited)]).toEqual(visits.map((visit) => visit.play));
    expect(frames.slice(from).some((drawn) => drawn.agent.text === "+ wrote PR Review")).toBe(true);
    // Beads follow the cursor: on any frame, only the links of the visit it is telling run beads.
    const linksOf = new Map(
      visits.map((visit) => [
        visit.label,
        new Set(visit.links.map((link) => universe.edges[link.edge]?.key ?? "")),
      ]),
    );
    const beaded = frames.slice(from).filter((drawn) => drawn.beadEdges.length > 0);
    expect(beaded.length).toBeGreaterThan(0);
    for (const drawn of beaded) {
      const allowed = linksOf.get(drawn.agent.text) ?? new Set<string>();
      for (const key of drawn.beadEdges) expect(allowed.has(key)).toBe(true);
    }
    // After the tour no bead runs, and every link it made is lit quietly while the story is.
    expect(frames.at(-1)?.beadEdges).toEqual([]);
    const made = visits.flatMap((visit) =>
      visit.links.map((link) => universe.edges[link.edge]?.key),
    );
    const { edgeStyle, universe: drawnGraph } = frame();
    const quiet = drawnGraph.edges
      .map((edge, slot) => (made.includes(edge.key) ? (edgeStyle.values[slot * 2 + 1] ?? 0) : null))
      .filter((value): value is number => value !== null);
    expect(quiet.length).toBe(made.length);
    for (const value of quiet) expect(value).toBeCloseTo(EdgeAttention.storyQuiet, 2);
    // The story's notes keep their size: only a hover or pick grows a note.
    const { state, view: shown } = frame();
    for (const slot of shown.story)
      expect(state.drawnRadius(slot)).toBeCloseTo(state.baseRadius(slot));
    // The written note carries its glyph; no mark is left and the cursor is home.
    expect(frame().labels.names).toContain("+ PR Review");
    expect(frame().marks).toEqual([]);
    expect(frame().agent.text).toBe("Agent");
    // The story falls: the quiet marks (glyph and hairline) stay, and no frame is asked for.
    time.advance(10_000);
    vi.advanceTimersByTime(10_000);
    time.run(5000);
    expect(time.pending).toBe(false);
    expect(frame().labels.names).toContain("+ PR Review");
    const prReview = frame().view.risen.find(
      (slot) => frame().labels.names[slot] === "+ PR Review",
    );
    expect(prReview === undefined ? 0 : frame().state.styleOf(prReview, StyleChannel.glow)).toBe(1);
    // ...but no edge stays lit at rest: the made links fell with the story.
    const fallen = frame();
    for (const [slot, edge] of fallen.universe.edges.entries()) {
      if (made.includes(edge.key)) expect(fallen.edgeStyle.values[slot * 2 + 1] ?? 0).toBe(0);
    }
    expect(time.run()).toBe(0);
    // A step clears them: the next checkpoint's moves replace this one's gestures.
    renderer.setMoves([]);
    expect(callbacks.onCursor).toHaveBeenLastCalledWith(null);
    renderer.dispose();
  });
});

describe("a tour told inside containers", () => {
  // Two files: the turn writes f and g in a.ts, links f to h in b.ts, and amends h.
  const memory: Memory = {
    id: "tour",
    notes: [
      { id: "a.ts", name: "a.ts", frontier: false, kind: "file" },
      { id: "b.ts", name: "b.ts", frontier: false, kind: "file" },
      { id: "b.ts#h", name: "h", frontier: false, kind: "function", parent: "b.ts" },
    ],
    links: [],
    lenses: [],
  };
  const thread: ThreadRecord = {
    id: "t",
    title: "t",
    memoryId: "tour",
    turns: [
      {
        id: "t0",
        label: "t0",
        events: [
          { kind: "write", note: "a.ts#f", name: "f", parent: "a.ts", noteKind: "function" },
          { kind: "link", from: "a.ts#f", to: "b.ts#h", linkKind: "calls" },
          { kind: "write", note: "a.ts#g", name: "g", parent: "a.ts", noteKind: "function" },
          { kind: "amend", note: "b.ts#h" },
        ],
      },
    ],
  };

  it("returns the camera to where the survey stood before each opening, without drift", () => {
    const { renderer, time, layout, universe, callbacks } = setup(2.5, {
      synced: true,
      memory,
      thread,
    });
    time.run();
    const index = (id: string) => universe.indexOf.get(id) ?? -1;
    const reading = readingAt(memory, thread, 0, { depth: 0, thisTurnOnly: false });
    const context = {
      memory,
      thread,
      universe,
      layout,
      settings: { ...DEFAULT_SETTINGS, depth: 0 },
      thisTurnOnly: false,
      filters: NO_FILTERS,
    };
    const cache = new GatheringCache();
    const show = (closed: ReadonlySet<number>) =>
      renderer.setView(
        deriveView({
          universe,
          lenses: [],
          shownLensSlots: [],
          reading,
          whole: false,
          pickedId: null,
          depth: 0,
          filters: NO_FILTERS,
          closed,
        }),
        { layout, gathering: cache.at(context, 0, closed), reading: true, thisTurnOnly: false },
      );
    const survey = new Set([index("a.ts"), index("b.ts")]);
    show(survey);
    time.run();
    const turn = thread.turns[0];
    if (turn === undefined) throw new Error("no turn");
    const viewAt = (closed: ReadonlySet<number>) =>
      deriveView({
        universe,
        lenses: [],
        shownLensSlots: [],
        reading,
        whole: false,
        pickedId: null,
        depth: 0,
        filters: NO_FILTERS,
        closed,
      });
    const held = ["a.ts#f", "a.ts#g", "b.ts#h", "a.ts", "b.ts"].map(index);
    const tour = turnTour(
      turn,
      universe,
      survey,
      viewAt,
      held,
      memoryBefore(memory, thread, 0),
      new Map(),
    );
    // The host's part, as AtlasGraph plays it: open or close the container, frame its members on opening.
    const before: Array<{ x: number; y: number; scale: number }> = [];
    const returned: Array<{ x: number; y: number; scale: number }> = [];
    const view = () => {
      const at = renderer.flatView();
      if (at === null) throw new Error("no view");
      return { ...at };
    };
    callbacks.drill = (inner, open) => {
      if (open) {
        if (before.length > returned.length) returned.push(view());
        before.push(view());
        show(inner.closed);
        renderer.frame(held.filter((note) => universe.parentOf[note] === inner.container));
      } else show(inner.outer);
    };
    renderer.setMoves(tour);
    renderer.landLinks();
    time.run(3000);
    // Two openings (a.ts, then b.ts): after the first the camera came back exactly to where
    // the survey stood, so the second opened from there.
    expect(before).toHaveLength(2);
    expect(returned[0]?.x).toBeCloseTo(before[0]?.x ?? Number.NaN, 6);
    expect(returned[0]?.y).toBeCloseTo(before[0]?.y ?? Number.NaN, 6);
    expect(returned[0]?.scale).toBeCloseTo(before[0]?.scale ?? Number.NaN, 6);
    expect(before[1]?.x).toBeCloseTo(before[0]?.x ?? Number.NaN, 6);
    // After the last closing the tour is over: the camera fits the survey it returned to.
    const ended = view();
    renderer.fit();
    time.run(3000);
    expect(view().x).toBeCloseTo(ended.x, 6);
    expect(view().y).toBeCloseTo(ended.y, 6);
    expect(view().scale).toBeCloseTo(ended.scale, 6);
    renderer.dispose();
  });
});

describe("a working turn that writes another file", () => {
  // A turn told at file level, the way T3 Code's Graph surface tells one; then it grows.
  const memory: Memory = { id: "files", notes: [], links: [], lenses: [] };
  const write = (path: string, parent?: string) => ({
    kind: "write" as const,
    note: path,
    name: path.split("/").at(-1) ?? path,
    noteKind: path.includes(".") ? ("file" as const) : ("folder" as const),
    ...(parent === undefined ? {} : { parent }),
  });
  const first = [
    write("src"),
    write("src/graph", "src"),
    write("src/graph/a.ts", "src/graph"),
    write("src/graph/c.ts", "src/graph"),
    write("src/main.ts", "src"),
    write("lib"),
    write("lib/x.ts", "lib"),
  ];
  const threadOf = (events: ReadonlyArray<ReturnType<typeof write>>): ThreadRecord => ({
    id: "t",
    title: "t",
    memoryId: "files",
    turns: [{ id: "t0", label: "t0", events }],
  });

  it("leaves every settled note where it stands, and places only the new file", () => {
    const before = threadOf(first);
    const { renderer, time, frame, universe } = setup(2.5, {
      synced: true,
      memory,
      thread: before,
    });
    time.run(5000);
    const positions = () => {
      const { universe: slots, state, view } = frame();
      const at = new Vector3();
      const byId = new Map<string, readonly [number, number]>();
      slots.nodes.forEach((node, slot) => {
        if (node.id === "" || view.nodeVisible[slot] !== 1) return;
        state.current(slot, at);
        byId.set(node.id, [at.x, at.y]);
      });
      return byId;
    };
    const settled = positions();
    expect(settled.size).toBeGreaterThan(2);

    // The agent writes b.ts, which sorts between a.ts and c.ts: the host grows the universe,
    // lays it out anew, gathers the reading again, and shows it.
    const after = threadOf([...first, write("src/graph/b.ts", "src/graph")]);
    const grown = growUniverse(
      universe,
      buildUniverse(
        `${memory.id}/thread`,
        threadUniverse(memory, after),
        threadIndex(memory, after),
      ),
    );
    const layout = layoutUniverse(grown, DEFAULT_SETTINGS, 2);
    const gathering = new GatheringCache().at(
      {
        memory,
        thread: after,
        universe: grown,
        layout,
        settings: DEFAULT_SETTINGS,
        thisTurnOnly: false,
        filters: NO_FILTERS,
      },
      0,
    );
    renderer.setGraph(grown, layout);
    renderer.setView(
      deriveView({
        universe: grown,
        lenses: [],
        shownLensSlots: [],
        reading: readingAt(memory, after, 0, { depth: 1, thisTurnOnly: false }),
        whole: false,
        pickedId: null,
        depth: 1,
        filters: NO_FILTERS,
      }),
      { layout, gathering, reading: true, thisTurnOnly: false },
    );
    time.run(5000);
    expect(time.pending).toBe(false);
    const now = positions();
    // Every note that was settled stands exactly where it stood.
    for (const [id, [x, y]] of settled) {
      expect(now.get(id)?.[0]).toBeCloseTo(x, 4);
      expect(now.get(id)?.[1]).toBeCloseTo(y, 4);
    }
    // The new file shows, somewhere none of them stands.
    const placed = now.get("src/graph/b.ts");
    expect(placed).toBeDefined();
    for (const [x, y] of settled.values()) {
      expect(Math.hypot((placed?.[0] ?? 0) - x, (placed?.[1] ?? 0) - y)).toBeGreaterThan(1e-3);
    }
    renderer.dispose();
  });

  it("keeps settled notes still at every frame when the working set compacts, and Fit frames them", () => {
    // Twelve files in lib, five in src; the reader closes lib (its files leave, their slots go
    // vacant), then the agent writes thirty files: the working set outgrows its slots and compacts.
    const lib = Array.from({ length: 12 }, (_, at) =>
      write(`lib/l${String(at).padStart(2, "0")}.ts`, "lib"),
    );
    const src = [
      write("src"),
      write("src/graph", "src"),
      ...["g0", "g1", "g2", "g3"].map((name) => write(`src/graph/${name}.ts`, "src/graph")),
      write("src/main.ts", "src"),
    ];
    const before = threadOf([write("lib"), ...lib, ...src]);
    const { renderer, time, frame, universe, layout } = setup(2.5, {
      synced: true,
      memory,
      thread: before,
    });
    time.run(5000);
    const index = (id: string) => universe.indexOf.get(id) ?? -1;
    const show = (
      shownUniverse: Universe,
      thread: ThreadRecord,
      shownLayout: typeof layout,
      closed: ReadonlySet<number>,
    ) =>
      renderer.setView(
        deriveView({
          universe: shownUniverse,
          lenses: [],
          shownLensSlots: [],
          reading: readingAt(memory, thread, 0, { depth: 1, thisTurnOnly: false }),
          whole: false,
          pickedId: null,
          depth: 1,
          filters: NO_FILTERS,
          closed,
        }),
        {
          layout: shownLayout,
          gathering: new GatheringCache().at(
            {
              memory,
              thread,
              universe: shownUniverse,
              layout: shownLayout,
              settings: DEFAULT_SETTINGS,
              thisTurnOnly: false,
              filters: NO_FILTERS,
            },
            0,
            closed,
          ),
          reading: true,
          thisTurnOnly: false,
        },
      );
    const closed = new Set([index("lib")]);
    show(universe, before, layout, closed);
    time.run(5000);
    expect(time.pending).toBe(false);
    const positions = () => {
      const { universe: slots, state, view } = frame();
      const at = new Vector3();
      const byId = new Map<string, readonly [number, number]>();
      slots.nodes.forEach((node, slot) => {
        if (node.id === "" || view.nodeVisible[slot] !== 1) return;
        state.current(slot, at);
        byId.set(node.id, [at.x, at.y]);
      });
      return byId;
    };
    const settled = positions();
    expect(settled.has("lib")).toBe(true);
    expect(settled.has("lib/l00.ts")).toBe(false);

    const added = Array.from({ length: 30 }, (_, at) =>
      write(`src/graph/n${String(at).padStart(2, "0")}.ts`, "src/graph"),
    );
    const after = threadOf([write("lib"), ...lib, ...src, ...added]);
    const grown = growUniverse(
      universe,
      buildUniverse(
        `${memory.id}/thread`,
        threadUniverse(memory, after),
        threadIndex(memory, after),
      ),
    );
    const grownLayout = layoutUniverse(grown, DEFAULT_SETTINGS, 2);
    renderer.setGraph(grown, grownLayout);
    show(grown, after, grownLayout, closed);
    // Frame by frame, through the glide and the rises: no settled note moves.
    let frames = 0;
    while (time.pending && frames < 600) {
      time.run(1);
      frames += 1;
      const now = positions();
      for (const [id, [x, y]] of settled) {
        expect(now.get(id)?.[0]).toBeCloseTo(x, 4);
        expect(now.get(id)?.[1]).toBeCloseTo(y, 4);
      }
    }
    expect(frames).toBeGreaterThan(1);
    expect(time.pending).toBe(false);
    const drawn = [...positions().values()];
    expect(drawn.length).toBe(settled.size + added.length);

    // Fit frames the reading where it is drawn (held and placed), not the regathered layout.
    renderer.fit();
    time.run(5000);
    const xs = drawn.map(([x]) => x);
    const ys = drawn.map(([, y]) => y);
    const camera = renderer.flatView();
    expect(camera?.x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 3);
    expect(camera?.y).toBeCloseTo((Math.min(...ys) + Math.max(...ys)) / 2, 3);
    renderer.dispose();
  });
});

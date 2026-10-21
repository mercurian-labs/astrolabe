import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { AtlasGraphHandle } from "./AtlasGraph.tsx";
import type { Memory } from "./model/memory.ts";
import { NO_FILTERS } from "./model/search.ts";
import { DEFAULT_SETTINGS, defaultDepth } from "./model/settings.ts";
import type { ThreadEvent, ThreadRecord } from "./model/thread.ts";
import type { TourVisit } from "./model/tour.ts";
import type { FlatDrawer, FlatFrame } from "./render/flat/drawer.ts";
import type { FlatRenderer } from "./render/flat/FlatRenderer.ts";
import type { FrameClock } from "./render/scheduler.ts";

// The Graph surface as T3 Code drives it, with the lean renderer's controller drawing into a
// recording drawer (happy-dom has no WebGL): a thread told at file level whose working turn
// grows one completed write at a time, each growth a new thread and memory object at the same
// checkpoint, the way GraphPanel hands them over.

const harness = vi.hoisted(() => {
  let pending: ((now: number) => void) | null = null;
  const state = {
    now: 1000,
    last: null as FlatFrame | null,
    renderers: [] as Array<FlatRenderer>,
    appended: [] as Array<ReadonlyArray<TourVisit> | null>,
  };
  const clock = {
    request: (callback: (now: number) => void) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  };
  /** Draw frames until the renderer asks for none (or `limit` frames pass); returns how many. */
  const run = (limit = 4000) => {
    let frames = 0;
    while (pending !== null && frames < limit) {
      const callback = pending;
      pending = null;
      state.now += 16;
      callback(state.now);
      frames += 1;
    }
    return frames;
  };
  return { state, clock, run, idle: () => pending === null };
});

vi.mock("./render/lean/LeanRenderer.ts", async () => {
  const { FlatRenderer: Controller } = await import("./render/flat/FlatRenderer.ts");
  const drawer: FlatDrawer = {
    setGraph: () => {},
    setLabelFont: () => {},
    draw: (frame) => {
      harness.state.last = frame;
      return 1;
    },
    resize: () => {},
    drawCalls: 1,
    edgesDrawn: 0,
    gl: null,
    memory: () => ({ textures: null, buffers: null }),
    dispose: () => {},
  };
  return {
    createLeanRenderer: (host: HTMLElement, callbacks: never) => {
      const renderer = new Controller(host, callbacks, "lean", () => drawer, {
        clock: harness.clock as FrameClock,
      });
      const setMoves = renderer.setMoves.bind(renderer);
      renderer.setMoves = (visits, appended = null) => {
        harness.state.appended.push(appended);
        setMoves(visits, appended);
      };
      harness.state.renderers.push(renderer);
      return renderer;
    },
  };
});

const { AtlasGraph } = await import("./AtlasGraph.tsx");

/** Every ResizeObserver made (the graph's and the renderer's), to say "the frame was resized". */
const observers: Array<() => void> = [];
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(callback: () => void) {
      observers.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
);
/** The host's frame in CSS pixels: what every element in the test reports. */
const frameSize = { width: 900, height: 760 };

/** The file-level story T3 Code tells: folders written as containers, files written then amended. */
function story(
  turns: ReadonlyArray<ReadonlyArray<string>>,
  id = "thread",
): {
  memory: Memory;
  thread: ThreadRecord;
} {
  const written = new Set<string>();
  const told = turns.map((files, index) => {
    const events: ThreadEvent[] = [];
    for (const file of files) {
      const segments = file.split("/");
      let parent: string | undefined;
      for (let depth = 1; depth < segments.length; depth += 1) {
        const folder = segments.slice(0, depth).join("/");
        if (!written.has(folder)) {
          written.add(folder);
          events.push({
            kind: "write",
            note: folder,
            name: segments[depth - 1] ?? folder,
            noteKind: "folder",
            ...(parent === undefined ? {} : { parent }),
          });
        }
        parent = folder;
      }
      const at = parent === undefined ? {} : { parent };
      if (written.has(file)) events.push({ kind: "amend", note: file, noteKind: "file", ...at });
      else {
        written.add(file);
        events.push({
          kind: "write",
          note: file,
          name: segments.at(-1) ?? file,
          noteKind: "file",
          ...at,
        });
      }
    }
    return { id: `turn-${index}`, label: `Turn ${index + 1}`, events };
  });
  return {
    memory: { id, notes: [], links: [], lenses: [] },
    thread: { id, title: "", memoryId: id, turns: told },
  };
}

const MODEL = [
  "memory",
  "thread",
  "view",
  "level",
  "lenses",
  "kinds",
  "plays",
  "playback",
  "reading",
  "search",
  "features",
  "settings",
].map((name) => `packages/graph/src/model/${name}.ts`);
const RENDER = Array.from({ length: 10 }, (_, at) => `packages/graph/src/render/r${at}.ts`);
const WEB = Array.from({ length: 5 }, (_, at) => `apps/web/src/components/w${at}.tsx`);
const EARLIER = [[...MODEL, ...RENDER, ...WEB, "package.json"], RENDER.slice(0, 4)];
const GROWTH = [
  "packages/graph/src/model/memory.ts",
  "packages/graph/src/model/thread.ts",
  "packages/graph/src/model/view.ts",
];

let root: Root;
let host: HTMLDivElement;
const widths = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const heights = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
beforeAll(() => {
  // A right panel's frame: the level and the camera read it.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => frameSize.width,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => frameSize.height,
  });
  vi.spyOn(performance, "now").mockImplementation(() => harness.state.now);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  if (widths !== undefined) Object.defineProperty(HTMLElement.prototype, "clientWidth", widths);
  if (heights !== undefined) Object.defineProperty(HTMLElement.prototype, "clientHeight", heights);
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  harness.state.renderers.length = 0;
  harness.state.appended.length = 0;
  observers.length = 0;
  frameSize.width = 900;
  frameSize.height = 760;
});

/** Draw up to `frames` frames, letting React apply what the renderer's callbacks asked for. */
function draw(frames: number) {
  for (let drawn = 0; drawn < frames && !harness.idle(); drawn += 8) {
    act(() => {
      harness.run(8);
    });
  }
}

/** Let the renderer draw until it rests, letting the story's timers run as time passes. */
function settle() {
  for (let round = 0; round < 10; round += 1) {
    draw(20_000);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    harness.state.now += 5000;
    if (harness.idle()) break;
  }
  draw(20_000);
}

/** Whether `id` is drawn inside the frame. */
function inFrame(id: string): boolean {
  const frame = harness.state.last;
  if (frame === null) return false;
  const slot = frame.universe.nodes.findIndex((node) => node.id === id);
  return slot >= 0 && frame.view.nodeVisible[slot] === 1 && frame.inView[slot] === 1;
}

/** The drawn label of `id`, if it shows. */
function label(id: string): string | undefined {
  const frame = harness.state.last;
  if (frame === null) return undefined;
  const slot = frame.universe.nodes.findIndex((node) => node.id === id);
  if (slot < 0 || frame.view.nodeVisible[slot] !== 1) return undefined;
  return frame.labels.names[slot];
}

// With the frame filled (T3 Code's Graph surface) the folders stand open before the first write;
// without it, the first write opens a new level and the folder's files all arrive at once.
describe.each([true, false])(
  "a working turn that writes files one at a time (fillFrame %s)",
  (fillFrame) => {
    it("tells each new write: its glyph, an appended tour of it alone, the cursor's visit, then rest", () => {
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      const cursor: Array<number | null> = [];
      const render = (files: ReadonlyArray<string>) => {
        const { memory, thread } = story([...EARLIER, files], `live-${fillFrame}`);
        act(() =>
          root.render(
            createElement(AtlasGraph, {
              memory,
              thread,
              checkpoint: 2,
              turnRunning: true,
              mode: "lean",
              settings: { ...DEFAULT_SETTINGS, depth: defaultDepth(memory, thread) },
              filters: NO_FILTERS,
              onCursor: (play) => cursor.push(play),
              quietAncestors: true,
              fillFrame,
              showFollowing: "paused",
            }),
          ),
        );
      };
      render([]);
      settle();
      expect(harness.state.renderers).toHaveLength(1);
      for (let count = 1; count <= GROWTH.length; count += 1) {
        const file = GROWTH[count - 1] ?? "";
        cursor.length = 0;
        harness.state.appended.length = 0;
        render(GROWTH.slice(0, count));
        // The renderer was told the same turn grew, with a tour of the new write alone.
        const appended = harness.state.appended.filter((tour) => tour !== null);
        expect(appended).toHaveLength(1);
        expect(appended[0]?.flatMap((visit) => visit.plays)).toEqual([count - 1]);
        settle();
        // Its glyph is on its label, and the earlier writes keep theirs.
        for (const each of GROWTH.slice(0, count)) expect(label(each)).toMatch(/^~ /);
        expect(label(file)).toBe(`~ ${file.split("/").at(-1)}`);
        // Following, the frame holds the turn's group (the folder the writes stand in, which
        // its new level opened) packed as the reading packs it: every write is seen told.
        for (const each of MODEL) expect(inFrame(each)).toBe(true);
        // The cursor left the park for it, and is home again.
        expect(cursor).toContain(count - 1);
        expect(cursor.at(-1)).toBeNull();
        // And then nothing: no frame is asked for.
        expect(harness.idle()).toBe(true);
        expect(harness.run()).toBe(0);
      }
    });
  },
);

/** The ids of the notes drawn now. */
function shownIds(): Set<string> {
  const frame = harness.state.last;
  const ids = new Set<string>();
  frame?.universe.nodes.forEach((node, slot) => {
    if (node.id !== "" && frame.view.nodeVisible[slot] === 1) ids.add(node.id);
  });
  return ids;
}

// A package landing in a narrow panel: four package folders and two app folders of eight files
// each, and a lockfile at the top. The frame (490 px) fills to the story but leaves packages/c
// and packages/d closed, so the tour opens them, one at a time, and closes them again.
const LANDING = [
  ...["apps/x", "apps/y", "packages/a", "packages/b", "packages/c", "packages/d"].flatMap(
    (folder) => Array.from({ length: 8 }, (_, at) => `${folder}/f${at}.ts`),
  ),
  "pnpm-lock.yaml",
];

describe("a landing's tour", () => {
  const mount = (id: string, cursor: Array<number | null>, ref = createRef<AtlasGraphHandle>()) => {
    frameSize.width = 490;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const { memory, thread } = story([LANDING], id);
    act(() =>
      root.render(
        createElement(AtlasGraph, {
          memory,
          thread,
          checkpoint: 0,
          mode: "lean",
          settings: { ...DEFAULT_SETTINGS, depth: defaultDepth(memory, thread) },
          filters: NO_FILTERS,
          onCursor: (play) => cursor.push(play),
          quietAncestors: true,
          fillFrame: true,
          showFollowing: "paused",
          ref,
        }),
      ),
    );
  };

  it("closes what it opened and fits the survey again, through a resize, the cursor parked", () => {
    const cursor: Array<number | null> = [];
    mount("tour-end", cursor);
    draw(40);
    const renderer = harness.state.renderers[0];
    const survey = shownIds();
    expect(survey.has("packages/c")).toBe(true);
    expect(survey.has("packages/c/f0.ts")).toBe(false);
    for (let frames = 0; frames < 20_000 && !shownIds().has("packages/c/f0.ts"); frames += 1) {
      act(() => {
        harness.run(1);
      });
    }
    expect(shownIds().has("packages/c/f0.ts")).toBe(true);
    // The pane widens a little mid-tour (the same level fits): the camera re-fits the interior.
    frameSize.width = 540;
    act(() => {
      for (const observe of observers) observe();
    });
    settle();
    expect(cursor.at(-1)).toBeNull();
    expect(harness.idle()).toBe(true);
    // The survey again: what the tour opened is closed, the camera a fresh fit of it.
    expect(shownIds()).toEqual(survey);
    const ended = renderer?.flatView();
    act(() => renderer?.fit());
    settle();
    const fitted = renderer?.flatView();
    expect(ended?.x).toBeCloseTo(fitted?.x ?? Number.NaN, 3);
    expect(ended?.y).toBeCloseTo(fitted?.y ?? Number.NaN, 3);
    expect(ended?.scale).toBeCloseTo(fitted?.scale ?? Number.NaN, 6);
  });

  it("keeps telling through a resize: the open container stays open and the cursor goes on", () => {
    const cursor: Array<number | null> = [];
    mount("tour-resize", cursor);
    for (let frames = 0; frames < 20_000 && !shownIds().has("packages/c/f0.ts"); frames += 1) {
      act(() => {
        harness.run(1);
      });
    }
    expect(shownIds().has("packages/c/f0.ts")).toBe(true);
    const told = cursor.filter((play): play is number => play !== null);
    const last = Math.max(...told);
    // The panel becomes a wide pane mid-tour: a frame that could hold everything open.
    frameSize.width = 1400;
    act(() => {
      for (const observe of observers) observe();
    });
    act(() => {
      harness.run(1);
    });
    expect(shownIds().has("packages/c/f0.ts")).toBe(true);
    settle();
    const after = cursor.slice(told.length).filter((play): play is number => play !== null);
    // It went on from where it was, never back to the start, through to the lockfile.
    expect(after.length).toBeGreaterThan(0);
    expect(Math.min(...after)).toBeGreaterThanOrEqual(last);
    const lockfile = story([LANDING]).thread.turns[0]?.events.findIndex(
      (event) => event.kind === "write" && event.note === "pnpm-lock.yaml",
    );
    expect(after).toContain(lockfile);
    expect(harness.idle()).toBe(true);
  });

  it("does not land again when the graph mounts again on the same checkpoint (a pane moved)", () => {
    const first: Array<number | null> = [];
    mount("tour-remount", first);
    settle();
    expect(first.some((play) => play !== null)).toBe(true);
    act(() => root.unmount());
    host.remove();
    const second: Array<number | null> = [];
    mount("tour-remount", second);
    settle();
    expect(second.filter((play) => play !== null)).toEqual([]);
  });

  it("opens and closes only what it opened: a container the reader opened stays open", () => {
    const cursor: Array<number | null> = [];
    const graph = createRef<AtlasGraphHandle>();
    mount("tour-reader", cursor, graph);
    for (let frames = 0; frames < 20_000 && !shownIds().has("packages/c/f0.ts"); frames += 1) {
      act(() => {
        harness.run(1);
      });
    }
    expect(shownIds().has("packages/c/f0.ts")).toBe(true);
    expect(shownIds().has("packages/d/f0.ts")).toBe(false);
    // While the tour is inside packages/c, the reader opens packages/d (choosing one of its moves).
    const play = story([LANDING]).thread.turns[0]?.events.findIndex(
      (event) => event.kind === "write" && event.note === "packages/d/f0.ts",
    );
    act(() => graph.current?.reveal(play ?? -1));
    act(() => {
      harness.run(1);
    });
    expect(shownIds().has("packages/d/f0.ts")).toBe(true);
    // The tour closes packages/c; packages/d stays open.
    for (let frames = 0; frames < 20_000 && shownIds().has("packages/c/f0.ts"); frames += 1) {
      act(() => {
        harness.run(1);
      });
    }
    expect(shownIds().has("packages/c/f0.ts")).toBe(false);
    expect(shownIds().has("packages/d/f0.ts")).toBe(true);
    // Through the rest of the tour (which tells inside packages/d too), it stays the reader's.
    settle();
    expect(cursor.at(-1)).toBeNull();
    expect(shownIds().has("packages/d/f0.ts")).toBe(true);
  });
});

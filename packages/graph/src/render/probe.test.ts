import { describe, expect, it } from "vite-plus/test";

import { beadChecksum, GpuTimer, timeRender, type QueryContext } from "./probe.ts";

const GPU_DISJOINT_EXT = 0x8fbb;

/** A GL whose queries resolve and whose disjoint flag the test sets poll by poll. */
function fakeGl() {
  const available = new Set<WebGLQuery>();
  const results = new Map<WebGLQuery, number>();
  const deleted = new Set<WebGLQuery>();
  const created: Array<WebGLQuery> = [];
  const state = { disjoint: false };
  const gl: QueryContext = {
    QUERY_RESULT: 1,
    QUERY_RESULT_AVAILABLE: 2,
    getExtension: () => ({}),
    createQuery: () => {
      const query: WebGLQuery = {};
      created.push(query);
      return query;
    },
    beginQuery: () => {},
    endQuery: () => {},
    getParameter: (name) => (name === GPU_DISJOINT_EXT ? state.disjoint : null),
    getQueryParameter: (query, name) =>
      name === 2 ? available.has(query) : (results.get(query) ?? 0),
    deleteQuery: (query) => {
      if (query !== null) deleted.add(query);
    },
  };
  const resolve = (query: WebGLQuery | undefined, nanoseconds: number) => {
    if (query === undefined) return;
    available.add(query);
    results.set(query, nanoseconds);
  };
  return { gl, created, deleted, state, resolve };
}

function timed(timer: GpuTimer) {
  timer.begin();
  timer.end();
}

describe("GpuTimer", () => {
  it("reports resolved queries in milliseconds, oldest first, and waits on pending ones", () => {
    const fake = fakeGl();
    const timer = GpuTimer.create(fake.gl);
    if (timer === null) throw new Error("no timer");
    timed(timer);
    timed(timer);
    fake.resolve(fake.created[0], 2_000_000);
    expect(timer.poll()).toEqual([2]);
    expect(timer.poll()).toEqual([]);
    fake.resolve(fake.created[1], 500_000);
    expect(timer.poll()).toEqual([0.5]);
  });

  it("never reports a query that was pending during a disjoint poll, even once it resolves", () => {
    const fake = fakeGl();
    const timer = GpuTimer.create(fake.gl);
    if (timer === null) throw new Error("no timer");
    timed(timer);
    const query = fake.created[0];
    // Disjoint while A is still unavailable.
    fake.state.disjoint = true;
    expect(timer.poll()).toEqual([]);
    // Next poll: the clock is sound again and A has resolved.
    fake.state.disjoint = false;
    fake.resolve(query, 3_000_000);
    expect(timer.poll()).toEqual([]);
    expect(query !== undefined && fake.deleted.has(query)).toBe(true);
    // A query begun after the disjoint poll still reports.
    timed(timer);
    fake.resolve(fake.created[1], 1_000_000);
    expect(timer.poll()).toEqual([1]);
  });
});

describe("timeRender", () => {
  it("brackets the render call alone, with the GPU query's begin and end outside the timestamps", () => {
    const log: Array<string> = [];
    let clock = 0;
    const now = () => {
      log.push(`now ${clock}`);
      return clock;
    };
    const gpu = {
      begin: () => {
        log.push("begin");
        clock += 5;
      },
      end: () => {
        log.push("end");
        clock += 7;
      },
    };
    const renderMs = timeRender(
      () => {
        log.push("render");
        clock += 2;
      },
      gpu,
      now,
    );
    expect(renderMs).toBe(2);
    expect(log).toEqual(["begin", "now 5", "render", "now 7", "end"]);
    expect(
      timeRender(
        () => (clock += 3),
        null,
        () => clock,
      ),
    ).toBe(3);
  });
});

describe("beadChecksum", () => {
  it("changes when a visible bead moves and ignores invisible ones", () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const bright = new Float32Array([1, 0]);
    const before = beadChecksum(positions, bright, 2);
    positions[3] = 40;
    expect(beadChecksum(positions, bright, 2)).toBe(before);
    positions[0] = 1.5;
    expect(beadChecksum(positions, bright, 2)).not.toBe(before);
    expect(beadChecksum(positions, new Float32Array(2), 2)).toBe(0);
  });
});

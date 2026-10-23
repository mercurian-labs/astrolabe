import { describe, expect, it } from "vite-plus/test";

import {
  compare,
  medianRuns,
  regressionsToMarkdown,
  toJson,
  toMarkdown,
  type BenchCell,
  type BenchReport,
  type RunMetrics,
} from "./report.ts";

const flat = (value: number) => ({ p50: value, p95: value * 2, p99: value * 3, max: value * 4 });

function run(render: number, overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    frames: 100,
    renderMs: flat(render),
    prepMs: flat(render / 2),
    frameDelta: flat(16.7),
    gpuMs: null,
    drawCalls: 5,
    labels: 120,
    labelsCut: 0,
    overlaps: 3,
    edges: 10,
    beads: 0,
    beadsMoving: null,
    longFrames: null,
    heapMB: 50,
    textures: 4,
    buffers: 6,
    restFrames: null,
    restTimers: null,
    loadMs: null,
    ...overrides,
  };
}

const cell = (mode: string, render: number, scenario = "glide"): BenchCell => ({
  mode,
  size: 600,
  scenario,
  runs: 3,
  metrics: run(render),
});

const report = (cells: ReadonlyArray<BenchCell>): BenchReport => ({
  date: "2026-09-27",
  machine: { userAgent: "test", gpu: "Test GPU", dpr: 2, viewport: [1400, 900] },
  cells,
});

describe("medianRuns", () => {
  it("takes the median of every metric across runs, keeping n/a where no run measured it", () => {
    const merged = medianRuns([run(1), run(5, { beadsMoving: 0.5, loadMs: 800 }), run(2)]);
    expect(merged.renderMs).toEqual(flat(2));
    expect(merged.beadsMoving).toBe(0.5);
    expect(merged.loadMs).toBe(800);
    expect(merged.gpuMs).toBeNull();
    expect(merged.restFrames).toBeNull();
  });
});

describe("toMarkdown and toJson", () => {
  it("writes one table row per cell with the machine it ran on, and round-trips as JSON", () => {
    const result = report([
      cell("lean", 1.25),
      {
        ...cell("pixi", 2),
        scenario: "rest",
        metrics: run(0, { frames: 0, restFrames: 0, restTimers: 1 }),
      },
    ]);
    const markdown = toMarkdown(result);
    expect(markdown).toContain("Test GPU; DPR 2; viewport 1400×900");
    expect(markdown).toContain("| lean | 600 | glide | 1.25 / 2.50 / 3.75 |");
    expect(markdown).toContain("| pixi | 600 | rest | – |");
    expect(markdown).toContain("| 0 / 1 |");
    // The header, its divider, and one row per cell.
    expect(markdown.split("\n").filter((line) => line.startsWith("| ")).length).toBe(4);
    expect(JSON.parse(toJson(result))).toEqual(result);
  });
});

describe("compare", () => {
  it("lists the cells whose p95 render rose past the threshold, and nothing else", () => {
    const baseline = report([
      cell("lean", 1),
      cell("pixi", 1),
      cell("flat", 1),
      cell("3d", 1, "rest"),
    ]);
    const current = report([
      cell("lean", 1.1),
      cell("pixi", 1.3),
      cell("flat", 0.5),
      cell("lean", 9, "pan"),
    ]);
    const regressions = compare(baseline, current);
    expect(regressions).toHaveLength(1);
    expect(regressions[0]).toMatchObject({
      mode: "pixi",
      metric: "renderMs.p95",
      baseline: 2,
      current: 2.6,
    });
    expect(regressions[0]?.change).toBeCloseTo(0.3);
    expect(compare(baseline, current, 0.05).map((regression) => regression.mode)).toEqual([
      "lean",
      "pixi",
    ]);
    expect(regressionsToMarkdown(regressions)).toContain(
      "pixi · 600 · glide: p95 render 2.00 → 2.60 ms (+30%)",
    );
    expect(regressionsToMarkdown([])).toBe("No regressions over the threshold.\n");
  });
});

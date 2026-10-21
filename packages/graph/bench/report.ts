/**
 * Bench results, pure: the metrics one run of a cell (mode × size ×
 * scenario) yields, their medians across runs, a Markdown table and a JSON
 * blob, and a comparison against a baseline that lists regressions.
 */
import { median, medianDistribution, type Distribution, type LongFrames } from "./sampling.ts";

/** One run's measurements. Nulls are "n/a": the step does not measure it, or the browser cannot. */
export interface RunMetrics {
  readonly frames: number;
  readonly renderMs: Distribution;
  readonly prepMs: Distribution;
  /** Presented-frame delta (rAF to rAF) while the step ran. */
  readonly frameDelta: Distribution;
  readonly gpuMs: Distribution | null;
  readonly drawCalls: number;
  readonly labels: number;
  readonly labelsCut: number;
  readonly overlaps: number | null;
  readonly edges: number;
  readonly beads: number;
  /** Share of link-hold frames with beads visible and moving. */
  readonly beadsMoving: number | null;
  readonly longFrames: LongFrames | null;
  readonly heapMB: number | null;
  readonly textures: number | null;
  readonly buffers: number | null;
  readonly restFrames: number | null;
  readonly restTimers: number | null;
  readonly loadMs: number | null;
}

export interface BenchCell {
  readonly mode: string;
  readonly size: number;
  readonly scenario: string;
  /** Runs measured, after the discarded warm-up. */
  readonly runs: number;
  /** Medians across runs. */
  readonly metrics: RunMetrics;
}

export interface BenchReport {
  readonly date: string;
  readonly machine: {
    readonly userAgent: string;
    readonly gpu: string;
    readonly dpr: number;
    readonly viewport: readonly [number, number];
  };
  readonly cells: ReadonlyArray<BenchCell>;
}

const medianOrNull = (values: ReadonlyArray<number | null>): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : median(present);
};

/** The median of every metric across runs. */
export function medianRuns(runs: ReadonlyArray<RunMetrics>): RunMetrics {
  const pick = <Key extends keyof RunMetrics>(key: Key) => runs.map((run) => run[key]);
  const gpu = runs.map((run) => run.gpuMs).filter((value): value is Distribution => value !== null);
  const long = runs
    .map((run) => run.longFrames)
    .filter((value): value is LongFrames => value !== null);
  return {
    frames: median(pick("frames")),
    renderMs: medianDistribution(pick("renderMs")),
    prepMs: medianDistribution(pick("prepMs")),
    frameDelta: medianDistribution(pick("frameDelta")),
    gpuMs: gpu.length === 0 ? null : medianDistribution(gpu),
    drawCalls: median(pick("drawCalls")),
    labels: median(pick("labels")),
    labelsCut: median(pick("labelsCut")),
    overlaps: medianOrNull(pick("overlaps")),
    edges: median(pick("edges")),
    beads: median(pick("beads")),
    beadsMoving: medianOrNull(pick("beadsMoving")),
    longFrames:
      long.length === 0
        ? null
        : {
            count: median(long.map((entry) => entry.count)),
            totalMs: median(long.map((entry) => entry.totalMs)),
            maxMs: median(long.map((entry) => entry.maxMs)),
            blockingMs: median(long.map((entry) => entry.blockingMs)),
          },
    heapMB: medianOrNull(pick("heapMB")),
    textures: medianOrNull(pick("textures")),
    buffers: medianOrNull(pick("buffers")),
    restFrames: medianOrNull(pick("restFrames")),
    restTimers: medianOrNull(pick("restTimers")),
    loadMs: medianOrNull(pick("loadMs")),
  };
}

const ms = (value: number) => (value >= 100 ? value.toFixed(0) : value.toFixed(2));
const maybe = (value: number | null, format: (value: number) => string = ms) =>
  value === null ? "n/a" : format(value);
const triple = (value: Distribution) => `${ms(value.p50)} / ${ms(value.p95)} / ${ms(value.p99)}`;

const COLUMNS = [
  "mode",
  "size",
  "scenario",
  "render ms p50/p95/p99",
  "prep ms p50/p95/p99",
  "frame Δ ms p50/p95/p99",
  "render max",
  "draw calls",
  "labels (cut)",
  "overlaps",
  "edges",
  "beads moving",
  "long frames",
  "gpu ms p50/p95",
  "rest frames/timers",
  "load ms",
  "heap MB",
] as const;

/** One row per cell: the medians across runs. */
export function toMarkdown(report: BenchReport): string {
  const { machine } = report;
  const lines = [
    `# Atlas Graph bench, ${report.date}`,
    "",
    `Machine: ${machine.gpu}; DPR ${machine.dpr}; viewport ${machine.viewport[0]}×${machine.viewport[1]} CSS px.`,
    `Browser: ${machine.userAgent}`,
    "",
    `| ${COLUMNS.join(" | ")} |`,
    `| ${COLUMNS.map(() => "---").join(" | ")} |`,
  ];
  for (const cell of report.cells) {
    const m = cell.metrics;
    const hasFrames = m.frames > 0;
    lines.push(
      `| ${[
        cell.mode,
        cell.size,
        cell.scenario,
        hasFrames ? triple(m.renderMs) : "–",
        hasFrames ? triple(m.prepMs) : "–",
        hasFrames ? triple(m.frameDelta) : "–",
        hasFrames ? ms(m.renderMs.max) : "–",
        hasFrames ? m.drawCalls.toFixed(0) : "–",
        hasFrames ? `${m.labels.toFixed(0)} (${m.labelsCut.toFixed(0)})` : "–",
        maybe(m.overlaps, (value) => value.toFixed(0)),
        hasFrames ? m.edges.toFixed(0) : "–",
        maybe(m.beadsMoving, (value) => `${(value * 100).toFixed(0)}%`),
        m.longFrames === null
          ? "n/a"
          : `${m.longFrames.count.toFixed(0)} (max ${ms(m.longFrames.maxMs)})`,
        m.gpuMs === null ? "n/a" : `${ms(m.gpuMs.p50)} / ${ms(m.gpuMs.p95)}`,
        m.restFrames === null
          ? "–"
          : `${m.restFrames.toFixed(0)} / ${maybe(m.restTimers, (v) => v.toFixed(0))}`,
        maybe(m.loadMs),
        maybe(m.heapMB, (value) => value.toFixed(0)),
      ].join(" | ")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export const toJson = (report: BenchReport) => `${JSON.stringify(report, null, 2)}\n`;

export interface Regression {
  readonly mode: string;
  readonly size: number;
  readonly scenario: string;
  readonly metric: "renderMs.p95";
  readonly baseline: number;
  readonly current: number;
  /** The rise as a share of the baseline: 0.2 is 20% slower. */
  readonly change: number;
}

const cellKey = (cell: BenchCell) => `${cell.mode}|${cell.size}|${cell.scenario}`;

/**
 * The cells whose p95 render time rose more than `threshold` (a share, 15% by
 * default) over the baseline's same cell. Cells missing from either side, or
 * with no frames, are not compared.
 */
export function compare(
  baseline: BenchReport,
  current: BenchReport,
  threshold = 0.15,
): Array<Regression> {
  const before = new Map(baseline.cells.map((cell) => [cellKey(cell), cell]));
  const regressions: Array<Regression> = [];
  for (const cell of current.cells) {
    const previous = before.get(cellKey(cell));
    if (previous === undefined || previous.metrics.frames === 0 || cell.metrics.frames === 0)
      continue;
    const was = previous.metrics.renderMs.p95;
    const now = cell.metrics.renderMs.p95;
    if (was <= 0) continue;
    const change = (now - was) / was;
    if (change > threshold) {
      regressions.push({
        mode: cell.mode,
        size: cell.size,
        scenario: cell.scenario,
        metric: "renderMs.p95",
        baseline: was,
        current: now,
        change,
      });
    }
  }
  return regressions;
}

/** Regressions as Markdown lines, or a line saying there are none. */
export function regressionsToMarkdown(regressions: ReadonlyArray<Regression>): string {
  if (regressions.length === 0) return "No regressions over the threshold.\n";
  return `${regressions
    .map(
      (regression) =>
        `- ${regression.mode} · ${regression.size} · ${regression.scenario}: p95 render ${ms(regression.baseline)} → ${ms(regression.current)} ms (+${(regression.change * 100).toFixed(0)}%)`,
    )
    .join("\n")}\n`;
}

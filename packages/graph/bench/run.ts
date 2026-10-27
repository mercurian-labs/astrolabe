// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off - A host script: it drives a browser and writes result files.
/**
 * Opens the bench page in headed Chromium (GPU on), runs a matrix, writes `bench/results/<date>.*`,
 * and exits 1 when any cell's p95 render time regressed past `--threshold` against
 * `bench/baseline.json`. Needs a running dev server; it starts none. `--quick` is every mode at 600
 * notes, one run; `--write-baseline` saves the run as the baseline instead of comparing.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { chromium } from "playwright-core";

import type { BenchMatrix } from "./harness.ts";
import { compare, regressionsToMarkdown, toJson, toMarkdown, type BenchReport } from "./report.ts";
import { SCENARIO_NAMES, type ScenarioName } from "./scenarios.ts";
import { SYNTHETIC_SIZES, type SyntheticSize } from "../fixtures/synthetic.ts";
import { RENDER_MODES, type RenderMode } from "../src/render/renderer.ts";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}

const flag = (name: string) => process.argv.includes(`--${name}`);

function list<Item extends string | number>(
  name: string,
  known: ReadonlyArray<Item>,
  fallback: ReadonlyArray<Item>,
): ReadonlyArray<Item> {
  const value = option(name);
  if (value === undefined) return fallback;
  return value.split(",").map((part) => {
    const found = known.find((item) => String(item) === part.trim());
    if (found === undefined)
      throw new Error(`unknown ${name}: ${part} (known: ${known.join(", ")})`);
    return found;
  });
}

const quick = flag("quick");
const matrix: BenchMatrix = {
  modes: list<RenderMode>("modes", RENDER_MODES, RENDER_MODES),
  sizes: list<SyntheticSize>("sizes", SYNTHETIC_SIZES, quick ? [600] : [600, 3000, 10_000]),
  scenarios: list<ScenarioName>(
    "scenarios",
    SCENARIO_NAMES,
    quick ? ["glide", "pan", "rest"] : SCENARIO_NAMES,
  ),
  runs: Number(option("runs") ?? (quick ? 1 : 3)),
};
const url = option("url") ?? "http://localhost:5187";
const threshold = Number(option("threshold") ?? 0.15);

const browser = await chromium.launch({
  headless: false,
  args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--window-size=1480,1300"],
});
let report: BenchReport;
try {
  // No viewport emulation: the real window, at the display's own device pixel ratio.
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`page: ${message.text()}`);
  });
  await page.goto(`${url}/bench.html`);
  await page.waitForFunction(() => window.atlasBench !== undefined, null, { timeout: 60_000 });
  console.log(
    `running ${matrix.modes.length * matrix.sizes.length * matrix.scenarios.length} cells, ${matrix.runs} run(s) each…`,
  );
  report = await page.evaluate(async (asked) => {
    const bench = window.atlasBench;
    if (bench === undefined) throw new Error("the bench page is not ready");
    return bench.run(asked);
  }, matrix);
} finally {
  await browser.close();
}

const results = NodePath.join(here, "results");
NodeFS.mkdirSync(results, { recursive: true });
const stamp = report.date.replaceAll(":", "-").replace(/\..*$/, "");
const markdown = toMarkdown(report);
NodeFS.writeFileSync(NodePath.join(results, `${stamp}.json`), toJson(report));
NodeFS.writeFileSync(NodePath.join(results, `${stamp}.md`), markdown);
console.log(markdown);

const baselinePath = NodePath.join(here, "baseline.json");
if (flag("write-baseline")) {
  NodeFS.writeFileSync(baselinePath, toJson(report));
  console.log(`baseline written to ${baselinePath}`);
} else if (NodeFS.existsSync(baselinePath)) {
  const baseline: BenchReport = JSON.parse(NodeFS.readFileSync(baselinePath, "utf8"));
  const regressions = compare(baseline, report, threshold);
  const summary = regressionsToMarkdown(regressions);
  NodeFS.writeFileSync(
    NodePath.join(results, `${stamp}.md`),
    `${markdown}\n## Against the baseline\n\n${summary}`,
  );
  console.log(summary);
  if (regressions.length > 0) process.exitCode = 1;
} else {
  console.log("no baseline yet: run with --write-baseline to set one");
}

/**
 * The bench page: runs a matrix of modes, memory sizes, and scenarios on the real AtlasGraph at a
 * fixed 1400 × 900 CSS px viewport. `window.atlasBench.run` is the Playwright runner's entry
 * (bench/run.ts). Nothing else runs in the page while a bench runs.
 */
import "@fontsource/ibm-plex-mono/400.css";
import labelFont from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff?url";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  REFERENCE_CHECKPOINT,
  runMatrix,
  type BenchHost,
  type BenchMatrix,
  type BenchState,
} from "../bench/harness.ts";
import { toJson, toMarkdown, type BenchReport } from "../bench/report.ts";
import { SCENARIO_NAMES, SCENARIOS, type ScenarioName } from "../bench/scenarios.ts";
import { SYNTHETIC_SIZES, syntheticMemory, type SyntheticSize } from "../fixtures/synthetic.ts";
import { syntheticThread } from "../fixtures/syntheticThread.ts";
import {
  AtlasGraph,
  DEFAULT_SETTINGS,
  NO_FILTERS,
  RENDER_MODES,
  type AtlasGraphHandle,
  type RenderMode,
} from "../src/index.ts";
import { rendererFamily } from "../src/render/renderer.ts";
import { RENDERERS } from "../src/render/renderers.ts";
import "../src/styles.css";
import "./styles.css";

const VIEWPORT = [1400, 900] as const;
/** The story plays over this synthetic thread length. */
const THREAD_CHECKPOINTS = 200;
const NO_LENSES: ReadonlyArray<number> = [];

declare global {
  interface Window {
    /** The Playwright runner's way in: run a matrix and get the report. */
    atlasBench?: { run(matrix: BenchMatrix): Promise<BenchReport> } | undefined;
  }
}

function toggle<Item>(items: ReadonlyArray<Item>, item: Item): Array<Item> {
  return items.includes(item) ? items.filter((each) => each !== item) : [...items, item];
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function Bench() {
  const [state, setState] = useState<BenchState>({
    mode: "flat",
    size: 600,
    memoryVersion: 0,
    mount: 0,
    reading: "thread",
    checkpoint: REFERENCE_CHECKPOINT,
    turnRunning: false,
  });
  const [modes, setModes] = useState<ReadonlyArray<RenderMode>>(RENDER_MODES);
  const [sizes, setSizes] = useState<ReadonlyArray<SyntheticSize>>([600, 3000, 10_000]);
  const [scenarios, setScenarios] = useState<ReadonlyArray<ScenarioName>>(SCENARIO_NAMES);
  const [runs, setRuns] = useState(3);
  const [progress, setProgress] = useState<string>("idle");
  const [report, setReport] = useState<BenchReport | null>(null);
  const graph = useRef<AtlasGraphHandle>(null);

  // A fresh memory object per version, so a load builds its universe and layout from nothing.
  const memory = useMemo(
    () => ({
      ...syntheticMemory({ notes: state.size }),
      id: `synthetic-${state.size}-v${state.memoryVersion}`,
    }),
    [state.size, state.memoryVersion],
  );
  const thread = useMemo(
    () => syntheticThread(memory, { checkpoints: THREAD_CHECKPOINTS }),
    [memory],
  );

  // `show` resolves once React has committed the state it set.
  const committed = useRef<Array<() => void>>([]);
  const latest = useRef({ state, thread });
  useEffect(() => {
    latest.current = { state, thread };
    for (const resolve of committed.current.splice(0)) resolve();
  }, [state, thread]);

  const host = useMemo<BenchHost>(
    () => ({
      handle: () => graph.current,
      show: (next) =>
        new Promise<void>((resolve) => {
          committed.current.push(resolve);
          latest.current = { ...latest.current, state: next };
          setState(next);
        }),
      get state() {
        return latest.current.state;
      },
      thread: () => latest.current.thread,
      viewport: VIEWPORT,
    }),
    [],
  );

  const run = async (matrix: BenchMatrix) => {
    setReport(null);
    const result = await runMatrix(host, matrix, (step) =>
      setProgress(
        step.label === "done" ? "done" : `${step.cell + 1}/${step.cells} · ${step.label}`,
      ),
    );
    setReport(result);
    return result;
  };

  useEffect(() => {
    window.atlasBench = { run };
    return () => {
      window.atlasBench = undefined;
    };
  });

  const json = report === null ? "" : toJson(report);
  return (
    <div className="bench">
      <div className="bench-controls">
        <div className="bench-row">
          <b>Modes</b>
          {RENDER_MODES.map((mode) => (
            <label key={mode}>
              <input
                type="checkbox"
                checked={modes.includes(mode)}
                onChange={() => setModes(toggle(modes, mode))}
              />
              {mode}
            </label>
          ))}
        </div>
        <div className="bench-row">
          <b>Sizes</b>
          {SYNTHETIC_SIZES.map((size) => (
            <label key={size}>
              <input
                type="checkbox"
                checked={sizes.includes(size)}
                onChange={() => setSizes(toggle(sizes, size))}
              />
              {size.toLocaleString()}
              {size === 100_000 ? " (heavy)" : ""}
            </label>
          ))}
        </div>
        <div className="bench-row">
          <b>Scenarios</b>
          {SCENARIO_NAMES.map((scenario) => (
            <label key={scenario}>
              <input
                type="checkbox"
                checked={scenarios.includes(scenario)}
                onChange={() => setScenarios(toggle(scenarios, scenario))}
              />
              {scenario}
            </label>
          ))}
        </div>
        <div className="bench-row bench-muted">
          {scenarios
            .map((scenario) => `${scenario}: ${SCENARIOS[scenario].description}`)
            .join("  ·  ")}
        </div>
        <div className="bench-row">
          <label>
            Runs{" "}
            <input
              type="number"
              min={1}
              max={10}
              value={runs}
              onChange={(event) =>
                setRuns(Math.max(1, Math.min(10, Number(event.target.value) || 1)))
              }
            />
          </label>
          <button
            type="button"
            disabled={progress !== "idle" && progress !== "done"}
            onClick={() => void run({ modes, sizes, scenarios, runs })}
          >
            Run
          </button>
          <span>{progress}</span>
          <span className="bench-muted">
            viewport {VIEWPORT[0]}×{VIEWPORT[1]} CSS px · DPR {globalThis.devicePixelRatio || 1}
          </span>
          <button
            type="button"
            disabled={report === null}
            onClick={() => void navigator.clipboard.writeText(json)}
          >
            Copy JSON
          </button>
          <button
            type="button"
            disabled={report === null}
            onClick={() => download(`atlas-bench-${report?.date ?? "run"}.json`, json)}
          >
            Download JSON
          </button>
        </div>
      </div>
      <div className="bench-stage" style={{ width: VIEWPORT[0], height: VIEWPORT[1] }}>
        <AtlasGraph
          key={state.mount}
          ref={graph}
          memory={memory}
          thread={thread}
          checkpoint={state.checkpoint}
          whole={state.reading === "whole"}
          turnRunning={state.turnRunning}
          mode={state.mode}
          createRenderer={RENDERERS[rendererFamily(state.mode)]}
          settings={DEFAULT_SETTINGS}
          filters={NO_FILTERS}
          lensSlots={NO_LENSES}
          labelFont={labelFont}
          themeKey="light"
        />
      </div>
      {report === null ? null : <pre className="bench-results">{toMarkdown(report)}</pre>}
    </div>
  );
}

const root = document.querySelector("#root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <Bench />
    </StrictMode>,
  );
}

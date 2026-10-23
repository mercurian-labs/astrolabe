/**
 * The Atlas Graph playground: the almagest memory with a scripted thread, a
 * synthetic memory of 600 to 100,000 notes with a synthetic thread, or a code
 * story (a codebase's symbols, told over a run of commits), under every
 * control the graph takes. The debug readout counts frames so the rule
 * "still at rest" can be checked.
 */
import "@fontsource/ibm-plex-mono/400.css";
import labelFont from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff?url";
import { StrictMode, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import aiderStory from "../../code-graph/fixtures/aider.story.json";
import graphModelStory from "../../code-graph/fixtures/graph-model.story.json";
import graphViewStory from "../../code-graph/fixtures/graph-view.story.json";
import almagestJson from "../fixtures/almagest.json";
import { SYNTHETIC_SIZES, syntheticMemory, type SyntheticSize } from "../fixtures/synthetic.ts";
import {
  SYNTHETIC_CHECKPOINTS,
  syntheticThread,
  type SyntheticCheckpoints,
} from "../fixtures/syntheticThread.ts";
import { ATLAS_THREAD } from "../fixtures/thread.ts";
import { turnEnd, turnStart } from "../fixtures/threadFiles.ts";
import {
  AtlasGraph,
  applyFeatures,
  DEFAULT_SETTINGS,
  FEATURE_LABELS,
  defaultDepth,
  NO_FILTERS,
  PlayByPlay,
  RENDER_MODES,
  SETTING_RANGES,
  SHAPE_KEY,
  loadSettings,
  holdSeconds,
  benchReset,
  memoryBefore,
  pickedPlays,
  removalsAt,
  nextStep,
  resumeStep,
  saveSettings,
  selectedIn,
  selectPlay,
  type AtlasGraphHandle,
  type AtlasLayoutInfo,
  type Boundaries,
  type GraphFilters,
  type GraphSettings,
  type Memory,
  type PlaybackStep,
  type PlayPick,
  type RenderMode,
  type ThreadRecord,
} from "../src/index.ts";
import "../src/styles.css";
import { CodeEditPopup } from "./codeEdits.tsx";
import { NoteEditPopup, useNoteEdits } from "./noteEdits.tsx";
import "./styles.css";

/** A code story: a memory of symbols and the thread of commits that wrote them. */
interface CodeStory {
  readonly memory: Memory;
  readonly thread: ThreadRecord;
  /** The symbols some turn removed and no later turn wrote back. */
  readonly removed?: ReadonlyArray<string>;
  /** The codebase's declared layers, when the story declares them. */
  readonly boundaries?: Boundaries;
}
const NO_REMOVED: ReadonlyArray<string> = [];
const NO_REMOVALS: ReadonlyMap<number, string> = new Map();
const CODE_STORIES = {
  "code-graph-model": graphModelStory as CodeStory,
  "code-graph-view": graphViewStory as CodeStory,
  "code-aider": aiderStory as CodeStory,
} as const;
type CodeKey = keyof typeof CODE_STORIES;
const CODE_KEYS = Object.keys(CODE_STORIES) as ReadonlyArray<CodeKey>;
const codeStory = (key: MemoryKey): CodeStory | null =>
  key in CODE_STORIES ? CODE_STORIES[key as CodeKey] : null;

/** almagest, a synthetic memory by its size, or a code story. */
type MemoryKey = "almagest" | `synthetic-${SyntheticSize}` | CodeKey;
const MEMORY_KEYS: ReadonlyArray<MemoryKey> = [
  "almagest",
  ...CODE_KEYS,
  ...SYNTHETIC_SIZES.map((size): MemoryKey => `synthetic-${size}`),
];
const syntheticSize = (key: MemoryKey): SyntheticSize | null =>
  SYNTHETIC_SIZES.find((size) => key === `synthetic-${size}`) ?? null;
const MEMORY_LABELS: Record<MemoryKey, string> = {
  almagest: "almagest",
  "code-graph-model": "code · graph/src/model (11 commits)",
  "code-graph-view": "code · the graph builds itself (16 commits)",
  "code-aider": "code · aider (12 commits)",
  "synthetic-600": "synthetic · 600",
  "synthetic-3000": "synthetic · 3k",
  "synthetic-10000": "synthetic · 10k",
  "synthetic-100000": "synthetic · 100k (heavy: seconds to load)",
};

const MODE_LABELS: Record<RenderMode, string> = {
  "3d": "3D",
  flat: "Flat",
  lean: "Lean",
  pixi: "Pixi",
};
const MODE_KEY = "mercurian.atlas-graph.mode";

/** The render mode, kept with the playground's other preferences. */
function loadMode(): RenderMode {
  try {
    const stored = globalThis.localStorage?.getItem(MODE_KEY);
    // A first visit (no saved mode) opens on Lean, which tells the whole story.
    return RENDER_MODES.find((mode) => mode === stored) ?? "lean";
  } catch {
    return "lean";
  }
}

function saveMode(mode: RenderMode): void {
  try {
    globalThis.localStorage?.setItem(MODE_KEY, mode);
  } catch {
    // A blocked store keeps the mode for this session only.
  }
}

/** The reading a play is chosen in: any change of it clears the selection. */
const readingKey = (memory: MemoryKey, checkpoint: number, whole: boolean, thisTurnOnly: boolean) =>
  `${memory}/${checkpoint}/${whole}/${thisTurnOnly}`;

/** How long a manually stepped turn counts as running. */
const TURN_AFTER_STEP_MS = 1800;

const almagest: Memory = almagestJson;
const storage = (() => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
})();

type NumericSetting = Exclude<keyof GraphSettings, "arrows" | "features">;
const FORCES: ReadonlySet<keyof GraphSettings> = new Set([
  "centerForce",
  "repelForce",
  "linkDistance",
]);
const SLIDERS: ReadonlyArray<{ key: NumericSetting; label: string }> = [
  { key: "nodeSize", label: "Node size" },
  { key: "lineThickness", label: "Line thickness" },
  { key: "labelFade", label: "Label fade" },
  { key: "centerForce", label: "Center force" },
  { key: "repelForce", label: "Repel force" },
  { key: "linkDistance", label: "Link distance" },
  { key: "depth", label: "Reading depth" },
];

function App() {
  const [memoryKey, setMemoryKey] = useState<MemoryKey>("almagest");
  const storyMemory = useMemo(() => {
    const story = codeStory(memoryKey);
    if (story !== null) return story.memory;
    const size = syntheticSize(memoryKey);
    return size === null ? almagest : syntheticMemory({ notes: size });
  }, [memoryKey]);
  // Every synthetic memory has a synthetic thread, as long as picked.
  const [threadLength, setThreadLength] = useState<SyntheticCheckpoints>(10);
  const storyThread = useMemo(() => {
    const story = codeStory(memoryKey);
    if (story !== null) return story.thread;
    return memoryKey === "almagest"
      ? ATLAS_THREAD
      : syntheticThread(storyMemory, { checkpoints: threadLength });
  }, [memoryKey, storyMemory, threadLength]);
  // A codebase's notes have kinds, drawn as shapes: Settings keys them.
  const hasKinds = useMemo(
    () =>
      storyMemory.notes.some((note) => note.kind !== undefined) ||
      storyThread.turns.some((turn) =>
        turn.events.some(
          (event) =>
            (event.kind === "write" || event.kind === "amend") && event.noteKind !== undefined,
        ),
      ),
    [storyMemory, storyThread],
  );
  const [whole, setWhole] = useState(false);
  const [mode, setModeState] = useState<RenderMode>(() => loadMode());
  const setMode = (next: RenderMode) => {
    setModeState(next);
    saveMode(next);
  };
  const [benchLine, setBenchLine] = useState<string | null>(null);
  const [benchPending, setBenchPending] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lensSlots, setLensSlots] = useState<ReadonlyArray<number>>([]);
  const [filters, setFilters] = useState<GraphFilters>(NO_FILTERS);
  const [settings, setSettings] = useState<GraphSettings>(() => loadSettings(storage));
  // The memory and thread as the design features have them: the graph, the
  // play-by-play, and the code popup all read these, so plays line up.
  const { memory, thread } = useMemo(
    () =>
      applyFeatures(storyMemory, storyThread, {
        dataEdges: settings.features.dataEdges,
        failureEdges: settings.features.failureEdges,
      }),
    [storyMemory, storyThread, settings.features.dataEdges, settings.features.failureEdges],
  );
  const story = codeStory(memoryKey);
  const boundaries = settings.features.boundaries ? story?.boundaries : undefined;
  const codeView = useMemo(
    () => (story === null || thread === null ? null : { ...story, memory, thread }),
    [story, memory, thread],
  );
  // The sliders' values. A force re-solves the layout, so forces apply on release.
  const [draft, setDraft] = useState<GraphSettings>(settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [checkpoint, setCheckpoint] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [thisTurnOnly, setThisTurnOnly] = useState(false);
  const [log, setLog] = useState<ReadonlyArray<{ id: number; text: string }>>([]);
  const [layoutInfo, setLayoutInfo] = useState<AtlasLayoutInfo | null>(null);
  const [stats, setStats] = useState({
    frames: 0,
    total: 0,
    animating: false,
    inView: 0,
    slots: 0,
    shown: 0,
    labels: 0,
    radiusPx: "",
    edgePx: "",
    beads: 0,
    mode: "3d",
    drawCalls: 0,
    renderMs: "",
    prepMs: "",
  });
  const graph = useRef<AtlasGraphHandle>(null);
  const turns = thread?.turns ?? [];
  const lastCheckpoint = Math.max(0, turns.length - 1);
  // A selected play belongs to the reading it was chosen in: stepping, playing,
  // switching memory, or changing the reading mode clears it, so coming back
  // shows no selection. It is hidden at once, and cleared when the reading moves.
  const reading = readingKey(memoryKey, checkpoint, whole, thisTurnOnly);
  const [play, dispatchPlay] = useReducer(selectPlay, null);
  useEffect(() => dispatchPlay({ type: "reading", reading }), [reading]);
  const selectedPlay = selectedIn(play, reading);
  const choosePlay = (index: PlayPick | null) => dispatchPlay({ type: "select", reading, index });
  const turn = thread?.turns[checkpoint];
  // The agent's cursor on the map lights its play's row in step.
  const [cursorPlay, setCursorPlay] = useState<number | null>(null);
  const removed = codeStory(memoryKey)?.removed ?? NO_REMOVED;
  const removals = useMemo(
    () => (thread === null ? NO_REMOVALS : removalsAt(memory, thread, checkpoint, removed)),
    [memory, thread, checkpoint, removed],
  );
  const before = useMemo(
    () => (thread === null ? null : memoryBefore(memory, thread, checkpoint)),
    [memory, thread, checkpoint],
  );

  useEffect(() => saveSettings(storage, settings), [settings]);
  // A memory starts at its own reading depth (a codebase at its worked notes
  // alone, a memory at their neighbours) until the depth is set for it by hand.
  const [depthChoice, setDepthChoice] = useState<{ memory: MemoryKey; depth: number } | null>(null);
  const startDepth = useMemo(() => defaultDepth(memory, thread), [memory, thread]);
  const depth = depthChoice?.memory === memoryKey ? depthChoice.depth : startDepth;
  const shownSettings = useMemo(() => ({ ...settings, depth }), [settings, depth]);

  // The almagest thread's writes go to the workspace's files on disk, and the
  // editor popup shows each file as it changes: a selected play writes that
  // play, a checkpoint with none selected writes the rest of its turn.
  const noteEdits = useNoteEdits();
  const writesFiles = memoryKey === "almagest";
  useEffect(
    () => noteEdits.newTurn(`${memoryKey}/${checkpoint}`),
    [noteEdits, memoryKey, checkpoint],
  );
  useEffect(() => {
    if (!writesFiles) return;
    const start = turnStart(ATLAS_THREAD, checkpoint);
    const picked = selectedPlay === null ? [] : pickedPlays(selectedPlay);
    const range =
      picked.length === 0
        ? { start, to: turnEnd(ATLAS_THREAD, checkpoint) }
        : { start: start + Math.min(...picked), to: start + Math.max(...picked) + 1 };
    void fetch("/__workspace/show", { method: "POST", body: JSON.stringify(range) });
  }, [writesFiles, checkpoint, selectedPlay]);

  // A new memory starts plain: its lenses and filters are its own.
  const switchMemory = (key: MemoryKey) => {
    setMemoryKey(key);
    // A depth set by hand belongs to the memory it was set for.
    setDepthChoice(null);
    setLensSlots([]);
    setFilters(NO_FILTERS);
    setCheckpoint(0);
    setPlaying(false);
    setStep(null);
  };

  // Playback walks each checkpoint's plays, one hold each, then a settle beat
  // with nothing selected, then the next checkpoint; it stops after the last.
  // `step` is the step last shown, so a pause holds it and Play resumes after it.
  const [step, setStep] = useState<PlaybackStep | null>(null);
  useEffect(() => {
    if (!playing || thread === null || step === null) return;
    const timer = setTimeout(
      () => {
        const next = nextStep(thread, step);
        if (next === null) {
          setPlaying(false);
          return;
        }
        setStep(next);
        setCheckpoint(next.checkpoint);
        dispatchPlay({
          type: "select",
          reading: readingKey(memoryKey, next.checkpoint, whole, thisTurnOnly),
          index: next.play,
        });
      },
      holdSeconds(thread, step) * 1000,
    );
    return () => clearTimeout(timer);
  }, [playing, thread, step, memoryKey, whole, thisTurnOnly]);
  const togglePlayback = () => {
    if (playing) {
      // Paused on the play it was showing, which stays selected.
      setPlaying(false);
      return;
    }
    if (thread === null) return;
    const next = resumeStep(thread, step, checkpoint);
    setStep(next);
    setCheckpoint(next.checkpoint);
    dispatchPlay({
      type: "select",
      reading: readingKey(memoryKey, next.checkpoint, whole, thisTurnOnly),
      index: next.play,
    });
    setPlaying(true);
  };
  // A play chosen by hand pauses playback there; Play resumes after it.
  const choosePlayByHand = (index: PlayPick | null) => {
    setPlaying(false);
    // A file's plays chosen together: Play resumes after the last of them.
    if (index !== null) setStep({ checkpoint, play: Math.max(...pickedPlays(index)) });
    choosePlay(index);
    // A symbol's or a link's play opens whatever closed container holds it; a file's plays stay at the level.
    if (typeof index === "number") graph.current?.reveal(index);
  };

  // A turn is running while playback advances, and for a moment after a manual step,
  // standing in for the agent working that turn.
  const [manualSteps, setManualSteps] = useState(0);
  const [stepping, setStepping] = useState(false);
  useEffect(() => {
    if (manualSteps === 0) return;
    const timer = setTimeout(() => setStepping(false), TURN_AFTER_STEP_MS);
    return () => clearTimeout(timer);
  }, [manualSteps]);
  const stepTo = (next: (current: number) => number) => {
    // Stepping by hand pauses playback; Play then starts at that checkpoint's first play.
    setPlaying(false);
    setStep(null);
    setCheckpoint(next);
    setStepping(true);
    setManualSteps((count) => count + 1);
  };
  // Playback keeps the turn running the whole time it is on a checkpoint.
  const turnRunning = (playing && thread !== null) || stepping;

  useEffect(() => {
    const timer = setInterval(() => {
      const next = graph.current?.stats(performance.now());
      if (next === undefined) return;
      const fresh = {
        frames: next.framesLastSecond,
        total: next.totalFrames,
        animating: next.animating,
        inView: next.inView,
        slots: next.slots,
        shown: next.shown,
        labels: next.labels,
        radiusPx: `${next.radiusPx[0].toFixed(1)}–${next.radiusPx[1].toFixed(1)}${
          next.radiusPx[2] > 0 ? ` · story ${next.radiusPx[2].toFixed(1)}` : ""
        }`,
        edgePx: next.edgePx.map((px) => px.toFixed(1)).join(" · story "),
        beads: next.beads,
        mode: next.mode,
        drawCalls: next.drawCalls,
        renderMs: next.renderMs.map((ms) => ms.toFixed(2)).join(" / "),
        prepMs: next.prepMs.map((ms) => ms.toFixed(2)).join(" / "),
      };
      setStats((current) =>
        (Object.keys(fresh) as Array<keyof typeof fresh>).every(
          (key) => current[key] === fresh[key],
        )
          ? current
          : fresh,
      );
    }, 250);
    return () => clearInterval(timer);
  }, []);

  // Bench: reset to the reference workload (the synthetic 600-note memory,
  // whole, unfiltered, unlensed, nothing picked or playing), Fit, wait for
  // rest, then glide every node for three seconds and print the frame times
  // in the current mode. Nothing is restored afterwards.
  const startBench = () => {
    const reset = benchReset({
      whole,
      filters,
      lensSlots,
      play: selectedPlay,
      // The pick lives inside the graph, so it is cleared through its handle either way.
      picked: true,
      playing,
    });
    setWhole(reset.whole);
    setFilters(reset.filters);
    setLensSlots(reset.lensSlots);
    setPlaying(reset.playing);
    setStep(null);
    dispatchPlay({ type: "select", reading, index: reset.play });
    if (!reset.picked) graph.current?.clearPick();
    if (memoryKey !== "synthetic-600") switchMemory("synthetic-600");
    setBenchPending(true);
  };
  const synthReady = memoryKey === "synthetic-600" && (layoutInfo?.nodes ?? 0) >= 600;
  useEffect(() => {
    if (!benchPending || !synthReady) return;
    let cancelled = false;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const measure = async () => {
      // A beat for the reset to reach the graph, then Fit, then wait (up to 8 s) for rest.
      await sleep(300);
      if (cancelled) return;
      graph.current?.fit();
      setBenchLine(`waiting for rest (${mode})…`);
      for (let waited = 0; waited < 8000; waited += 100) {
        await sleep(100);
        if (cancelled) return;
        if (graph.current?.stats(performance.now()).animating === false) break;
      }
      setBenchLine(`running (${mode})…`);
      const result = (await graph.current?.bench()) ?? null;
      if (cancelled) return;
      setBenchPending(false);
      setBenchLine(
        result === null
          ? "no renderer"
          : `${mode}: render ${result.meanMs.toFixed(2)} / ${result.maxMs.toFixed(2)} ms, prep ${result.prepMeanMs.toFixed(2)} / ${result.prepMaxMs.toFixed(2)} ms over ${result.frames} frames (reference workload; nothing restored)`,
      );
    };
    void measure();
    return () => {
      cancelled = true;
    };
  }, [benchPending, synthReady, mode]);

  const say = (text: string) =>
    setLog((current) => [...current.slice(-3), { id: Date.now() + Math.random(), text }]);

  const toggleLens = (slot: number) =>
    setLensSlots((current) =>
      current.includes(slot) ? current.filter((each) => each !== slot) : [...current, slot],
    );

  const setSetting = <Key extends keyof GraphSettings>(key: Key, value: GraphSettings[Key]) => {
    if (key === "depth") setDepthChoice({ memory: memoryKey, depth: Number(value) });
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (!FORCES.has(key)) setSettings(next);
  };
  const commitDraft = () => setSettings(draft);

  return (
    // The theme's variables sit on the app, so they apply before the graph re-reads them.
    <div className="app" data-theme={theme}>
      <div className="strip">
        <div className="group">
          <span className="group-label">Memory</span>
          <select
            value={memoryKey}
            onChange={(event) =>
              switchMemory(MEMORY_KEYS.find((key) => key === event.target.value) ?? "almagest")
            }
          >
            {MEMORY_KEYS.map((key) => (
              <option key={key} value={key}>
                {MEMORY_LABELS[key]}
              </option>
            ))}
          </select>
          {syntheticSize(memoryKey) === null ? null : (
            <select
              aria-label="Checkpoints in the synthetic thread"
              value={threadLength}
              onChange={(event) => {
                setThreadLength(
                  SYNTHETIC_CHECKPOINTS.find((count) => count === Number(event.target.value)) ?? 10,
                );
                setCheckpoint(0);
                setPlaying(false);
                setStep(null);
              }}
            >
              {SYNTHETIC_CHECKPOINTS.map((count) => (
                <option key={count} value={count}>
                  {count} checkpoints
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="group">
          <span className="group-label">Reading</span>
          <button
            type="button"
            aria-pressed={!whole && thread !== null}
            disabled={thread === null}
            onClick={() => setWhole(false)}
          >
            Thread
          </button>
          <button
            type="button"
            aria-pressed={whole || thread === null}
            onClick={() => setWhole(true)}
          >
            Whole memory
          </button>
        </div>
        <div className="group">
          {RENDER_MODES.map((each) => (
            <button
              key={each}
              type="button"
              aria-pressed={mode === each}
              onClick={() => setMode(each)}
            >
              {MODE_LABELS[each]}
            </button>
          ))}
          <button type="button" onClick={() => graph.current?.fit()}>
            Fit
          </button>
          <button type="button" disabled={benchPending} onClick={startBench}>
            Bench
          </button>
        </div>
        <div className="group">
          <span className="group-label">Checkpoint</span>
          <button
            type="button"
            disabled={thread === null || checkpoint <= 0}
            onClick={() => stepTo((current) => Math.max(0, current - 1))}
            aria-label="Previous checkpoint"
          >
            ◀
          </button>
          <select
            value={checkpoint}
            disabled={thread === null}
            onChange={(event) => {
              const next = Number(event.target.value);
              stepTo(() => next);
            }}
          >
            {turns.map((turn, index) => (
              <option key={turn.id} value={index}>
                {index + 1}. {turn.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={thread === null || checkpoint >= lastCheckpoint}
            onClick={() => stepTo((current) => Math.min(lastCheckpoint, current + 1))}
            aria-label="Next checkpoint"
          >
            ▶
          </button>
          <button
            type="button"
            disabled={thread === null}
            aria-pressed={playing}
            onClick={togglePlayback}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <label>
            <input
              type="checkbox"
              disabled={thread === null}
              checked={thisTurnOnly}
              onChange={(event) => setThisTurnOnly(event.target.checked)}
            />
            this turn only
          </label>
        </div>
        <div className="group">
          <span className="group-label">Lenses</span>
          {memory.lenses.map((lens, slot) => (
            <button
              key={lens.name}
              type="button"
              aria-pressed={lensSlots.includes(slot)}
              onClick={() => toggleLens(slot)}
            >
              <span className="swatch" style={{ background: `var(--atlas-lens-${slot + 1})` }} />{" "}
              {lens.name}
            </button>
          ))}
        </div>
        <div className="group">
          <input
            type="search"
            placeholder="Search notes"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
          <label>
            <input
              type="checkbox"
              checked={filters.hideFrontier}
              onChange={(event) => setFilters({ ...filters, hideFrontier: event.target.checked })}
            />
            hide red links
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.hideOrphans}
              onChange={(event) => setFilters({ ...filters, hideOrphans: event.target.checked })}
            />
            hide orphans
          </label>
        </div>
        <div className="group">
          <button
            type="button"
            aria-pressed={theme === "dark"}
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>
          <button
            type="button"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            Settings
          </button>
        </div>
      </div>
      <div className="body">
        <div className="stage">
          <AtlasGraph
            ref={graph}
            memory={memory}
            thread={thread}
            checkpoint={checkpoint}
            play={selectedPlay}
            onPlayChange={choosePlay}
            onCursor={setCursorPlay}
            removed={removed}
            whole={whole}
            thisTurnOnly={thisTurnOnly}
            turnRunning={turnRunning}
            mode={mode}
            settings={shownSettings}
            filters={filters}
            lensSlots={lensSlots}
            labelFont={labelFont}
            themeKey={theme}
            {...(boundaries === undefined ? {} : { boundaries })}
            onLayout={setLayoutInfo}
            onOpenNote={(id) => say(`Open “${id}” — would open in the Atlas Editor`)}
            onFrontier={(id) =>
              say(`Frontier door: “Write the note ${id}.” staged in the composer`)
            }
          />
          {writesFiles ? <NoteEditPopup edits={noteEdits} /> : null}
          <CodeEditPopup
            story={codeView}
            checkpoint={checkpoint}
            play={selectedPlay}
            theme={theme}
          />
          {settingsOpen ? (
            <div className="settings">
              {SLIDERS.map(({ key, label }) => {
                const range = SETTING_RANGES[key];
                return [
                  <span key={`${key}-label`}>{label}</span>,
                  <input
                    key={key}
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    value={key === "depth" ? depth : draft[key]}
                    onChange={(event) => setSetting(key, Number(event.target.value))}
                    onPointerUp={commitDraft}
                    onKeyUp={commitDraft}
                  />,
                  <output key={`${key}-value`}>{key === "depth" ? depth : draft[key]}</output>,
                ];
              })}
              <div className="row-wide">
                <label>
                  <input
                    type="checkbox"
                    checked={draft.arrows}
                    onChange={(event) => setSetting("arrows", event.target.checked)}
                  />
                  arrows
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(DEFAULT_SETTINGS);
                    setSettings(DEFAULT_SETTINGS);
                    setDepthChoice(null);
                  }}
                >
                  Reset
                </button>
              </div>
              {hasKinds ? (
                <fieldset className="row-wide design-features">
                  <legend>Design</legend>
                  {FEATURE_LABELS.map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={draft.features[key]}
                        onChange={(event) =>
                          setSetting("features", { ...draft.features, [key]: event.target.checked })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {hasKinds ? (
                <dl className="row-wide shape-key" aria-label="Shapes">
                  {SHAPE_KEY.map(({ glyph, kinds }) => (
                    <div key={glyph}>
                      <dt>{glyph}</dt>
                      <dd>{kinds}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>
          ) : null}
          <div className="debug">
            {`frames/s  `}
            <b>{stats.frames}</b>
            {stats.animating ? "  (animating)" : "  (at rest)"}
            {`\nframes    ${stats.total}`}
            {`\nin view   ${stats.inView}/${stats.shown} · slots ${stats.slots} · labels ${stats.labels}`}
            {`\nradius px ${stats.radiusPx}`}
            {`\nedge px   ${stats.edgePx}`}
            {`\nbeads     ${stats.beads}`}
            {`\nmode      ${stats.mode} · draw calls ${stats.drawCalls}`}
            {`\nrender ms ${stats.renderMs} (mean / max, last 60)`}
            {`\nprep ms   ${stats.prepMs} (mean / max, last 60)`}
            {benchLine === null ? null : `\nbench     ${benchLine}`}
            {layoutInfo === null
              ? null
              : `\nnodes     ${layoutInfo.shownNodes}/${layoutInfo.nodes}\nedges     ${layoutInfo.shownEdges}/${layoutInfo.edges}\nlayout    ${layoutInfo.ms.toFixed(0)} ms (${layoutInfo.flat ? "flat" : "3D"} · ${layoutInfo.mode})`}
            {thread === null ? null : `\nturn      ${checkpoint + 1}/${turns.length}`}
            {turnRunning ? "\nturn running" : null}
          </div>
          <div className="log" aria-live="polite">
            {log.map((entry) => (
              <div key={entry.id}>{entry.text}</div>
            ))}
          </div>
        </div>
        {turn === undefined || before === null ? null : (
          <aside className="plays">
            <PlayByPlay
              turn={turn}
              notes={before}
              selected={selectedPlay}
              onSelect={choosePlayByHand}
              removals={removals}
              cursor={cursorPlay}
              {...(boundaries === undefined ? {} : { boundaries })}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

const root = document.querySelector("#root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

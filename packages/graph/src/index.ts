// d3-force-3d and troika-three-text ship no types; these declarations are part of the
// package, and a program that imports the package only sees them through its entry.
/// <reference path="./layout/d3-force-3d.d.ts" />
/// <reference path="./render/troika-three-text.d.ts" />
export { AtlasGraph } from "./AtlasGraph.tsx";
export type { AtlasGraphHandle, AtlasGraphProps, AtlasLayoutInfo } from "./AtlasGraph.tsx";
export { PlayByPlay } from "./PlayByPlay.tsx";
export { CursorPlays, type CursorPlaysProps } from "./CursorPlays.tsx";
export {
  RENDER_MODES,
  type BenchResult,
  type RenderMode,
  type RendererFactory,
} from "./render/renderer.ts";
// The only renderer this entry reaches: the app's Graph tab draws with Lean alone. The others
// (and Pixi) are the playground's, in `render/renderers.ts`.
export { createLeanRenderer } from "./render/lean/LeanRenderer.ts";
export type { BenchDriver, FrameSample, GpuMemory, SampleOptions } from "./render/probe.ts";
export type { LabelBoxes } from "./render/pool.ts";
export type { PlayByPlayProps } from "./PlayByPlay.tsx";
export {
  describePlays,
  memoryBefore,
  pickedPlays,
  playRows,
  playTree,
  removalsAt,
  removalsIn,
  turnMoves,
  selectedIn,
  selectPlay,
  type Play,
  type Move,
  type MoveVerb,
  type PlayGroup,
  type PlayLeaf,
  type PlayPick,
  type PlayRow,
  type PlaySymbol,
  type PlaySelection,
  type PlaySelectionAction,
} from "./model/plays.ts";
export type {
  Boundaries,
  LensEdge,
  Memory,
  MemoryLens,
  MemoryLink,
  MemoryNote,
} from "./model/memory.ts";
export { applyFeatures } from "./model/features.ts";
export { SHAPE_KEY } from "./model/kinds.ts";
export type { ThreadEvent, ThreadRecord, ThreadTurn } from "./model/thread.ts";
export { NO_FILTERS, type GraphFilters } from "./model/search.ts";
export { atBenchWorkload, BENCH_WORKLOAD, benchReset, type BenchWorkload } from "./model/bench.ts";
export {
  firstStep,
  holdSeconds,
  LINK_HOLD_SECONDS,
  nextStep,
  PLAY_HOLD_SECONDS,
  resumeStep,
  SETTLE_SECONDS,
  type PlaybackStep,
} from "./model/playback.ts";
export {
  DEFAULT_SETTINGS,
  DesignFeatures,
  FEATURE_LABELS,
  NO_FEATURES,
  defaultDepth,
  GraphSettings,
  SETTING_RANGES,
  loadSettings,
  saveSettings,
} from "./model/settings.ts";

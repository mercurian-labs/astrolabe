/**
 * The bench's reference workload, so a bench in one mode compares with a
 * bench in another: the whole memory shown, nothing searched, filtered, lensed,
 * picked, or selected, and playback stopped. The host resets to it before
 * measuring and restores nothing afterwards.
 */
import type { PlayPick } from "./plays.ts";
import { NO_FILTERS, type GraphFilters } from "./search.ts";

export interface BenchWorkload {
  readonly whole: boolean;
  readonly filters: GraphFilters;
  readonly lensSlots: ReadonlyArray<number>;
  readonly play: PlayPick | null;
  readonly picked: boolean;
  readonly playing: boolean;
}

export const BENCH_WORKLOAD: BenchWorkload = {
  whole: true,
  filters: NO_FILTERS,
  lensSlots: [],
  play: null,
  picked: false,
  playing: false,
};

/** `state` reset to the reference workload; whatever else it holds (mode, theme, settings) is kept. */
export function benchReset<State extends BenchWorkload>(state: State): State {
  return { ...state, ...BENCH_WORKLOAD };
}

/** Whether `state` is already the reference workload. */
export function atBenchWorkload(state: BenchWorkload): boolean {
  return (
    state.whole &&
    state.filters.search.trim() === "" &&
    !state.filters.hideFrontier &&
    !state.filters.hideOrphans &&
    state.lensSlots.length === 0 &&
    state.play === null &&
    !state.picked &&
    !state.playing
  );
}

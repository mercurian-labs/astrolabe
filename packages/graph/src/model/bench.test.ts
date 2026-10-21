import { describe, expect, it } from "vite-plus/test";

import { atBenchWorkload, BENCH_WORKLOAD, benchReset } from "./bench.ts";
import { NO_FILTERS } from "./search.ts";

describe("the bench's reference workload", () => {
  const busy = {
    whole: false,
    filters: { search: "graph", hideFrontier: true, hideOrphans: true },
    lensSlots: [0, 2],
    play: 3,
    picked: true,
    playing: true,
    mode: "pixi",
    theme: "dark",
  };

  it("resets every part of the workload and keeps everything else", () => {
    const reset = benchReset(busy);
    expect(reset).toEqual({ ...BENCH_WORKLOAD, mode: "pixi", theme: "dark" });
    expect(reset.filters).toBe(NO_FILTERS);
    expect(atBenchWorkload(reset)).toBe(true);
  });

  it("tells a busy workload from the reference one, part by part", () => {
    expect(atBenchWorkload(busy)).toBe(false);
    for (const part of Object.keys(BENCH_WORKLOAD) as Array<keyof typeof BENCH_WORKLOAD>) {
      expect(atBenchWorkload({ ...BENCH_WORKLOAD, [part]: busy[part] })).toBe(false);
    }
  });
});

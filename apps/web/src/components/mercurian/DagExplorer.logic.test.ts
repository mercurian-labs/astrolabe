import { describe, expect, it } from "vite-plus/test";

import type { PlanTimelineItem } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { message } from "../../test/fixtures/timeline";

import {
  DagExplorerDisplaySettings,
  decodeDagExplorerDisplaySettings,
  DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS,
  MAP_PROXIMITY_FALLOFF,
  MAP_PROXIMITY_MAX_SCALE,
  proximityScale,
  wheelIntent,
} from "./DagExplorer.logic";

const commit = (name: string, sequence: number, parents: ReadonlyArray<string>): PlanTimelineItem =>
  message(name, {
    sequence,
    parents,
    createdAt: "2026-08-03T00:00:00.000Z",
  });

const timeline: ReadonlyArray<PlanTimelineItem> = [
  commit("a", 1, []),
  commit("l", 2, ["a"]),
  commit("r", 3, ["a"]),
  commit("m", 4, ["l", "r"]),
];

describe("wheelIntent", () => {
  it("maps plain wheel deltas to canvas translation", () => {
    expect(wheelIntent({ ctrlKey: false, metaKey: false, deltaX: 12, deltaY: -8 })).toEqual({
      kind: "pan",
      dx: 12,
      dy: -8,
    });
  });

  it("maps control- and command-wheel to zoom in the delta direction", () => {
    const controlIn = wheelIntent({ ctrlKey: true, metaKey: false, deltaX: 0, deltaY: -20 });
    const commandOut = wheelIntent({ ctrlKey: false, metaKey: true, deltaX: 0, deltaY: 20 });
    expect(controlIn.kind).toBe("zoom");
    expect(controlIn.kind === "zoom" && controlIn.factor).toBeGreaterThan(1);
    expect(commandOut.kind).toBe("zoom");
    expect(commandOut.kind === "zoom" && commandOut.factor).toBeLessThan(1);
  });
});

describe("display settings", () => {
  void timeline;

  it("round-trips a valid persisted value", () => {
    const settings = { layout: "grid", nodeSize: 2.25, lineThickness: 0.75 } as const;
    const encoded = Schema.encodeSync(DagExplorerDisplaySettings)(settings);
    expect(Schema.decodeUnknownSync(DagExplorerDisplaySettings)(encoded)).toEqual(settings);
  });

  it("falls back as a whole for malformed or out-of-range values", () => {
    expect(
      decodeDagExplorerDisplaySettings({ layout: "force", nodeSize: 1, lineThickness: 1 }),
    ).toBe(DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS);
    expect(
      decodeDagExplorerDisplaySettings({ layout: "grid", nodeSize: 5.01, lineThickness: 1 }),
    ).toBe(DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS);
    expect(
      decodeDagExplorerDisplaySettings({ layout: "grid", nodeSize: 1, lineThickness: -0.01 }),
    ).toBe(DEFAULT_DAG_EXPLORER_DISPLAY_SETTINGS);
  });
});

describe("map sizing", () => {
  it("eases monotonically from its maximum to one at the falloff", () => {
    expect(proximityScale(0)).toBe(MAP_PROXIMITY_MAX_SCALE);
    expect(proximityScale(MAP_PROXIMITY_FALLOFF)).toBe(1);
    expect(proximityScale(MAP_PROXIMITY_FALLOFF * 2)).toBe(1);

    const samples = [0, 12, 24, 36, 48, 60, 72].map(proximityScale);
    for (const [index, scale] of samples.entries()) {
      if (index === 0) continue;
      expect(scale).toBeLessThanOrEqual(samples[index - 1]!);
    }
  });
});

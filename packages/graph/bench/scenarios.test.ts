import { describe, expect, it } from "vite-plus/test";

import { syntheticMemory } from "../fixtures/synthetic.ts";
import { syntheticThread } from "../fixtures/syntheticThread.ts";
import { LINK_HOLD_SECONDS } from "../src/model/playback.ts";
import {
  hoverTargets,
  panDeltas,
  SCENARIO_NAMES,
  SCENARIOS,
  storyPlan,
  STORY_CHECKPOINTS,
  STORY_GLIDE_SECONDS,
  zoomFactors,
} from "./scenarios.ts";

describe("the scenarios", () => {
  it("names every scenario, and every step says what it measures", () => {
    for (const name of SCENARIO_NAMES) {
      const scenario = SCENARIOS[name];
      expect(scenario.name).toBe(name);
      expect(scenario.steps.length).toBeGreaterThan(0);
      for (const step of scenario.steps) expect(step.measures.length).toBeGreaterThan(0);
    }
    expect(SCENARIOS.rest.steps[0]).toMatchObject({
      kind: "rest",
      seconds: 10,
      measures: ["rest"],
    });
    expect(SCENARIOS.story.steps[0]?.measures).toContain("beads");
  });

  it("pans around a closed loop and zooms back to where it began", () => {
    const deltas = panDeltas(3);
    expect(deltas).toHaveLength(180);
    const [dx, dy] = deltas.reduce(([x, y], [ddx, ddy]) => [x + ddx, y + ddy], [0, 0]);
    expect(dx).toBeCloseTo(0, 6);
    expect(dy).toBeCloseTo(0, 6);
    const factors = zoomFactors(3, 60, 3);
    expect(factors.reduce((product, factor) => product * factor, 1)).toBeCloseTo(1, 9);
    expect(
      factors.slice(0, factors.length / 2).reduce((product, factor) => product * factor, 1),
    ).toBeCloseTo(3, 6);
  });

  it("hovers the same distinct notes for every mode", () => {
    const candidates = Array.from({ length: 200 }, (_, index) => 199 - index);
    const targets = hoverTargets(candidates, 50);
    expect(targets).toHaveLength(50);
    expect(new Set(targets).size).toBe(50);
    expect(hoverTargets(candidates.toReversed(), 50)).toEqual(targets);
    expect(hoverTargets([3, 4], 50)).toHaveLength(2);
  });

  it("plans the story: a glide per checkpoint, and a link hold where the turn links", () => {
    const thread = syntheticThread(syntheticMemory({ notes: 600 }), { checkpoints: 10 });
    const plan = storyPlan(thread, STORY_CHECKPOINTS);
    expect(plan).toHaveLength(STORY_CHECKPOINTS);
    plan.forEach((beat, checkpoint) => {
      expect(beat.checkpoint).toBe(checkpoint);
      expect(beat.glideSeconds).toBe(STORY_GLIDE_SECONDS);
      const links =
        thread.turns[checkpoint]?.events.some((event) => event.kind === "link") ?? false;
      expect(beat.linkSeconds).toBe(links ? LINK_HOLD_SECONDS : 0);
    });
    expect(plan.some((beat) => beat.linkSeconds > 0)).toBe(true);
  });
});

import { describe, expect, it } from "vite-plus/test";

import {
  easeAttention,
  NodeSprings,
  nodeTraits,
  riseAmount,
  riseDelays,
  travelDrift,
  waveEnvelope,
  WAVE_SECONDS,
} from "./motion.ts";

describe("nodeTraits", () => {
  it("gives every node its own stiffness and wobble within the dictionary's ranges", () => {
    for (let index = 0; index < 500; index += 1) {
      const traits = nodeTraits(index);
      expect(traits.stiffness).toBeGreaterThanOrEqual(42 * 0.45);
      expect(traits.stiffness).toBeLessThanOrEqual(42 * 1.85);
      for (const axis of [0, 1, 2] as const) {
        expect(traits.amplitude[axis]).toBeGreaterThanOrEqual(1.35);
        expect(traits.amplitude[axis]).toBeLessThanOrEqual(4.65);
        expect(traits.omega[axis]).toBeGreaterThanOrEqual(0.19 * 0.6);
        expect(traits.omega[axis]).toBeLessThanOrEqual(0.19 * 1.7);
      }
    }
    expect(nodeTraits(7)).toEqual(nodeTraits(7));
    expect(nodeTraits(7).stiffness).not.toBe(nodeTraits(8).stiffness);
  });
});

describe("NodeSprings", () => {
  const settleSteps = (stiffness: number) => {
    const springs = new NodeSprings([stiffness], 0.05);
    // A note gathering into the reading: about ten units away.
    springs.setTarget(0, [10, -4, 2]);
    let steps = 0;
    while (springs.step(1 / 60)) steps += 1;
    return { steps, values: [...springs.values] };
  };

  it("settles within a bounded number of steps at both ends of the stiffness range", () => {
    for (const stiffness of [19, 78]) {
      const { steps, values } = settleSteps(stiffness);
      // Under five seconds at 60 frames per second, even for the softest spring.
      expect(steps).toBeLessThan(300);
      expect(values).toEqual([10, -4, 2]);
    }
    // A softer spring arrives later: a group in transition does not move in lockstep.
    expect(settleSteps(19).steps).toBeGreaterThan(settleSteps(78).steps);
  });

  it("leaves a spring at rest when aimed again at the target it holds, however that target was computed", () => {
    const springs = new NodeSprings([42, 42]);
    // Targets a float32 array cannot hold exactly, as a gathering's offsets are.
    const target = [0.1 + 0.2, Math.PI * 7, -1 / 3];
    springs.setTarget(0, target);
    springs.settle();
    const before = [...springs.values];
    springs.setTarget(0, [...target]);
    springs.setTarget(1, [0, 0, 0]);
    expect(springs.settled).toBe(true);
    expect(springs.step(1 / 60)).toBe(false);
    expect([...springs.values]).toEqual(before);
    expect(springs.progressOf(0)).toBe(1);
    expect(springs.journeyOf(0)).toBe(0);
    // A real change still moves it.
    springs.setTarget(0, [1, 2, 3]);
    expect(springs.settled).toBe(false);
  });

  it("clamps long frames so a returning tab does not explode", () => {
    const springs = new NodeSprings([78]);
    springs.setTarget(0, [10, 0, 0]);
    springs.step(2);
    expect(Math.abs(springs.values[0] ?? 0)).toBeLessThan(20);
  });
});

describe("travel drift and rising", () => {
  it("wobbles only a node on its way: nothing as it sets off, nothing as it lands", () => {
    expect(travelDrift(0, 20)).toBe(0);
    expect(travelDrift(1, 20)).toBe(0);
    expect(travelDrift(0.5, 20)).toBe(1);
    expect(travelDrift(0.01, 20)).toBeLessThan(0.05);
    expect(travelDrift(0.999, 20)).toBeLessThan(0.01);
    // A short hop does not wobble.
    expect(travelDrift(0.5, 1)).toBe(0);
  });

  it("carries a journey's progress over a retarget mid-flight, so the wobble goes on without a jump", () => {
    const springs = new NodeSprings([42]);
    springs.setTarget(0, [20, 0, 0]);
    for (let frame = 0; frame < 12; frame += 1) springs.step(1 / 60);
    const along = springs.progressOf(0);
    expect(along).toBeGreaterThan(0.1);
    expect(along).toBeLessThan(0.9);
    // A new target further on: the node is still as far along its (longer) journey.
    springs.setTarget(0, [40, 5, 0]);
    expect(springs.progressOf(0)).toBeCloseTo(along, 6);
    while (springs.step(1 / 60));
    expect(springs.progressOf(0)).toBe(1);
  });

  it("staggers a rising group outward from its centroid, up to 0.9 s", () => {
    const positions = new Float32Array([0, 0, 0, 10, 0, 0, -10, 0, 0, 0, 5, 0]);
    const delays = riseDelays(positions, [0, 1, 2, 3]);
    expect(Math.max(...delays)).toBeCloseTo(0.9);
    expect(delays[0]).toBeLessThan(delays[1] ?? 0);
    expect(riseAmount(0.2, 0.3)).toBe(0);
    expect(riseAmount(1.8, 0.3)).toBe(1);
  });
});

describe("edge easing and the landing wave", () => {
  it("eases an edge fully in or out within half a second, then holds its target", () => {
    for (const [from, to] of [
      [0, 1],
      [1, 0],
      [0.6, 0],
      [0, 0.28],
    ] as const) {
      let value: number = from;
      let seconds = 0;
      while (value !== to) {
        value = easeAttention(value, to, 1 / 60);
        seconds += 1 / 60;
      }
      expect(seconds).toBeLessThanOrEqual(0.5);
    }
    expect(easeAttention(0.999, 1, 1 / 60)).toBe(1);
    expect(easeAttention(0.5, 1, 1 / 60)).toBeLessThan(1);
  });

  it("rings down to about nothing by three seconds", () => {
    for (const seed of [0, 0.5, 1]) {
      expect(waveEnvelope(0, seed)).toBe(1);
      expect(waveEnvelope(WAVE_SECONDS, seed)).toBeLessThan(0.012);
    }
  });
});

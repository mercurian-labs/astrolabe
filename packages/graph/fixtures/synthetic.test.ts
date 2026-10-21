import { describe, expect, it } from "vite-plus/test";

import { indexMemory } from "../src/model/memory.ts";
import { clusterName, SYNTHETIC_SIZES, syntheticMemory } from "./synthetic.ts";

describe("syntheticMemory", () => {
  const memory = syntheticMemory();
  const index = indexMemory(memory.notes, memory.links);

  it("is the same for the same seed", () => {
    expect(syntheticMemory()).toEqual(memory);
    expect(syntheticMemory({ seed: 7 })).not.toEqual(memory);
    expect(syntheticMemory({ notes: 10_000 })).toEqual(syntheticMemory({ notes: 10_000 }));
  });

  it("has the scale asked for: 600 notes, about 2,000 links, a tenth red links, a few orphans", () => {
    expect(memory.notes).toHaveLength(600);
    expect(new Set(memory.notes.map((note) => note.id)).size).toBe(600);
    expect(memory.links.length).toBeGreaterThan(1500);
    expect(memory.links.length).toBeLessThan(2500);
    const frontier = memory.notes.filter((note) => note.frontier).length;
    expect(frontier).toBeGreaterThan(30);
    expect(frontier).toBeLessThan(90);
    expect(index.orphans.size).toBeGreaterThanOrEqual(3);
  });

  it("links red links only as targets", () => {
    const frontier = new Set(memory.notes.filter((note) => note.frontier).map((note) => note.id));
    expect(memory.links.some((link) => frontier.has(link.from))).toBe(false);
    for (const id of frontier) expect(index.degree.get(id)).toBeGreaterThan(0);
  });

  it("scales to every size with readable, unique names and the same proportions", () => {
    for (const size of SYNTHETIC_SIZES) {
      const scaled = syntheticMemory({ notes: size });
      expect(scaled.notes).toHaveLength(size);
      expect(new Set(scaled.notes.map((note) => note.id)).size).toBe(size);
      const written = scaled.notes.filter((note) => !note.frontier).length;
      const frontierShare = (size - written) / size;
      expect(frontierShare).toBeGreaterThan(0.07);
      expect(frontierShare).toBeLessThan(0.13);
      // About three links per written note once duplicates fold.
      expect(scaled.links.length / written).toBeGreaterThan(2.5);
      expect(scaled.links.length / written).toBeLessThan(4.2);
      expect(scaled.notes.every((note) => note.group !== undefined && note.name.length < 40)).toBe(
        true,
      );
    }
    expect(clusterName(3)).toBe("Signal");
    expect(clusterName(16)).toBe("Orbit North");
    expect(clusterName(16 * 17)).toBe("Orbit North 2");
  });

  it("generates 100,000 notes in one pass: well under a generous time ceiling", () => {
    const started = performance.now();
    const large = syntheticMemory({ notes: 100_000 });
    const elapsed = performance.now() - started;
    expect(large.notes).toHaveLength(100_000);
    expect(elapsed).toBeLessThan(3000);
  });
});

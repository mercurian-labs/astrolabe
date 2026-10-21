import { describe, expect, it } from "vite-plus/test";

import almagest from "../../fixtures/almagest.json";
import { syntheticMemory } from "../../fixtures/synthetic.ts";
import { syntheticThread } from "../../fixtures/syntheticThread.ts";
import { ATLAS_THREAD } from "../../fixtures/thread.ts";
import { syntheticTree } from "../../fixtures/syntheticTree.ts";
import { readingAt } from "./reading.ts";
import {
  DEFAULT_SETTINGS,
  defaultDepth,
  decodeSettings,
  encodeSettings,
  loadSettings,
  NO_FEATURES,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from "./settings.ts";

describe("settings", () => {
  it("round-trips through storage", () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    };
    const settings = { ...DEFAULT_SETTINGS, nodeSize: 2, arrows: true, depth: 2 };
    saveSettings(storage, settings);
    expect(stored.has(SETTINGS_STORAGE_KEY)).toBe(true);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it("keeps the design features, and reads settings stored before them with every feature off", () => {
    const on = { ...DEFAULT_SETTINGS, features: { ...NO_FEATURES, boundaries: true } };
    expect(decodeSettings(encodeSettings(on))).toEqual(on);
    const older = JSON.parse(encodeSettings({ ...DEFAULT_SETTINGS, nodeSize: 2 }));
    delete older.features;
    expect(decodeSettings(JSON.stringify(older))).toEqual({ ...DEFAULT_SETTINGS, nodeSize: 2 });
    expect(DEFAULT_SETTINGS.features).toEqual(NO_FEATURES);
  });

  it("fails closed to the defaults as one set", () => {
    expect(decodeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(decodeSettings("not json")).toEqual(DEFAULT_SETTINGS);
    const outOfRange = JSON.parse(encodeSettings(DEFAULT_SETTINGS));
    outOfRange.nodeSize = 99;
    expect(decodeSettings(JSON.stringify(outOfRange))).toEqual(DEFAULT_SETTINGS);
    expect(
      loadSettings({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});

describe("the reading depth a memory starts at", () => {
  it("is 0 for a codebase, whose reading is its worked notes alone", () => {
    const tree = syntheticTree();
    expect(defaultDepth(tree, null)).toBe(0);
    // A codebase written by its thread: the writes carry the parents.
    const written = {
      id: "code",
      notes: [],
      links: [],
      lenses: [],
    };
    const thread = {
      id: "t",
      title: "t",
      memoryId: "code",
      turns: [
        {
          id: "t0",
          label: "t0",
          events: [
            {
              kind: "write" as const,
              note: "a.ts#f",
              parent: "a.ts",
              noteKind: "function" as const,
            },
          ],
        },
      ],
    };
    expect(defaultDepth(written, thread)).toBe(0);
    // At depth 0 nothing recedes around the worked notes; the setting can still raise it.
    const synthetic = syntheticThread(tree, { checkpoints: 8 });
    expect(readingAt(tree, synthetic, 7, { depth: 0, thisTurnOnly: false }).around.size).toBe(0);
    expect(
      readingAt(tree, synthetic, 7, { depth: 1, thisTurnOnly: false }).around.size,
    ).toBeGreaterThan(0);
  });

  it("stays 1 for almagest and the synthetic memories", () => {
    expect(defaultDepth(almagest, ATLAS_THREAD)).toBe(1);
    const memory = syntheticMemory({ notes: 600 });
    expect(defaultDepth(memory, syntheticThread(memory, { checkpoints: 10 }))).toBe(1);
  });
});

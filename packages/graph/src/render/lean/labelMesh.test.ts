import { Texture } from "three";
import { describe, expect, it } from "vite-plus/test";

import { LabelLayer, type Glyphs } from "./labelMesh.ts";

const atlas = { texture: new Texture(), glyphSize: 64, exponent: 9 };

/** A name's glyphs as a typesetter would give them: one unit-wide glyph per letter. */
function glyphsOf(name: string): Glyphs {
  const bounds: Array<number> = [];
  [...name].forEach((_, at) => bounds.push(at, -0.5, at + 1, 0.5));
  return { bounds, atlas: [...name].map((_, at) => at + 1), sdf: atlas };
}

/** Draw `labels` as one frame, writing any glyphs a slot is waiting for. */
function frame(
  layer: LabelLayer,
  labels: ReadonlyArray<{ node: number; name: string; x: number; opacity: number }>,
) {
  layer.begin();
  const slots = labels.map(({ node, name, x, opacity }) =>
    layer.place(node, name, x, 0, 12, opacity, 0),
  );
  layer.end();
  for (const { slot, name } of layer.pending()) layer.setGlyphs(slot, name, glyphsOf(name));
  return slots;
}

const slotsOf = (layer: LabelLayer) => layer.slotTexture.image.width;
/** Where a slot's fill opacity sits in the slot texture: row 1, first channel. */
const fillAt = (layer: LabelLayer, slot: number) => (slotsOf(layer) + slot) * 4;
const opacityOf = (layer: LabelLayer, slot: number | undefined) =>
  slot === undefined ? NaN : (layer.slotTexture.image.data?.[fillAt(layer, slot)] ?? NaN);

describe("LabelLayer", () => {
  const threadsLabel = { node: 3, name: "Threads", x: 10, opacity: 1 };
  const mergesLabel = { node: 8, name: "Merges", x: 40, opacity: 0.6 };
  const labels = [threadsLabel, mergesLabel];

  it("shows a label only once its own glyphs are written, and writes them once per name", () => {
    const layer = new LabelLayer(4, 16, false);
    const [threads] = frame(layer, labels);
    // First frame: glyphs arrive after the frame, so nothing drew.
    expect(opacityOf(layer, threads)).toBe(0);
    frame(layer, labels);
    expect(opacityOf(layer, threads)).toBe(1);
    expect(layer.pending()).toEqual([]);
    expect(layer.setGlyphs(threads ?? -1, "Threads", glyphsOf("Threads"))).toBe(false);
  });

  it("uploads nothing for a frame where no label changed, or for a zoom", () => {
    const layer = new LabelLayer(4, 16, true);
    frame(layer, labels);
    frame(layer, labels);
    const uploads = layer.slotTexture.version;
    frame(layer, labels);
    layer.setWorldPerPixel(0.25);
    frame(layer, labels);
    expect(layer.slotTexture.version).toBe(uploads);
  });

  it("changes only the slot whose opacity changed, as a story does", () => {
    const layer = new LabelLayer(4, 16, false);
    frame(layer, labels);
    const [threads, merges] = frame(layer, labels);
    const before = [...(layer.slotTexture.image.data ?? [])];
    const uploads = layer.slotTexture.version;
    frame(layer, [threadsLabel, { ...mergesLabel, opacity: 0.2 }]);
    expect(layer.slotTexture.version).toBe(uploads + 1);
    const after = [...(layer.slotTexture.image.data ?? [])];
    const changed = after.flatMap((value, at) => (value === before[at] ? [] : [at]));
    expect(changed).toEqual([fillAt(layer, merges ?? -1)]);
    expect(opacityOf(layer, threads)).toBe(1);
  });

  it("hides a released label and gives its slot to the next note with that note's glyphs", () => {
    const layer = new LabelLayer(1, 16, false);
    frame(layer, labels.slice(0, 1));
    const [slot] = frame(layer, labels.slice(0, 1));
    frame(layer, []);
    expect(opacityOf(layer, slot)).toBe(0);
    const [reused] = frame(layer, [{ node: 9, name: "Composer", x: 5, opacity: 1 }]);
    expect(reused).toBe(slot);
    // The old name's glyphs are never shown for the new note.
    expect(opacityOf(layer, reused)).toBe(0);
    frame(layer, [{ node: 9, name: "Composer", x: 5, opacity: 1 }]);
    expect(opacityOf(layer, reused)).toBe(1);
  });
});

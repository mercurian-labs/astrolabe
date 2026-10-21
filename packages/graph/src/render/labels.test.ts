import { Mesh, PerspectiveCamera, type Material } from "three";
import { describe, expect, it, vi } from "vite-plus/test";

import { Labels } from "./labels.ts";
import { NodeState } from "./nodeState.ts";
import { LABEL_BUDGET } from "./pool.ts";

// troika builds its materials and geometry lazily and needs WebGL to sync; a
// stand-in Text with the same ownership (its own base material, a material
// derived from it, its own geometry) is enough to check what disposal frees.
// The factory is hoisted above the imports, so it loads three itself.
vi.mock("troika-three-text", async () => {
  const { BufferGeometry, Material, Mesh } = await import("three");
  class Text extends Mesh {
    text = "";
    font: string | null = null;
    fontSize = 1;
    anchorX = "left";
    anchorY = "middle";
    color: unknown = 0;
    fillOpacity = 1;
    constructor() {
      const base = new Material();
      const derived = Object.assign(new Material(), { baseMaterial: base });
      super(new BufferGeometry(), derived);
    }
    sync(callback?: () => void) {
      callback?.();
    }
    dispose() {
      this.geometry.dispose();
    }
  }
  /** A batch holds its members without drawing them itself. */
  class BatchedText extends Text {
    readonly members = new Set<Text>();
    addText(text: Text) {
      this.members.add(text);
    }
    removeText(text: Text) {
      this.members.delete(text);
    }
  }
  return { Text, BatchedText };
});

/** Label `count` notes, all in view and shown, and draw one frame. */
function drawLabels(names: ReadonlyArray<string>) {
  const labels = new Labels(
    (index) => names[index] ?? "",
    names.length,
    undefined,
    () => {},
  );
  const state = new NodeState(names.length);
  names.forEach((_, index) => {
    state.style.hold(index, [1, 1, 0, 0]);
    state.radius.hold(index, [1]);
  });
  const camera = new PerspectiveCamera(40, 1, 0.5, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const drawn = labels.update(
    {
      camera,
      state,
      fade: { near: 1000, far: 2000, strength: 1 },
      distance: () => 100,
      worldPerPixel: () => 0.1,
      middle: 100,
      forced: () => false,
      outlined: () => false,
    },
    new Uint8Array(names.length).fill(1),
  );
  return { labels, drawn };
}

describe("Labels", () => {
  it("owns a Text only for each label it draws, within the budget", () => {
    const names = Array.from({ length: LABEL_BUDGET + 25 }, (_, index) => `Note ${index}`);
    const { labels, drawn } = drawLabels(names);
    expect(drawn).toBe(LABEL_BUDGET);
    expect(labels.pooled).toBe(LABEL_BUDGET);
    expect(labels.cut).toBe(25);
  });
});

describe("Labels.dispose", () => {
  it("frees every label's derived material, base material, and geometry", () => {
    const { labels } = drawLabels(["Memory", "Threads", "Atlas Graph"]);
    const texts: ReadonlyArray<Mesh> = labels.texts;
    expect(texts).toHaveLength(3);
    // Every label draws in one of two batches: two draw calls, whatever the count.
    expect(labels.group.children).toHaveLength(2);
    const spies = texts.map((text) => {
      const derived = text.material as Material & { baseMaterial: Material };
      return {
        derived: vi.spyOn(derived, "dispose"),
        base: vi.spyOn(derived.baseMaterial, "dispose"),
        geometry: vi.spyOn(text.geometry, "dispose"),
      };
    });
    labels.dispose();
    for (const spy of spies) {
      expect(spy.derived).toHaveBeenCalled();
      expect(spy.base).toHaveBeenCalled();
      expect(spy.geometry).toHaveBeenCalled();
    }
    expect(labels.group.children).toHaveLength(0);
  });
});

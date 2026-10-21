import { describe, expect, it } from "vite-plus/test";

import { LabelFaces, type FontSet, type Loadable } from "./fonts.ts";

/** A face whose load resolves when the test says so. */
function fakeFace() {
  let land = () => {};
  const loaded = new Promise<void>((resolve) => {
    land = resolve;
  });
  const face: Loadable = { load: () => loaded };
  return { face, land };
}

function fakeFonts() {
  const faces = new Set<Loadable>();
  const fonts: FontSet<Loadable> = {
    add: (face) => faces.add(face),
    delete: (face) => faces.delete(face),
  };
  return { fonts, faces };
}

describe("LabelFaces", () => {
  it("adds a loaded face, replaces it with the next, and removes it on dispose", async () => {
    const { fonts, faces } = fakeFonts();
    const first = fakeFace();
    const second = fakeFace();
    const queue = [first, second];
    const labelFaces = new LabelFaces(fonts, () => queue.shift()?.face ?? first.face);
    first.land();
    expect(await labelFaces.load("Label", "a.woff")).toBe(true);
    expect([...faces]).toEqual([first.face]);
    second.land();
    expect(await labelFaces.load("Label", "b.woff")).toBe(true);
    expect([...faces]).toEqual([second.face]);
    labelFaces.dispose();
    expect(faces.size).toBe(0);
  });

  it("never leaves a face in the document when its load lands after dispose", async () => {
    const { fonts, faces } = fakeFonts();
    const late = fakeFace();
    const labelFaces = new LabelFaces(fonts, () => late.face);
    const loading = labelFaces.load("Label", "a.woff");
    labelFaces.dispose();
    late.land();
    expect(await loading).toBe(false);
    expect(faces.size).toBe(0);
  });
});

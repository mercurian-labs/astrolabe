/**
 * Region names in the perspective (and flat) Atlas renderer: troika SDF text
 * facing the camera, small and receded, just inside each named disc's upper
 * left. Pooled by container, so a name keeps its Text while it stays named.
 */
import { Group, Vector3, type Camera, type Color } from "three";
import { Text } from "troika-three-text";

import type { Region } from "../model/view.ts";
import { StickyPool } from "./pool.ts";
import { namedRegions, REGION_NAME_OPACITY, REGION_NAME_PIXELS } from "./regions.ts";

const right = new Vector3();
const up = new Vector3();
const at = new Vector3();

export class RegionNames {
  readonly group = new Group();
  readonly #pool: StickyPool<Text>;
  readonly #ready = new WeakSet<Text>();
  readonly #onSynced: () => void;
  #ink: Color | null = null;

  constructor(onSynced: () => void) {
    this.#onSynced = onSynced;
    this.#pool = new StickyPool(
      () => {
        const text = new Text();
        text.fontSize = 1;
        text.anchorX = "left";
        text.anchorY = "middle";
        text.renderOrder = -1;
        text.depthOffset = 0;
        text.fillOpacity = REGION_NAME_OPACITY;
        text.visible = false;
        if (this.#ink !== null) text.color = this.#ink.clone();
        this.group.add(text);
        return text;
      },
      (text) => {
        text.visible = false;
      },
    );
  }

  setColor(color: Color): void {
    this.#ink = color.clone();
    for (const text of this.#pool.items) text.color = color.clone();
  }

  /**
   * Name the regions large enough on screen this frame. `worldPerPixel` is
   * world units per CSS pixel at a camera distance; `distance` reads a
   * point's distance from the camera.
   */
  update(
    regions: ReadonlyArray<Region>,
    circles: Float32Array,
    camera: Camera,
    distance: (point: Vector3) => number,
    worldPerPixel: (distance: number) => number,
    middle: number,
  ): void {
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    this.#pool.begin();
    for (const position of namedRegions(regions, circles, 1 / worldPerPixel(middle))) {
      const region = regions[position];
      if (region === undefined) continue;
      const r = circles[position * 4 + 3] ?? 0;
      const { item: text } = this.#pool.take(region.note);
      if (text.text !== region.name) {
        text.text = region.name;
        this.#ready.delete(text);
        const name = region.name;
        text.sync(() => {
          if (text.text !== name) return;
          this.#ready.add(text);
          this.#onSynced();
        });
      }
      at.set(
        circles[position * 4] ?? 0,
        circles[position * 4 + 1] ?? 0,
        circles[position * 4 + 2] ?? 0,
      )
        .addScaledVector(right, -r * 0.62)
        .addScaledVector(up, r * 0.74);
      text.position.copy(at);
      text.quaternion.copy(camera.quaternion);
      text.fontSize = REGION_NAME_PIXELS * worldPerPixel(distance(at));
      text.visible = this.#ready.has(text);
    }
    this.#pool.end();
  }

  dispose(): void {
    for (const text of this.#pool.items) text.dispose();
  }
}

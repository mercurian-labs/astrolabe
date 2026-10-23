/**
 * The Pixi renderer's drawing aids: the textures its sprites are cut from
 * (drawn once on a 2D canvas, to match the Atlas node shader's shapes), a
 * colour mixer, and the landing wave's displacement, the ribbon shader's
 * formula on the CPU.
 */
import { Texture } from "pixi.js";
import { Color } from "three";

import { NodeShape } from "../../model/kinds.ts";
import { CONTAINER_RING, shapeGauge, shapeReach } from "../shapes.ts";

/** Texture size in pixels: sprites are drawn at most a few dozen pixels across. */
const SIZE = 128;

/** A texture whose pixels come from `shade(u, v)` over −1…1, returning [grey, alpha]. */
function paint(shade: (u: number, v: number) => readonly [number, number]): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (context === null) return Texture.WHITE;
  const image = context.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const [grey, alpha] = shade(((x + 0.5) / SIZE) * 2 - 1, ((y + 0.5) / SIZE) * 2 - 1);
      const at = (y * SIZE + x) * 4;
      image.data[at] = image.data[at + 1] = image.data[at + 2] = Math.round(grey * 255);
      image.data[at + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
  return Texture.from(canvas);
}

/** Coverage of a disc edge at distance `d` (in the texture's −1…1 units), one texel soft. */
const coverage = (d: number, edge: number) =>
  Math.max(0, Math.min(1, (edge - d) * (SIZE / 2) + 0.5));

const LIGHT = (() => {
  const length = Math.hypot(-0.45, 0.55, 0.7);
  return [-0.45 / length, 0.55 / length, 0.7 / length] as const;
})();

/** A codebase shape's sprites, each spanning the shape's reach either side of its centre. */
export interface ShapeArt {
  /** The node shader's shaded shape (with a closed container's inner ring cut out). */
  readonly body: Texture;
  /** A red link of this shape: its outline from 0.7 to 1. */
  readonly hollow: Texture;
  /** The plain shape: the amended mark. */
  readonly fill: Texture;
  /** The texture's half-width, in node radii. */
  readonly reach: number;
}

export interface Art {
  /** A written note: the node shader's lit sphere, grey so a tint colours it. */
  readonly sphere: Texture;
  /** A red link: the hollow ring from 0.7 to 1 of the radius. */
  readonly hollow: Texture;
  /** The rings outside a node, drawn in a quad 1.5 radii across its half: worked (0.16 wide) and picked or hovered (0.1). */
  readonly ringThick: Texture;
  readonly ringThin: Texture;
  /** The amended mark and the beads. */
  readonly disc: Texture;
  readonly bead: Texture;
  /** By `NodeShape`; null for the circle, which draws with the textures above. */
  readonly shapes: ReadonlyArray<ShapeArt | null>;
}

const SHAPES: ReadonlyArray<NodeShape> = Object.values(NodeShape);

function paintShape(shape: NodeShape): ShapeArt {
  const reach = shapeReach(shape);
  // The texture's −1…1 spans ±reach; the screen's y runs down, the gauge's up.
  const gauge = (u: number, v: number) => shapeGauge(shape, u * reach, -v * reach) / reach;
  const edge = 1 / reach;
  return {
    reach,
    body: paint((u, v) => {
      const g = gauge(u, v) * reach;
      const r = Math.hypot(u, v) * reach;
      const scale = r > 0 ? g / r : 0;
      const x = u * reach * scale;
      const y = -v * reach * scale;
      const z = Math.sqrt(Math.max(0, 1 - g * g));
      const light = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2]);
      let alpha = coverage(g / reach, edge);
      if (shape === NodeShape.container) {
        const [inner, outer] = CONTAINER_RING;
        alpha = Math.min(
          alpha,
          Math.max(coverage(g / reach, inner / reach), 1 - coverage(g / reach, outer / reach)),
        );
      }
      return [Math.min(1, 0.72 + 0.28 * light + 0.16 * light ** 10), alpha];
    }),
    hollow: paint((u, v) => [
      1,
      Math.min(coverage(gauge(u, v), edge), 1 - coverage(gauge(u, v), 0.7 * edge)),
    ]),
    fill: paint((u, v) => [1, coverage(gauge(u, v), edge)]),
  };
}

export function paintArt(): Art {
  const ring = (width: number) =>
    paint((u, v) => {
      const d = Math.hypot(u, v) * 1.5;
      return [1, Math.min(coverage(d, 1.2 + width), 1 - coverage(d, 1.2))];
    });
  return {
    sphere: paint((u, v) => {
      const d = Math.hypot(u, v);
      const z = Math.sqrt(Math.max(0, 1 - d * d));
      // The screen's y runs down; the shader's light comes from the upper left.
      const light = Math.max(0, u * LIGHT[0] - v * LIGHT[1] + z * LIGHT[2]);
      return [Math.min(1, 0.72 + 0.28 * light + 0.16 * light ** 10), coverage(d, 1)];
    }),
    hollow: paint((u, v) => {
      const d = Math.hypot(u, v);
      return [1, Math.min(coverage(d, 1), 1 - coverage(d, 0.7))];
    }),
    ringThick: ring(0.16),
    ringThin: ring(0.1),
    disc: paint((u, v) => [1, coverage(Math.hypot(u, v), 1)]),
    bead: paint((u, v) => {
      const d = Math.hypot(u, v) / 2;
      const t = Math.max(0, Math.min(1, (0.5 - d) / (0.5 - 0.32)));
      return [1, t * t * (3 - 2 * t)];
    }),
    shapes: SHAPES.map((shape) => (shape === NodeShape.circle ? null : paintShape(shape))),
  };
}

export function destroyArt(art: Art): void {
  const { shapes, ...textures } = art;
  for (const texture of Object.values(textures)) texture.destroy(true);
  for (const shape of shapes) {
    shape?.body.destroy(true);
    shape?.hollow.destroy(true);
    shape?.fill.destroy(true);
  }
}

const mixed = new Color();

/** `a` mixed toward `b` by `t`, in the working colour space, as a hex number for a tint. */
export function mixHex(a: Color, b: Color, t: number): number {
  return mixed.lerpColors(a, b, Math.max(0, Math.min(1, t))).getHex();
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * The landing wave's sideways displacement at `t` along an edge (0 at the end
 * it travels from), `pulse` seconds after it started, for the edge between
 * nodes `a` and `b` of length `span`: the ribbon vertex shader's formula.
 */
export function waveOffset(t: number, pulse: number, a: number, b: number, span: number): number {
  const raw = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  const seed = raw - Math.floor(raw);
  const envelope = Math.exp(-pulse * (1.5 + 0.8 * seed));
  const wavefront = pulse * (2.6 + 1.2 * seed);
  const front = 1 - smoothstep(wavefront, wavefront + 0.5, t);
  const wave = Math.sin((t * (0.8 + 0.8 * seed) - 0.6 * pulse + seed) * 2 * Math.PI);
  return envelope * front * Math.sin(Math.PI * t) * wave * span * (0.022 + 0.012 * seed);
}

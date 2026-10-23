/**
 * Containers drawn as regions: a faint disc around what a container holds,
 * nested at every level (folder › file › class), behind everything else. A
 * region is not a node: no dot, no label in the label pool, nothing to pick.
 * Its circle follows its notes every drawn frame, computed innermost first
 * from where they are drawn now, so it moves with them as they glide.
 *
 * The tint alternates by depth: an even level darkens the paper a breath with
 * ink, an odd level lifts it back toward paper, so nested regions read as
 * bands without any of them becoming chrome.
 */
import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";

import { GROUP_PAD } from "../layout/gathering.ts";
import type { Region } from "../model/view.ts";
import { StyleChannel, type NodeState } from "./nodeState.ts";

/** A region reaches past its outermost note by the share of the spacing the gathering packed it with: the disc drawn is the disc packed. */
export const REGION_PAD = GROUP_PAD;
/** A region's name, in CSS pixels: smaller than a note's label. */
export const REGION_NAME_PIXELS = 9;
/** A region's name reads at this share of a label's ink: it is background. */
export const REGION_NAME_OPACITY = 0.55;
/** A region smaller than this on screen (radius, CSS pixels) shows no name. */
export const REGION_NAME_MIN_PIXELS = 28;
/** At most this many region names at once, the largest first. */
export const REGION_NAME_BUDGET = 60;
/** An even level's tint on the reference paper (the playground's light): ink over paper, a breath. */
export const REGION_FILL_ALPHA = 0.035;
/** An odd level's lift back toward paper. */
export const REGION_LIFT_ALPHA = 0.5;
/** A region's rim on the reference paper: where it ends, lighter than any label so names read over it. */
export const REGION_RIM_ALPHA = 0.045;
/** The reference appearance the alphas above were set in: the playground's light paper and ink. */
export const REGION_REFERENCE = { paper: "#f8f7f3", ink: "#23211d" } as const;

/** CIE L* (0–100) of a gamma-encoded sRGB colour (channels 0–1). */
function lightness(rgb: readonly [number, number, number]): number {
  const linear = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const y = 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
  return y > 216 / 24_389 ? 116 * Math.cbrt(y) - 16 : (24_389 / 27) * y;
}

/** `#rrggbb` as gamma-encoded channels, 0–1. */
function channels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** How far in L* ink laid over paper at `alpha` (blended in the canvas's encoded space) moves it. */
function step(
  paper: readonly [number, number, number],
  ink: readonly [number, number, number],
  alpha: number,
) {
  const blended = paper.map((channel, at) => channel + alpha * ((ink[at] ?? 0) - channel)) as [
    number,
    number,
    number,
  ];
  return Math.abs(lightness(blended) - lightness(paper));
}

/**
 * At most this share of the whole paper-to-ink lightness distance: a palette
 * whose ink barely differs from its paper gets a proportionally faint fill
 * and rim, never opaque ink.
 */
export const REGION_FILL_SHARE = 0.08;
export const REGION_RIM_SHARE = 0.1;

/**
 * The alpha that moves `paper` toward `ink` by `target` in L*, by bisection.
 * The step grows monotonically with alpha, so the target is reached below
 * alpha 1 whenever it is smaller than the whole distance; callers cap it
 * below that (see the shares above).
 */
function alphaFor(
  paper: readonly [number, number, number],
  ink: readonly [number, number, number],
  target: number,
) {
  if (target <= 0) return 0;
  if (step(paper, ink, 1) <= target) return 1;
  let low = 0;
  let high = 1;
  for (let round = 0; round < 40; round += 1) {
    const middle = (low + high) / 2;
    if (step(paper, ink, middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * The region tints for a paper and ink (`#rrggbb`): the alphas that give the
 * even levels' fill and the rim the same lightness step from the paper as the
 * reference appearance gives them, so a dark palette (ivory ink on near-black)
 * draws its regions as quietly as the playground's light one rather than as
 * bright rings. The odd levels' lift is a share of the way back to paper and
 * needs no adjusting.
 */
export function regionTints(
  paper: string,
  ink: string,
): { readonly fill: number; readonly rim: number } {
  const key = `${paper}/${ink}`;
  const known = tintCache.get(key);
  if (known !== undefined) return known;
  const tints = solveTints(paper, ink);
  tintCache.set(key, tints);
  return tints;
}

/** Tints already solved, by paper and ink: a palette is read once per theme change. */
const tintCache = new Map<string, { readonly fill: number; readonly rim: number }>();

function solveTints(paper: string, ink: string): { readonly fill: number; readonly rim: number } {
  const reference = {
    paper: channels(REGION_REFERENCE.paper),
    ink: channels(REGION_REFERENCE.ink),
  };
  const here = { paper: channels(paper), ink: channels(ink) };
  // The reference's lightness steps, each capped to a share of this palette's whole distance.
  const whole = step(here.paper, here.ink, 1);
  const fill = Math.min(
    step(reference.paper, reference.ink, REGION_FILL_ALPHA),
    REGION_FILL_SHARE * whole,
  );
  const rim = Math.min(
    step(reference.paper, reference.ink, REGION_RIM_ALPHA),
    REGION_RIM_SHARE * whole,
  );
  return { fill: alphaFor(here.paper, here.ink, fill), rim: alphaFor(here.paper, here.ink, rim) };
}

const at = new Vector3();

/**
 * Each region's circle now, x, y, z, radius per region into `out` (resized
 * as needed): around the visible notes directly in it and its inner regions'
 * circles, `pad` world units wider. A region holding nothing visible has
 * radius 0. Returns the circles array.
 */
export function regionCircles(
  regions: ReadonlyArray<Region>,
  state: NodeState,
  pad: number,
  out: Float32Array,
): Float32Array {
  const circles = out.length >= regions.length * 4 ? out : new Float32Array(regions.length * 4);
  for (let position = regions.length - 1; position >= 0; position -= 1) {
    const region = regions[position];
    if (region === undefined) continue;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;
    for (const slot of region.nodes) {
      if (state.styleOf(slot, StyleChannel.visibility) < 0.05) continue;
      state.current(slot, at);
      sx += at.x;
      sy += at.y;
      sz += at.z;
      count += 1;
    }
    for (const inner of region.inner) {
      if ((circles[inner * 4 + 3] ?? 0) <= 0) continue;
      sx += circles[inner * 4] ?? 0;
      sy += circles[inner * 4 + 1] ?? 0;
      sz += circles[inner * 4 + 2] ?? 0;
      count += 1;
    }
    if (count === 0) {
      circles[position * 4 + 3] = 0;
      continue;
    }
    const cx = sx / count;
    const cy = sy / count;
    const cz = sz / count;
    let reach = 0;
    for (const slot of region.nodes) {
      const visibility = state.styleOf(slot, StyleChannel.visibility);
      if (visibility < 0.05) continue;
      state.current(slot, at);
      const r = state.drawnRadius(slot) * visibility;
      reach = Math.max(reach, Math.hypot(at.x - cx, at.y - cy, at.z - cz) + r);
    }
    for (const inner of region.inner) {
      const r = circles[inner * 4 + 3] ?? 0;
      if (r <= 0) continue;
      const dx = (circles[inner * 4] ?? 0) - cx;
      const dy = (circles[inner * 4 + 1] ?? 0) - cy;
      const dz = (circles[inner * 4 + 2] ?? 0) - cz;
      reach = Math.max(reach, Math.hypot(dx, dy, dz) + r);
    }
    circles[position * 4] = cx;
    circles[position * 4 + 1] = cy;
    circles[position * 4 + 2] = cz;
    circles[position * 4 + 3] = reach + pad;
  }
  return circles;
}

/**
 * Which regions name themselves this frame: those at least
 * REGION_NAME_MIN_PIXELS across on screen, the largest first, at most
 * REGION_NAME_BUDGET. Returns positions in the regions list.
 */
export function namedRegions(
  regions: ReadonlyArray<Region>,
  circles: Float32Array,
  pixelsPerUnit: number,
): Array<number> {
  const named: Array<number> = [];
  regions.forEach((region, position) => {
    if (region.name === "" || region.bare === true) return;
    if ((circles[position * 4 + 3] ?? 0) * pixelsPerUnit >= REGION_NAME_MIN_PIXELS) {
      named.push(position);
    }
  });
  named.sort((left, right) => (circles[right * 4 + 3] ?? 0) - (circles[left * 4 + 3] ?? 0));
  return named.slice(0, REGION_NAME_BUDGET);
}

const vertexShader = /* glsl */ `
attribute vec4 aCircle;
attribute float aDepth;
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = position.xy;
  vDepth = aDepth;
  if (aCircle.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 view = modelViewMatrix * vec4(aCircle.xyz, 1.0);
  view.xy += position.xy * aCircle.w;
  gl_Position = projectionMatrix * view;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uInk;
uniform vec3 uPaper;
uniform float uFill;
uniform float uRim;
varying vec2 vUv;
varying float vDepth;
// Each layer is a colour laid over what is below it at an alpha: an even level is ink at
// uFill, an odd one paper at the lift (back toward paper), the rim ink at uRim. Across the
// rim's one-pixel transition the two layers are mixed premultiplied: colour × alpha and alpha
// each interpolate, and the colour drawn is their quotient. Mixing straight colours instead
// (paper→ink while alpha falls 0.5→uRim) would pass through a mid grey at a quarter opacity,
// a bright band on dark paper; premultiplied, the transition never draws more ink than the
// rim's solved tint nor more paper than the level's own.
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  bool odd = mod(vDepth, 2.0) > 0.5;
  vec3 color = odd ? uPaper : uInk;
  float alpha = odd ? ${REGION_LIFT_ALPHA.toFixed(3)} : uFill;
  // How much d changes over one device pixel: the true gradient's length, not fwidth's sum,
  // so the rim is one pixel wide (no wider) however large the disc is on screen.
  float pixel = max(length(vec2(dFdx(d), dFdy(d))), 1e-6);
  float rim = smoothstep(1.0 - pixel, 1.0, d);
  vec3 premultiplied = mix(color * alpha, uInk * uRim, rim);
  alpha = mix(alpha, uRim, rim);
  color = alpha > 0.0 ? premultiplied / alpha : color;
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

export interface RegionMesh {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly uniforms: {
    uInk: { value: Color };
    uPaper: { value: Color };
    uFill: { value: number };
    uRim: { value: number };
  };
}

/** Give the regions a theme's paper and ink, with tints that read the same in any appearance. */
export function setRegionTheme(
  region: RegionMesh,
  theme: { readonly paper: Color; readonly ink: Color },
): void {
  region.uniforms.uInk.value.copy(theme.ink);
  region.uniforms.uPaper.value.copy(theme.paper);
  const tints = regionTints(`#${theme.paper.getHexString()}`, `#${theme.ink.getHexString()}`);
  region.uniforms.uFill.value = tints.fill;
  region.uniforms.uRim.value = tints.rim;
}

/**
 * A disc geometry with room for `capacity` regions. Three fixes an instanced
 * geometry's instance limit from its attributes the first time it draws, so
 * growing means a new geometry, not new attributes.
 */
function regionGeometry(capacity: number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const circles = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const depths = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  circles.setUsage(DynamicDrawUsage);
  depths.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aCircle", circles);
  geometry.setAttribute("aDepth", depths);
  geometry.instanceCount = 0;
  return geometry;
}

/** Instanced camera-facing discs, one per region, drawn behind everything. */
export function createRegionMesh(): RegionMesh {
  const uniforms = {
    uInk: { value: new Color() },
    uPaper: { value: new Color() },
    uFill: { value: REGION_FILL_ALPHA },
    uRim: { value: REGION_RIM_ALPHA },
  };
  // Transparent, so a renderer with opaque notes draws the discs in a pass of their own first.
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(regionGeometry(64), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, uniforms };
}

/** Write the regions' circles and depths into the mesh, growing it when needed. */
export function updateRegionMesh(
  region: RegionMesh,
  regions: ReadonlyArray<Region>,
  circles: Float32Array,
): void {
  let geometry = region.mesh.geometry;
  if (geometry.getAttribute("aCircle").count < regions.length) {
    geometry.dispose();
    geometry = regionGeometry(Math.ceil(regions.length * 1.5));
    region.mesh.geometry = geometry;
  }
  const circleAttribute = geometry.getAttribute("aCircle");
  const depthAttribute = geometry.getAttribute("aDepth");
  const circleArray = circleAttribute.array;
  const depthArray = depthAttribute.array;
  regions.forEach((shape, position) => {
    for (let channel = 0; channel < 4; channel += 1) {
      circleArray[position * 4 + channel] = circles[position * 4 + channel] ?? 0;
    }
    // A bare region draws no disc (a radius of 0 is discarded); its circle still holds its inner ones.
    if (shape.bare === true) circleArray[position * 4 + 3] = 0;
    depthArray[position] = shape.depth;
  });
  circleAttribute.needsUpdate = true;
  depthAttribute.needsUpdate = true;
  geometry.instanceCount = regions.length;
}

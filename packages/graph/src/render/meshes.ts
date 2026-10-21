/**
 * The meshes the graph draws with, one draw call each: every node is an
 * instance of one billboard quad, every edge an instance of one ribbon (a
 * strip of samples along its length, so a landing wave can travel it, plus an
 * arrowhead at each end, collapsed unless arrows are on), and the story's
 * beads are one point cloud.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector2,
} from "three";

import type { DrawnGraph } from "./workingSet.ts";
import { BEAD_POOL } from "./beads.ts";
import type { NodeState } from "./nodeState.ts";
import {
  beadFragmentShader,
  beadVertexShader,
  edgeFragmentShader,
  edgeVertexShader,
  nodeFragmentShader,
  nodeVertexShader,
} from "./shaders.ts";
import { LENS_SLOTS } from "./theme.ts";

function sharedUniforms(state: NodeState) {
  return {
    uPos: { value: state.positionTexture },
    uStyle: { value: state.styleTexture },
    uTexSize: { value: new Vector2(state.textureWidth, state.textureHeight) },
    uFadeNear: { value: 0 },
    uFadeFar: { value: 1 },
    uFadeStrength: { value: 0.75 },
    uPaper: { value: new Color() },
    uInk: { value: new Color() },
    uAccent: { value: new Color() },
    uWarning: { value: new Color() },
    uLens: { value: Array.from({ length: LENS_SLOTS }, () => new Color()) },
  };
}

export type SharedUniforms = ReturnType<typeof sharedUniforms>;
export type NodeUniforms = SharedUniforms & {
  /** Camera distance to its target: the focal plane the depth tint is measured from. */
  uDepthCut: { value: number };
  uFocal: { value: number };
  uUnit: { value: number };
  /** How far behind the focal plane things lift toward paper; 0 on the flat reading. */
  uFocalTint: { value: number };
};
export type EdgeUniforms = SharedUniforms & {
  /** Seconds since the landing wave started. */
  uPulse: { value: number };
  uLineWidth: { value: number };
  uArrows: { value: number };
  uArrowSize: { value: number };
  uEdgeAlpha: { value: number };
  uDash: { value: number };
};

export interface NodeMesh {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly uniforms: NodeUniforms;
  readonly flags: InstancedBufferAttribute;
  readonly slots: InstancedBufferAttribute;
  /** Each node's `NodeShape`. */
  readonly shapes: InstancedBufferAttribute;
  /** The node state's prominence values, one per node. */
  readonly prominence: InstancedBufferAttribute;
}

/** A shader pair a mesh can be drawn with in place of the Atlas renderer's own. */
export interface ShaderPair {
  readonly vertex: string;
  readonly fragment: string;
}

export function createNodeMesh(
  state: NodeState,
  shaders: ShaderPair = { vertex: nodeVertexShader, fragment: nodeFragmentShader },
): NodeMesh {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const indices = new Float32Array(state.count).map((_, index) => index);
  geometry.setAttribute("aIndex", new InstancedBufferAttribute(indices, 1));
  const flags = new InstancedBufferAttribute(new Float32Array(state.count), 1);
  const slots = new InstancedBufferAttribute(new Float32Array(state.count).fill(-1), 1);
  flags.setUsage(DynamicDrawUsage);
  slots.setUsage(DynamicDrawUsage);
  const shapes = new InstancedBufferAttribute(new Float32Array(state.count), 1);
  shapes.setUsage(DynamicDrawUsage);
  const prominence = new InstancedBufferAttribute(state.prominence.values, 1);
  prominence.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aFlags", flags);
  geometry.setAttribute("aSlot", slots);
  geometry.setAttribute("aShape", shapes);
  geometry.setAttribute("aProminence", prominence);
  geometry.instanceCount = state.count;
  const uniforms: NodeUniforms = {
    ...sharedUniforms(state),
    uDepthCut: { value: 1e9 },
    uFocal: { value: 1 },
    uUnit: { value: 1 },
    uFocalTint: { value: 0.22 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: shaders.vertex,
    fragmentShader: shaders.fragment,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, uniforms, flags, slots, shapes, prominence };
}

/** What a renderer writes for each edge, by edge slot; `packEdges` draws from it. */
export interface EdgeSource {
  readonly ends: Float32Array;
  readonly kinds: Float32Array;
  readonly slots: Float32Array;
  readonly directions: Float32Array;
  /** 0 still, 1 a wave travelling from the a end, 2 from the b end. */
  readonly waves: Float32Array;
}

export interface EdgeMesh {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly uniforms: EdgeUniforms;
  readonly source: EdgeSource;
  /** The instance attributes, packed with only the edges that show. */
  readonly packed: {
    readonly ends: InstancedBufferAttribute;
    readonly kinds: InstancedBufferAttribute;
    readonly slots: InstancedBufferAttribute;
    readonly directions: InstancedBufferAttribute;
    readonly style: InstancedBufferAttribute;
    readonly waves: InstancedBufferAttribute;
  };
}

/** Samples along a ribbon: enough for a landing wave to read as a curve. */
export const RIBBON_SAMPLES = 12;

/**
 * The per-vertex template every edge instance shares: two rim vertices per
 * sample along the edge, then an arrowhead at b and one at a (tip first).
 */
export function ribbonTemplate(samples: number) {
  const t: Array<number> = [];
  const side: Array<number> = [];
  const arrow: Array<number> = [];
  const tip: Array<number> = [];
  const index: Array<number> = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const along = sample / (samples - 1);
    t.push(along, along);
    side.push(-1, 1);
    arrow.push(0, 0);
    tip.push(0, 0);
    if (sample > 0) {
      const at = (sample - 1) * 2;
      index.push(at, at + 2, at + 1, at + 1, at + 2, at + 3);
    }
  }
  for (const end of [1, -1]) {
    const first = t.length;
    t.push(end > 0 ? 1 : 0, end > 0 ? 1 : 0, end > 0 ? 1 : 0);
    side.push(0, -1, 1);
    arrow.push(end, end, end);
    tip.push(1, 0, 0);
    index.push(first, first + 1, first + 2);
  }
  return { t, side, arrow, tip, index, vertices: t.length };
}

/**
 * One ribbon instance per edge that shows: the instance attributes are packed
 * each drawn frame with only the lit edges (`packEdges`), so an edge nobody
 * attends to costs no vertex work, and at rest with nothing lit there is none.
 */
export function createEdgeMesh(
  state: NodeState,
  universe: DrawnGraph,
  shaders: ShaderPair = { vertex: edgeVertexShader, fragment: edgeFragmentShader },
): EdgeMesh {
  const geometry = new InstancedBufferGeometry();
  const template = ribbonTemplate(RIBBON_SAMPLES);
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(template.vertices * 3), 3),
  );
  geometry.setAttribute("aT", new BufferAttribute(new Float32Array(template.t), 1));
  geometry.setAttribute("aSide", new BufferAttribute(new Float32Array(template.side), 1));
  geometry.setAttribute("aArrow", new BufferAttribute(new Float32Array(template.arrow), 1));
  geometry.setAttribute("aTip", new BufferAttribute(new Float32Array(template.tip), 1));
  geometry.setIndex(template.index);

  const count = universe.edges.length;
  const source: EdgeSource = {
    ends: new Float32Array(count * 2),
    kinds: new Float32Array(count),
    slots: new Float32Array(count).fill(-1),
    directions: new Float32Array(count),
    waves: new Float32Array(count),
  };
  universe.edges.forEach((edge, index) => {
    source.ends[index * 2] = edge.a;
    source.ends[index * 2 + 1] = edge.b;
  });
  const packed = {
    ends: new InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 2), 2),
    kinds: new InstancedBufferAttribute(new Float32Array(Math.max(1, count)), 1),
    slots: new InstancedBufferAttribute(new Float32Array(Math.max(1, count)), 1),
    directions: new InstancedBufferAttribute(new Float32Array(Math.max(1, count)), 1),
    style: new InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 2), 2),
    waves: new InstancedBufferAttribute(new Float32Array(Math.max(1, count)), 1),
  };
  for (const attribute of Object.values(packed)) attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aEnds", packed.ends);
  geometry.setAttribute("aWave", packed.waves);
  geometry.setAttribute("aKind", packed.kinds);
  geometry.setAttribute("aSlot", packed.slots);
  geometry.setAttribute("aDirection", packed.directions);
  geometry.setAttribute("aStyle", packed.style);
  geometry.instanceCount = 0;

  const uniforms: EdgeUniforms = {
    ...sharedUniforms(state),
    uPulse: { value: 1000 },
    uLineWidth: { value: 0.2 },
    uArrows: { value: 0 },
    uArrowSize: { value: 1.6 },
    // Attention maps straight to ink; a fully lit edge stops just short of solid.
    uEdgeAlpha: { value: 0.85 },
    uDash: { value: 1.2 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: shaders.vertex,
    fragmentShader: shaders.fragment,
    transparent: true,
    depthWrite: false,
    // Rim vertices are pushed apart in view space, so either winding can face the camera.
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, uniforms, source, packed };
}

/**
 * Pack the edges in `lit` into the instance attributes (with their style from
 * `style`, visibility and attention per edge) and draw only those; uploads only
 * the packed range. Returns how many edges are drawn.
 */
export function packEdges(edges: EdgeMesh, lit: ReadonlySet<number>, style: Float32Array): number {
  const { source, packed } = edges;
  const ends = packed.ends.array;
  const kinds = packed.kinds.array;
  const slots = packed.slots.array;
  const directions = packed.directions.array;
  const styles = packed.style.array;
  const waves = packed.waves.array;
  let slot = 0;
  for (const index of lit) {
    ends[slot * 2] = source.ends[index * 2] ?? 0;
    ends[slot * 2 + 1] = source.ends[index * 2 + 1] ?? 0;
    kinds[slot] = source.kinds[index] ?? 0;
    slots[slot] = source.slots[index] ?? -1;
    directions[slot] = source.directions[index] ?? 0;
    styles[slot * 2] = style[index * 2] ?? 0;
    styles[slot * 2 + 1] = style[index * 2 + 1] ?? 0;
    waves[slot] = source.waves[index] ?? 0;
    slot += 1;
  }
  for (const attribute of Object.values(packed)) {
    attribute.clearUpdateRanges();
    if (slot > 0) attribute.addUpdateRange(0, slot * attribute.itemSize);
    attribute.needsUpdate = true;
  }
  edges.mesh.geometry.instanceCount = slot;
  return slot;
}

export interface BeadMesh {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly uniforms: {
    uAccent: { value: Color };
    uPixelRatio: { value: number };
    /** Pixels per unit of bead size: scales with line thickness. */
    uSizeScale: { value: number };
    /** The reading density's camera distance: a bead reads its size there. */
    uDensity: { value: number };
    uFlat: { value: number };
  };
  readonly positions: BufferAttribute;
  readonly sizes: BufferAttribute;
  readonly bright: BufferAttribute;
}

export function createBeadMesh(): BeadMesh {
  const geometry = new BufferGeometry();
  const positions = new BufferAttribute(new Float32Array(BEAD_POOL * 3), 3);
  const sizes = new BufferAttribute(new Float32Array(BEAD_POOL), 1);
  const bright = new BufferAttribute(new Float32Array(BEAD_POOL), 1);
  for (const attribute of [positions, sizes, bright]) attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("aSize", sizes);
  geometry.setAttribute("aBright", bright);
  geometry.setDrawRange(0, 0);
  const uniforms = {
    uAccent: { value: new Color() },
    uPixelRatio: { value: 1 },
    uSizeScale: { value: 1 },
    uDensity: { value: 1 },
    uFlat: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: beadVertexShader,
    fragmentShader: beadFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return { points, uniforms, positions, sizes, bright };
}

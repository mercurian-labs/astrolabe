/**
 * The story's marks as Three draws them: the gestures' discs and arcs, and
 * the cursor's marker and chip, one instanced quad each, drawn above the
 * nodes and below the labels. Lines are sized in CSS pixels and shapes in
 * world units, so a mark reads the same at any zoom.
 */
import {
  BufferAttribute,
  type Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
} from "three";

import type { Mark, MarkColor } from "./gestures.ts";

const KIND = { disc: 0, soft: 1, arc: 2, cursor: 4, rect: 5 } as const;

const vertexShader = /* glsl */ `
attribute vec4 aEnds;
attribute vec4 aShape;
attribute vec4 aColor;
attribute float aSweep;
uniform float uPixel;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vColor;
varying float vSweep;
void main() {
  vShape = aShape;
  vSweep = aSweep;
  vColor = aColor;
  float kind = aShape.x;
  vec2 at;
  if (kind > 4.5) {
    // A rectangle (the label's chip), shrunk by an inset in pixels.
    vec2 low = min(aEnds.xy, aEnds.zw) + vec2(aShape.z * uPixel);
    vec2 high = max(aEnds.xy, aEnds.zw) - vec2(aShape.z * uPixel);
    at = mix(low, high, position.xy * 0.5 + 0.5);
    vLocal = vec2(0.0);
  } else if (kind > 3.5) {
    // The cursor: a dart its size in pixels, tip at the point, pointing at aShape.z radians.
    float size = aShape.y;
    vLocal = vec2(mix(-size - 2.0, 2.0, position.x * 0.5 + 0.5), position.y * (size * 0.5 + 2.0));
    float c = cos(aShape.z);
    float s = sin(aShape.z);
    at = aEnds.xy + vec2(c * vLocal.x - s * vLocal.y, s * vLocal.x + c * vLocal.y) * uPixel;
  } else {
    float extent = aShape.y + (kind > 1.5 ? aShape.w * uPixel : 0.0) + uPixel;
    vLocal = position.xy * extent;
    at = aEnds.xy + vLocal;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uPixel;
varying vec2 vLocal;
varying vec4 vShape;
varying vec4 vColor;
varying float vSweep;
const float TAU = 6.28318530718;
void main() {
  float kind = vShape.x;
  float r = vShape.y;
  float alpha = vColor.a;
  float d = length(vLocal);
  if (kind < 0.5) {
    alpha *= 1.0 - smoothstep(r - uPixel, r, d);
  } else if (kind < 1.5) {
    float t = clamp(1.0 - d / r, 0.0, 1.0);
    alpha *= t * t;
  } else if (kind < 2.5) {
    float half_ = vShape.w * uPixel * 0.5;
    alpha *= 1.0 - smoothstep(half_, half_ + uPixel, abs(d - r));
    // Only the arc's own stretch, from its start angle counterclockwise.
    float angle = atan(vLocal.y, vLocal.x);
    float rel = mod(angle - vShape.z + TAU * 4.0, TAU);
    if (vSweep < TAU - 1e-3 && rel > vSweep) discard;
  } else if (kind < 4.5) {
    // A dart, its tip at the origin pointing along +x, in pixels: two triangles
    // meeting at a notch in its back.
    float size = vShape.y;
    vec2 p = vLocal;
    vec2 notch = vec2(-0.72 * size, 0.0);
    vec2 wing = vec2(-size, 0.45 * size * sign(p.y + 1e-6));
    // Inside the triangle tip, wing, notch on p's side of the axis.
    float e0 = (wing.x - 0.0) * (p.y - 0.0) - (wing.y - 0.0) * (p.x - 0.0);
    float e1 = (notch.x - wing.x) * (p.y - wing.y) - (notch.y - wing.y) * (p.x - wing.x);
    float e2 = (0.0 - notch.x) * (p.y - notch.y) - (0.0 - notch.y) * (p.x - notch.x);
    bool inside = (e0 >= 0.0 && e1 >= 0.0 && e2 >= 0.0) || (e0 <= 0.0 && e1 <= 0.0 && e2 <= 0.0);
    if (!inside) discard;
  }
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, alpha);
  #include <colorspace_fragment>
}
`;

export interface MarkMesh {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  readonly uniforms: { uPixel: { value: number } };
}

function markGeometry(capacity: number): InstancedBufferGeometry {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, size] of [
    ["aEnds", 4],
    ["aShape", 4],
    ["aColor", 4],
    ["aSweep", 1],
  ] as const) {
    const attribute = new InstancedBufferAttribute(new Float32Array(capacity * size), size);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = 0;
  return geometry;
}

export function createMarkMesh(): MarkMesh {
  const uniforms = { uPixel: { value: 1 } };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(markGeometry(64), material);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

/** One quad of the mesh: a mark, or one layer of a mark drawn in two (a chip's border and fill). */
interface Instance {
  readonly ends: readonly [number, number, number, number];
  readonly shape: readonly [number, number, number, number];
  readonly tint: Color;
  readonly alpha: number;
  readonly sweep: number;
}

function instancesOf(mark: Mark, colors: Readonly<Record<MarkColor, Color>>): Array<Instance> {
  switch (mark.kind) {
    case "cursor":
      return [
        {
          ends: [mark.x, mark.y, 0, 0],
          shape: [KIND.cursor, mark.size, mark.angle, 0],
          tint: colors[mark.color],
          alpha: mark.alpha,
          sweep: 0,
        },
      ];
    case "rect": {
      const ends = [mark.x0, mark.y0, mark.x1, mark.y1] as const;
      // The border is the whole chip in its colour; the fill sits inside it by the border's width.
      return [
        {
          ends,
          shape: [KIND.rect, 0, 0, 0],
          tint: colors[mark.border],
          alpha: mark.alpha,
          sweep: 0,
        },
        {
          ends,
          shape: [KIND.rect, 0, mark.width, 0],
          tint: colors[mark.color],
          alpha: mark.alpha,
          sweep: 0,
        },
      ];
    }
    case "disc":
      return [
        {
          ends: [mark.x, mark.y, 0, 0],
          shape: [mark.soft ? KIND.soft : KIND.disc, mark.r, 0, 0],
          tint: colors[mark.color],
          alpha: mark.alpha,
          sweep: 0,
        },
      ];
    case "arc":
      return [
        {
          ends: [mark.x, mark.y, 0, 0],
          shape: [KIND.arc, mark.r, mark.start, mark.width],
          tint: colors[mark.color],
          alpha: mark.alpha,
          sweep: mark.sweep,
        },
      ];
  }
}

/** Write `marks` into the mesh in the theme's colours, growing it when needed. */
export function updateMarkMesh(
  mesh: MarkMesh,
  marks: ReadonlyArray<Mark>,
  colors: Readonly<Record<MarkColor, Color>>,
  pixel: number,
): void {
  const instances = marks.flatMap((mark) => instancesOf(mark, colors));
  let geometry = mesh.mesh.geometry;
  if (geometry.getAttribute("aEnds").count < instances.length) {
    // Three fixes an instanced geometry's instance limit when it first draws: grow by a new one.
    geometry.dispose();
    geometry = markGeometry(Math.ceil(instances.length * 1.5));
    mesh.mesh.geometry = geometry;
  }
  const ends = geometry.getAttribute("aEnds");
  const shape = geometry.getAttribute("aShape");
  const color = geometry.getAttribute("aColor");
  const sweep = geometry.getAttribute("aSweep");
  instances.forEach((instance, at) => {
    ends.setXYZW(at, ...instance.ends);
    shape.setXYZW(at, ...instance.shape);
    color.setXYZW(at, instance.tint.r, instance.tint.g, instance.tint.b, instance.alpha);
    sweep.setX(at, instance.sweep);
  });
  ends.needsUpdate = true;
  sweep.needsUpdate = true;
  shape.needsUpdate = true;
  color.needsUpdate = true;
  geometry.instanceCount = instances.length;
  mesh.uniforms.uPixel.value = pixel;
}

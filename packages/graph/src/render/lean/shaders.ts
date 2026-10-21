/**
 * The lean renderer's node and edge shaders: the Atlas renderer's with every
 * depth term removed. No depth fade, no focal tint, no depth cut: a flat
 * reading has one depth. Edges reuse the Atlas ribbon vertex shader, which
 * has no depth terms of its own.
 */
import { EDGE_FLOW, edgeVertexShader, LENS, NODE_QUAD_EXTENT, TEXEL } from "../shaders.ts";
import type { ShaderPair } from "../meshes.ts";
import { CONTAINER_RING, SHAPES } from "../shapes.ts";

const extent = NODE_QUAD_EXTENT.toFixed(2);

const nodeVertex = /* glsl */ `
${TEXEL}
${SHAPES}
uniform sampler2D uPos;
uniform sampler2D uStyle;
attribute float aIndex;
attribute float aFlags;
attribute float aSlot;
attribute float aShape;
attribute float aProminence;
varying vec2 vUv;
varying vec4 vStyle;
varying float vFlags;
varying float vSlot;
varying float vShape;
varying float vProminence;

void main() {
  vec4 node = texel(uPos, aIndex);
  vec4 style = texel(uStyle, aIndex);
  vStyle = style;
  vFlags = aFlags;
  vSlot = aSlot;
  vShape = aShape;
  vProminence = aProminence;
  float extent = ${extent} * shapeReach(aShape);
  vUv = position.xy * extent;
  float radius = node.w * style.x;
  vec4 view = modelViewMatrix * vec4(node.xyz, 1.0);
  view.xy += position.xy * radius * extent;
  gl_Position = projectionMatrix * view;
  if (style.x < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const nodeFragment = /* glsl */ `
${LENS}
${SHAPES}
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform vec3 uWarning;
varying vec2 vUv;
varying vec4 vStyle;
varying float vFlags;
varying float vSlot;
varying float vShape;
varying float vProminence;

void main() {
  // g is the shape's gauge (1 on its outline); d, the rings' distance, in shape reaches.
  float g = shapeGauge(vUv, vShape);
  float d = length(vUv) / shapeReach(vShape);
  float emphasis = max(vStyle.y, vProminence);
  float glow = vStyle.z;
  float hover = vStyle.w;
  bool frontier = flag(vFlags, 1.0);
  bool isNew = flag(vFlags, 2.0);
  bool amended = flag(vFlags, 4.0);
  bool picked = flag(vFlags, 8.0);
  vec3 color;
  // Failure flow: a small warning tick off the upper right of a function nothing above catches.
  float along = dot(vUv, vec2(0.70710678)) / shapeReach(vShape);
  float across = abs(vUv.x - vUv.y) * 0.70710678 / shapeReach(vShape);
  bool tick = flag(vFlags, 32.0) && along > 1.08 && along < 1.45 && across < 0.13;
  if (tick) {
    color = uWarning;
    emphasis = max(emphasis, 0.9);
  } else if (g > 1.0) {
    if (picked || hover > 0.5) {
      // The hovered or picked note's ink ring.
      if (d < 1.2 || d > 1.3) discard;
      color = uInk;
    } else if (glow > 0.02) {
      // The quiet mark the checkpoint's worked notes keep: a hairline in the
      // story colour at 1.4 radii, about a pixel whatever the note's size.
      if (abs(d - 1.4) > fwidth(d) * 0.75) discard;
      color = mix(uPaper, uAccent, glow);
    } else {
      discard;
    }
    emphasis = max(emphasis, 0.9);
  } else if (frontier) {
    if (g < 0.7) discard;
    color = lensColor(vSlot, uInk);
  } else {
    vec3 base = lensColor(vSlot, uInk);
    if (isNew) base = uAccent;
    float r = length(vUv);
    vec2 surface = g == r ? vUv : vUv * (g / max(r, 1e-5));
    vec3 normal = vec3(surface, sqrt(max(0.0, 1.0 - g * g)));
    float light = max(dot(normal, normalize(vec3(-0.45, 0.55, 0.7))), 0.0);
    color = base * (0.72 + 0.28 * light) + vec3(0.16) * pow(light, 10.0);
    if (vShape > 5.5 && g > ${CONTAINER_RING[0].toFixed(2)} && g < ${CONTAINER_RING[1].toFixed(2)}) color = uPaper;
    if (amended && g < 0.36) color = uAccent;
  }
  gl_FragColor = vec4(mix(uPaper, color, mix(0.14, 1.0, emphasis)), 1.0);
  #include <colorspace_fragment>
}
`;

const edgeFragment = /* glsl */ `
${LENS}
${EDGE_FLOW}
uniform vec3 uInk;
uniform vec3 uAccent;
uniform float uEdgeAlpha;
uniform float uDash;
varying float vT;
varying float vLength;
varying vec2 vStyle;
varying float vKind;
varying float vSlot;
varying float vHeuristic;

void main() {
  vec3 color = lensColor(vSlot, uInk);
  if (vKind > 0.5) color = uAccent;
  color = flowColor(color);
  if (flowCut()) discard;
  if (vKind > 1.5) {
    if (fract(vT * vLength / uDash) > 0.55 || abs(vT - 0.5) < 0.06) discard;
  } else if (vHeuristic > 0.5 && fract(vT * vLength / (uDash * 0.6)) > 0.6) {
    // A guessed link (resolved by name alone): finely dashed.
    discard;
  }
  gl_FragColor = vec4(color, uEdgeAlpha * vStyle.y * vStyle.x);
  #include <colorspace_fragment>
}
`;

export const LEAN_NODE_SHADERS: ShaderPair = { vertex: nodeVertex, fragment: nodeFragment };
export const LEAN_EDGE_SHADERS: ShaderPair = { vertex: edgeVertexShader, fragment: edgeFragment };

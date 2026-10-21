/**
 * The graph's two shader programs. Both read node positions and radii from one
 * float texture (`uPos`: x, y, z, radius) and node style from another
 * (`uStyle`: visibility, emphasis, glow, hover), indexed by node.
 *
 * Nodes are billboards shaded as spheres: a lit disc with a hard edge (MSAA
 * smooths it), a hollow ring for a frontier node, an accent hairline for a
 * note the current turn worked. A codebase's notes take their kind's shape (see
 * `shapes.ts`), shaded the same way; the rings stay circles around them. Behind the focal plane they lift toward paper, so
 * overlapping discs separate. Edges are ribbons sampled along their length:
 * two rim vertices per sample pushed apart along the screen-space
 * perpendicular by a world-unit width, so far edges thin out, and a landing
 * wave can travel them; the width grows a little with attention. Everything
 * fades toward the paper with depth, edges faster (the fade is squared).
 */

import { CONTAINER_RING, SHAPES } from "./shapes.ts";

export const TEXEL = /* glsl */ `
uniform vec2 uTexSize;
vec4 texel(sampler2D tex, float index) {
  float x = mod(index, uTexSize.x);
  float y = floor(index / uTexSize.x);
  return texture2D(tex, (vec2(x, y) + 0.5) / uTexSize);
}
`;

const FADE = /* glsl */ `
uniform float uFadeNear;
uniform float uFadeFar;
uniform float uFadeStrength;
float depthFade(float depth) {
  return 1.0 - smoothstep(uFadeNear, uFadeFar, depth) * uFadeStrength;
}
`;

export const LENS = /* glsl */ `
uniform vec3 uLens[6];
vec3 lensColor(float slot, vec3 fallback) {
  vec3 color = fallback;
  for (int i = 0; i < 6; i++) {
    if (abs(float(i) - slot) < 0.5) color = uLens[i];
  }
  return color;
}
bool flag(float flags, float bit) {
  return mod(floor(flags / bit + 0.001), 2.0) > 0.5;
}
`;

/** Room around the sphere, in sphere radii, for the rings drawn outside it. */
export const NODE_QUAD_EXTENT = 1.5;

export const nodeVertexShader = /* glsl */ `
${TEXEL}
${SHAPES}
uniform sampler2D uPos;
uniform sampler2D uStyle;
/** Nodes wholly past this depth (the fade-far plane) are not drawn. */
uniform float uDepthCut;
attribute float aIndex;
attribute float aFlags;
attribute float aSlot;
attribute float aShape;
/** 1 for the story's notes while it is lit, eased: full ink, no depth fade or cut. */
attribute float aProminence;
varying vec2 vUv;
varying float vDepth;
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
  // The quad reaches past the shape's farthest point by the rings' room.
  float extent = ${NODE_QUAD_EXTENT.toFixed(2)} * shapeReach(aShape);
  vUv = position.xy * extent;
  // A node rising into view grows in from nothing.
  float radius = node.w * style.x;
  vec4 view = modelViewMatrix * vec4(node.xyz, 1.0);
  view.xy += position.xy * radius * extent;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
  bool cut = vDepth - radius > uDepthCut && aProminence < 0.01;
  if (style.x < 0.004 || cut) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const nodeFragmentShader = /* glsl */ `
${FADE}
${LENS}
${SHAPES}
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform vec3 uWarning;
uniform float uFocal;
uniform float uUnit;
uniform float uFocalTint;
varying vec2 vUv;
varying float vDepth;
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
    // Outside the sphere, past a paper gap: the picked or hovered note's ink
    // ring; else the quiet mark the checkpoint's worked notes keep, a hairline
    // in the story colour at 1.4 radii, about a pixel whatever the note's size.
    if (picked || hover > 0.5) {
      if (d < 1.2 || d > 1.3) discard;
      color = uInk;
    } else if (glow > 0.02) {
      if (abs(d - 1.4) > fwidth(d) * 0.75) discard;
      color = mix(uPaper, uAccent, glow);
    } else {
      discard;
    }
    emphasis = max(emphasis, 0.9);
  } else if (frontier) {
    // A red link: hollow, a thin outline of ink.
    if (g < 0.7) discard;
    color = lensColor(vSlot, uInk);
  } else {
    // A written note: a lit sphere, or its shape shaded as one.
    vec3 base = lensColor(vSlot, uInk);
    if (isNew) base = uAccent;
    float r = length(vUv);
    vec2 surface = g == r ? vUv : vUv * (g / max(r, 1e-5));
    vec3 normal = vec3(surface, sqrt(max(0.0, 1.0 - g * g)));
    float light = max(dot(normal, normalize(vec3(-0.45, 0.55, 0.7))), 0.0);
    color = base * (0.72 + 0.28 * light) + vec3(0.16) * pow(light, 10.0);
    // A closed container: a paper ring inside the disc.
    if (vShape > 5.5 && g > ${CONTAINER_RING[0].toFixed(2)} && g < ${CONTAINER_RING[1].toFixed(2)}) color = uPaper;
    if (amended && g < 0.36) color = uAccent;
  }

  // The dictionary's focal tint: ink lifts toward paper on a ramp from the
  // cloud's near rim (160 units in front of the focal plane) to just past the
  // focal plane, so overlapping discs in the front half separate.
  float sep = clamp((vDepth - (uFocal - 160.0 * uUnit)) / (200.0 * uUnit), 0.0, 1.0);
  color = mix(color, uPaper, uFocalTint * sep * (1.0 - vProminence));

  // The story's notes read in full ink at any depth.
  float strength = mix(0.14, 1.0, emphasis) * mix(depthFade(vDepth), 1.0, vProminence);
  gl_FragColor = vec4(mix(uPaper, color, strength), 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * A lit edge's width, as a share of the base width (`uLineWidth`): hairline
 * links, a touch wider as attention grows, so the base is exactly a hovered
 * note's links (0.6) and the story (1) reads 4/3 of it.
 */
export const EDGE_WIDTH_FLOOR = 0.5;
export const EDGE_WIDTH_SLOPE = 5 / 6;
export const edgeWidthScale = (attention: number) =>
  EDGE_WIDTH_FLOOR + EDGE_WIDTH_SLOPE * attention;

/**
 * The design features' edge styling, shared by every edge fragment shader:
 * failure flow and crossed boundaries take the warning tint; a data-flow
 * edge's head is hollow; a crossed boundary's ribbon is a double hairline
 * (the vertex shader widened it, the middle third is cut).
 */
export const EDGE_FLOW = /* glsl */ `
uniform vec3 uWarning;
varying float vSide;
varying float vTip;
varying float vHead;
varying vec3 vFlow;
vec3 flowColor(vec3 color) {
  return vFlow.y > 0.5 || vFlow.z > 0.5 ? uWarning : color;
}
bool flowCut() {
  if (vHead > 0.5) {
    // A data edge's head: only its outline, about a pixel wide.
    if (vFlow.x < 0.5 || vFlow.y > 0.5) return false;
    float inside = 1.0 - vTip - abs(vSide);
    return inside > fwidth(vSide) * 1.2 && vTip > fwidth(vTip) * 1.2;
  }
  return vFlow.z > 0.5 && abs(vSide) < 0.34;
}
`;

export const edgeVertexShader = /* glsl */ `
${TEXEL}
uniform sampler2D uPos;
uniform sampler2D uStyle;
uniform float uLineWidth;
uniform float uPulse;
uniform float uArrows;
uniform float uArrowSize;
attribute float aT;
attribute float aSide;
/** 0 on the ribbon; 1 or -1 on the arrowhead at the b or a end. */
attribute float aArrow;
/** 1 at an arrowhead's tip, 0 at its base. */
attribute float aTip;
attribute vec2 aEnds;
attribute float aKind;
attribute float aSlot;
attribute float aDirection;
attribute vec2 aStyle;
/** 0 still; 1 a landing wave travelling from the a end; 2 from the b end. */
attribute float aWave;
varying float vT;
varying float vLength;
varying float vDepth;
varying vec2 vStyle;
varying float vKind;
varying float vSlot;
/** 1 on a heuristic edge: drawn dashed. */
varying float vHeuristic;
/** Across the ribbon (−1…1), or across an arrowhead (0 at its tip). */
varying float vSide;
/** Along an arrowhead, 1 at its tip; 0 on the ribbon. */
varying float vTip;
/** 1 on an arrowhead. */
varying float vHead;
/** The design features' bits: data flow, failure flow, a crossed boundary. */
varying vec3 vFlow;

float bit(float bits, float value) {
  return mod(floor(bits / value + 0.001), 2.0);
}

void main() {
  vec4 a = texel(uPos, aEnds.x);
  vec4 b = texel(uPos, aEnds.y);
  float visibleA = texel(uStyle, aEnds.x).x;
  float visibleB = texel(uStyle, aEnds.y).x;
  vec3 va = (modelViewMatrix * vec4(a.xyz, 1.0)).xyz;
  vec3 vb = (modelViewMatrix * vec4(b.xyz, 1.0)).xyz;
  vec3 along = vb - va;
  float span = length(along);
  vec3 unit = along / max(span, 1e-5);
  // Start and end at the spheres' rims.
  float ra = a.w * visibleA;
  float rb = b.w * visibleB;
  vec3 start = va + unit * ra;
  vec3 end = vb - unit * rb;
  vec2 perp = normalize(vec2(-along.y, along.x) + 1e-6);
  vec3 flow = vec3(bit(aDirection, 16.0), bit(aDirection, 32.0), bit(aDirection, 64.0));
  float width = uLineWidth * (${EDGE_WIDTH_FLOOR.toFixed(4)} + ${EDGE_WIDTH_SLOPE.toFixed(6)} * aStyle.y);
  // Data flow draws thin; a crossed boundary wide enough to split into two hairlines.
  width *= flow.z > 0.5 ? 2.6 : flow.x > 0.5 ? 0.6 : 1.0;
  vec3 p;
  if (abs(aArrow) < 0.5) {
    p = mix(start, end, aT);
    if (aWave > 0.5) {
      // A damped wave travels out from the end it started at and rings down,
      // pinned at both ends: the link has just landed.
      float t = aWave > 1.5 ? 1.0 - aT : aT;
      float seed = fract(sin(aEnds.x * 12.9898 + aEnds.y * 78.233) * 43758.5453);
      float envelope = exp(-uPulse * (1.5 + 0.8 * seed));
      float wavefront = uPulse * (2.6 + 1.2 * seed);
      float front = 1.0 - smoothstep(wavefront, wavefront + 0.5, t);
      float wave = sin((t * (0.8 + 0.8 * seed) - 0.6 * uPulse + seed) * 6.2831853);
      float amp = envelope * front * sin(3.14159265 * t) * wave * span * (0.022 + 0.012 * seed);
      p.xy += perp * amp;
    }
    p.xy += perp * aSide * 0.5 * width;
  } else {
    // An arrowhead sits at the end its direction points to.
    bool atB = aArrow > 0.0;
    // Ways in the low two bits; a directed edge (bit 8), and data and failure
    // flow, always show their heads: at the type a function takes, gives, or raises.
    float ways = mod(aDirection, 4.0);
    float directed = max(bit(aDirection, 8.0), max(flow.x, flow.y));
    float wanted = atB ? mod(ways, 2.0) : floor(ways / 2.0 + 0.001);
    float size = uArrowSize * max(uArrows, directed) * step(0.5, wanted);
    vec3 tip = atB ? end : start;
    vec3 back = atB ? -unit : unit;
    p = tip + back * size * (1.0 - aTip);
    p.xy += perp * aSide * size * 0.45 * (1.0 - aTip);
  }
  vT = aT;
  vSide = aSide;
  vTip = aTip;
  vHead = abs(aArrow);
  vFlow = flow;
  vLength = length(end - start);
  vStyle = aStyle * vec2(min(visibleA, visibleB), 1.0);
  vKind = aKind;
  vSlot = aSlot;
  vHeuristic = mod(floor(aDirection / 4.0 + 0.001), 2.0);
  if (span <= ra + rb || vStyle.x < 0.004) p = vec3(0.0, 0.0, 1.0);
  vDepth = -p.z;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

export const edgeFragmentShader = /* glsl */ `
${FADE}
${LENS}
${EDGE_FLOW}
uniform vec3 uInk;
uniform vec3 uAccent;
uniform float uEdgeAlpha;
uniform float uDash;
varying float vT;
varying float vLength;
varying float vDepth;
varying vec2 vStyle;
varying float vKind;
varying float vSlot;
varying float vHeuristic;

void main() {
  // Ink carries attention: alpha is the edge's attention, eased on the CPU.
  vec3 color = lensColor(vSlot, uInk);
  if (vKind > 0.5) color = uAccent;
  color = flowColor(color);
  if (flowCut()) discard;
  if (vKind > 1.5) {
    // Broken where it stood: dashed, with a gap at the middle.
    if (fract(vT * vLength / uDash) > 0.55 || abs(vT - 0.5) < 0.06) discard;
  } else if (vHeuristic > 0.5 && fract(vT * vLength / (uDash * 0.6)) > 0.6) {
    // A guessed link (resolved by name alone): finely dashed.
    discard;
  }
  float fade = depthFade(vDepth);
  fade *= fade;
  gl_FragColor = vec4(color, uEdgeAlpha * vStyle.y * vStyle.x * fade);
  #include <colorspace_fragment>
}
`;

/**
 * Beads on the turn's new links: round points in the accent, brightening
 * through the middle of their run. Perspective beads are sized so a bead reads
 * its nominal size at the reading density; the flat reading's are a constant
 * pixel size.
 */
export const beadVertexShader = /* glsl */ `
attribute float aSize;
attribute float aBright;
uniform float uPixelRatio;
uniform float uSizeScale;
uniform float uDensity;
uniform float uFlat;
varying float vBright;

void main() {
  vBright = aBright;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float size = aSize * uSizeScale * uPixelRatio;
  gl_PointSize = uFlat > 0.5 ? size : (mv.z < 0.0 ? size * uDensity / -mv.z : 0.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const beadFragmentShader = /* glsl */ `
uniform vec3 uAccent;
varying float vBright;

void main() {
  if (vBright <= 0.001) discard;
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  gl_FragColor = vec4(uAccent, smoothstep(0.5, 0.32, d) * vBright);
  #include <colorspace_fragment>
}
`;

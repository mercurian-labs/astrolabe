/**
 * Node shapes, for every renderer: each shape is a gauge, 1 on its outline,
 * less inside, growing linearly from its centre, so whatever a shader did
 * with a disc's distance (the outline, a frontier's hollow, the amended dot,
 * the sphere's shading) works on any shape. A shape's reach is its farthest
 * point: the rings outside a node keep their circles and stand out by it.
 *
 * Sizes match the disc's visual weight: the rounded square and the hexagon
 * have its area; the diamond and the triangle, whose points read large, a
 * little less; a constant's square is deliberately small. The triangle is
 * centred on its centroid, where the eye puts it.
 */
import { NodeShape } from "../model/kinds.ts";

const SQUIRCLE = 0.92;
const DIAMOND = 1.18;
const HEXAGON = 1.1;
const HEX_APOTHEM = HEXAGON * Math.cos(Math.PI / 6);
const TRIANGLE_INRADIUS = 0.68;
const SQUARE = 0.71;
const COS30 = Math.cos(Math.PI / 6);

/** The disc with an inner ring: paper between these gauges. */
export const CONTAINER_RING = [0.5, 0.68] as const;

const REACH: Readonly<Record<NodeShape, number>> = {
  [NodeShape.circle]: 1,
  [NodeShape.roundedSquare]: SQUIRCLE * Math.SQRT2 * 2 ** -0.25,
  [NodeShape.diamond]: DIAMOND,
  [NodeShape.hexagon]: HEXAGON,
  [NodeShape.triangle]: TRIANGLE_INRADIUS * 2,
  [NodeShape.square]: SQUARE * Math.SQRT2,
  [NodeShape.container]: 1,
};
const REACHES: ReadonlyArray<number> = Object.values(NodeShape).map((shape) => REACH[shape]);

/** How far `shape` (a `NodeShape`, as views carry it) reaches from its centre, in node radii. */
export const shapeReach = (shape: number | undefined): number => REACHES[shape ?? 0] ?? 1;

/** The gauge of `shape` at (x, y), y up, in node radii. */
export function shapeGauge(shape: number, x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  switch (shape) {
    case NodeShape.roundedSquare:
      return ((ax / SQUIRCLE) ** 4 + (ay / SQUIRCLE) ** 4) ** 0.25;
    case NodeShape.diamond:
      return (ax + ay) / DIAMOND;
    case NodeShape.hexagon:
      return Math.max(ax, 0.5 * ax + COS30 * ay) / HEX_APOTHEM;
    case NodeShape.triangle:
      return Math.max(-y, COS30 * ax + 0.5 * y) / TRIANGLE_INRADIUS;
    case NodeShape.square:
      return Math.max(ax, ay) / SQUARE;
    default:
      return Math.hypot(x, y);
  }
}

const glsl = (value: number) => value.toFixed(6);

/** The same gauges and reaches in GLSL; shapes arrive as floats. */
export const SHAPES = /* glsl */ `
float shapeReach(float shape) {
  if (shape < 0.5 || shape > 5.5) return 1.0;
  if (shape < 1.5) return ${glsl(REACH[NodeShape.roundedSquare])};
  if (shape < 2.5) return ${glsl(DIAMOND)};
  if (shape < 3.5) return ${glsl(HEXAGON)};
  if (shape < 4.5) return ${glsl(TRIANGLE_INRADIUS * 2)};
  return ${glsl(REACH[NodeShape.square])};
}
float shapeGauge(vec2 p, float shape) {
  if (shape < 0.5 || shape > 5.5) return length(p);
  vec2 a = abs(p);
  if (shape < 1.5) {
    vec2 q = a / ${glsl(SQUIRCLE)};
    q *= q;
    return sqrt(sqrt(dot(q, q)));
  }
  if (shape < 2.5) return (a.x + a.y) / ${glsl(DIAMOND)};
  if (shape < 3.5) return max(a.x, 0.5 * a.x + ${glsl(COS30)} * a.y) / ${glsl(HEX_APOTHEM)};
  if (shape < 4.5) return max(-p.y, ${glsl(COS30)} * a.x + 0.5 * p.y) / ${glsl(TRIANGLE_INRADIUS)};
  return max(a.x, a.y) / ${glsl(SQUARE)};
}
`;

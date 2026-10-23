/** How a label fades: by its distance from the camera, then by its note's state. */
export interface LabelFade {
  /** Camera distance at and before which labels are fully drawn. */
  readonly near: number;
  /** Camera distance by which a label has faded by its full strength, and past which it is off. */
  readonly far: number;
  /** How much a label fades between near and far, 0–1; 0 keeps every label at any depth. */
  readonly strength: number;
}

/** Labels fade a little less than nodes, scaled by the label fade setting. */
export const LABEL_FADE_STRENGTH = 0.95;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** A fully prominent note's label draws this much bigger. */
export const PROMINENT_LABEL_GAIN = 1.3;
/** How much bigger a label draws at `prominence` 0–1: a scale of the text, so the SDF stays crisp. */
export const labelGrowth = (prominence: number) =>
  1 + (PROMINENT_LABEL_GAIN - 1) * Math.max(0, Math.min(1, prominence));

/**
 * A story note's label reads in full whatever its distance: its opacity eases
 * from the ordinary one toward its note's visibility as `prominence` goes 0 → 1.
 */
export function prominentOpacity(ordinary: number, visibility: number, prominence: number) {
  const full = Math.max(0, Math.min(1, visibility));
  return ordinary + (full - ordinary) * Math.max(0, Math.min(1, prominence));
}

/**
 * A label's opacity from its distance and its note's style. Emphasis keeps
 * receded notes' names quieter; a forced label (hovered, picked, worked)
 * ignores distance.
 */
export function labelOpacity(
  distance: number,
  fade: LabelFade,
  visibility: number,
  emphasis: number,
  forced: boolean,
): number {
  const strength = Math.max(0, Math.min(1, fade.strength));
  // Past the label window a label is off, unless the fade setting keeps every label.
  const beyond = strength > 0 && distance > fade.far;
  const byDistance = beyond ? 0 : 1 - smoothstep(fade.near, fade.far, distance) * strength;
  const byState = 0.25 + 0.75 * Math.max(0, Math.min(1, emphasis));
  const opacity = forced ? Math.max(byDistance, 0.95) : byDistance * byState;
  return opacity * Math.max(0, Math.min(1, visibility));
}

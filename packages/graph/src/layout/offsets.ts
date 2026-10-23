/**
 * A note's spring target is composed of a base offset from its home (where
 * the gathering or a focus pull puts it) plus any drag. The drag is stored
 * relative to that base, so a dropped note stays where it was dropped when
 * the base is recomputed on a hover or a settings change.
 */
export type Offset = readonly [number, number, number];

/** The drag that leaves a note at `hit`, given its `home` and its base offset. */
export function dragFrom(hit: Offset, home: Offset, base: Offset): [number, number, number] {
  return [hit[0] - home[0] - base[0], hit[1] - home[1] - base[1], hit[2] - home[2] - base[2]];
}

/** The spring target: the base offset plus the drag, if any. */
export function composeOffset(base: Offset, drag: Offset | undefined): [number, number, number] {
  return [base[0] + (drag?.[0] ?? 0), base[1] + (drag?.[1] ?? 0), base[2] + (drag?.[2] ?? 0)];
}

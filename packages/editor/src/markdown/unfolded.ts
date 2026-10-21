import { MapMode, StateEffect, StateField } from "@codemirror/state";

/** Flips the explicit unfolded state of the foldable block starting at a position. */
export const toggleUnfolded = StateEffect.define<number>({
  map: (pos, mapping) => mapping.mapPos(pos),
});

/**
 * Start positions of foldable blocks (frontmatter, `[!type]-` callouts) the user unfolded
 * by clicking. They stay open whatever the selection does, until clicked again or deleted.
 */
export const manuallyUnfolded = StateField.define<readonly number[]>({
  create: () => [],
  update(starts, tr) {
    let next = starts;
    if (tr.docChanged && starts.length > 0) {
      next = starts.flatMap((pos) => {
        const mapped = tr.changes.mapPos(pos, 1, MapMode.TrackDel);
        return mapped === null ? [] : [mapped];
      });
    }
    for (const effect of tr.effects) {
      if (!effect.is(toggleUnfolded)) continue;
      next = next.includes(effect.value)
        ? next.filter((pos) => pos !== effect.value)
        : [...next, effect.value];
    }
    return next;
  },
});

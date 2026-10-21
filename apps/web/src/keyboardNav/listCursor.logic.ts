/**
 * Astrolabe: the keys that move through a sidebar's list while it has focus, after Vim's: `j` and
 * `k` (and the arrows) step, `gg` and `G` (and Home and End) jump to the ends. See
 * `placeLists.ts` for the rows they move over.
 */

export type ListMove = "next" | "previous" | "first" | "last";

/** What a plainly pressed key does in the list, with `g` held over for a second `g`. */
export function listMoveForKey(
  key: string,
  pendingG: boolean,
): { readonly move: ListMove | null; readonly pendingG: boolean } {
  switch (key) {
    case "j":
    case "ArrowDown":
      return { move: "next", pendingG: false };
    case "k":
    case "ArrowUp":
      return { move: "previous", pendingG: false };
    case "Home":
      return { move: "first", pendingG: false };
    case "G":
    case "End":
      return { move: "last", pendingG: false };
    case "g":
      return pendingG ? { move: "first", pendingG: false } : { move: null, pendingG: true };
    default:
      return { move: null, pendingG: false };
  }
}

/**
 * The row `move` lands on from `current` (an index into `reachable`, or -1 for none yet), passing
 * over entries that cannot be reached (a folded or hidden row). Null where there is nowhere to
 * go: the ends do not wrap.
 */
export function moveListCursor(
  reachable: readonly boolean[],
  current: number,
  move: ListMove,
): number | null {
  const indices = reachable.flatMap((ok, index) => (ok ? [index] : []));
  if (indices.length === 0) return null;
  switch (move) {
    case "first":
      return indices[0] ?? null;
    case "last":
      return indices.at(-1) ?? null;
    case "next":
      return current < 0
        ? (indices[0] ?? null)
        : (indices.find((index) => index > current) ?? null);
    case "previous":
      return current < 0
        ? (indices.at(-1) ?? null)
        : (indices.findLast((index) => index < current) ?? null);
  }
}

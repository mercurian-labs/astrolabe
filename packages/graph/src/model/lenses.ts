/**
 * Skill maps drawn on the graph as lenses. A lens tints the notes and edges it
 * arranges; notes no shown lens places stay plain. A lens is identified by its
 * position in the memory's lens list, which is also its tint slot, so a lens
 * keeps its color whichever others are on.
 */
import { pairKey, type MemoryLens } from "./memory.ts";

export interface LensEdgeName {
  readonly lens: string;
  readonly slot: number;
  readonly type: string;
  /** The type's meaning in the map's vocabulary. */
  readonly meaning: string;
  readonly from: string;
  readonly to: string;
}

export interface LensPlacement {
  /** Each placed note's first shown lens slot. */
  readonly noteSlot: ReadonlyMap<string, number>;
  /** Each arranged pair's first shown lens slot, by `pairKey`. */
  readonly edgeSlot: ReadonlyMap<string, number>;
  /** Every shown lens edge on a pair, for naming it on hover. */
  readonly edgeNames: ReadonlyMap<string, ReadonlyArray<LensEdgeName>>;
}

/** The placements of the shown lenses, given by slot, in slot order. */
export function lensPlacement(
  lenses: ReadonlyArray<MemoryLens>,
  shownSlots: ReadonlyArray<number>,
): LensPlacement {
  const noteSlot = new Map<string, number>();
  const edgeSlot = new Map<string, number>();
  const edgeNames = new Map<string, Array<LensEdgeName>>();
  for (const slot of [...new Set(shownSlots)].toSorted((left, right) => left - right)) {
    const lens = lenses[slot];
    if (lens === undefined) continue;
    for (const edge of lens.edges) {
      if (edge.from === edge.to) continue;
      const key = pairKey(edge.from, edge.to);
      if (!noteSlot.has(edge.from)) noteSlot.set(edge.from, slot);
      if (!noteSlot.has(edge.to)) noteSlot.set(edge.to, slot);
      if (!edgeSlot.has(key)) edgeSlot.set(key, slot);
      const name = {
        lens: lens.name,
        slot,
        type: edge.type,
        meaning: lens.types[edge.type] ?? "",
        from: edge.from,
        to: edge.to,
      };
      edgeNames.set(key, [...(edgeNames.get(key) ?? []), name]);
    }
  }
  return { noteSlot, edgeSlot, edgeNames };
}

/** The names of the maps that place a note, shown or not: the popover lists them. */
export function mapsPlacing(lenses: ReadonlyArray<MemoryLens>, id: string): Array<string> {
  return lenses
    .filter((lens) => lens.edges.some((edge) => edge.from === id || edge.to === id))
    .map((lens) => lens.name);
}

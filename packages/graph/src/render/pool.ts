/**
 * Pools for what a renderer draws per note in view (labels, and Pixi's node
 * sprites), so a memory of any size owns only as many as it shows. A note
 * keeps its item while it stays wanted, frame to frame, so a label does not
 * re-typeset or jump; items of notes no longer wanted go back to the pool.
 */

/** Sticky assignment of pooled items to notes. */
export class StickyPool<Item> {
  readonly #create: () => Item;
  readonly #release: (item: Item) => void;
  readonly #held = new Map<number, Item>();
  readonly #free: Array<Item> = [];
  readonly #all: Array<Item> = [];
  #wanted = new Set<number>();

  /** `create` makes a new item when the pool is empty; `release` hides one a note let go of. */
  constructor(create: () => Item, release: (item: Item) => void) {
    this.#create = create;
    this.#release = release;
  }

  /** Every item ever made: what disposal frees. */
  get items(): ReadonlyArray<Item> {
    return this.#all;
  }

  /** Items held by notes now. */
  get held(): number {
    return this.#held.size;
  }

  /** Start a frame: nothing is wanted yet. */
  begin(): void {
    this.#wanted = new Set();
  }

  /**
   * The item for note `node` this frame: the one it held last frame, else one
   * from the pool (`fresh` then, so the caller can set it up for this note).
   */
  take(node: number): { readonly item: Item; readonly fresh: boolean } {
    this.#wanted.add(node);
    const held = this.#held.get(node);
    if (held !== undefined) return { item: held, fresh: false };
    let item = this.#free.pop();
    if (item === undefined) {
      item = this.#create();
      this.#all.push(item);
    }
    this.#held.set(node, item);
    return { item, fresh: true };
  }

  /** The item note `node` holds, if any. */
  get(node: number): Item | undefined {
    return this.#held.get(node);
  }

  /** End a frame: the items of notes not taken go back to the pool, released. */
  end(): void {
    for (const [node, item] of this.#held) {
      if (this.#wanted.has(node)) continue;
      this.#held.delete(node);
      this.#release(item);
      this.#free.push(item);
    }
  }
}

/** The label draw budget: at most this many labels on screen, however many are in view. */
export const LABEL_BUDGET = 400;

/**
 * Of the candidate labels, the ones the budget draws: prominent ones first,
 * then the most opaque; returns how many were cut. `candidates` is reordered
 * in place and truncated to what is kept.
 */
export function budgetLabels(
  candidates: Array<number>,
  priority: (index: number) => number,
  budget = LABEL_BUDGET,
): number {
  if (candidates.length <= budget) return 0;
  candidates.sort((left, right) => priority(right) - priority(left) || left - right);
  const cut = candidates.length - budget;
  candidates.length = budget;
  return cut;
}

/** The screen area one label is given, in CSS pixels²: a reading-density spacing wide, half one tall. */
const LABEL_AREA = 96 * 48;
/** The fewest labels a frame ever draws, however small. */
const LABEL_FLOOR = 12;

/**
 * The label budget for a frame of `width` × `height` CSS pixels: one label
 * per LABEL_AREA, between LABEL_FLOOR and LABEL_BUDGET. A narrow panel names
 * fewer notes than a wide pane; the story's go first (see `placeLabels`).
 */
export function panelLabelBudget(width: number, height: number): number {
  const area = Math.max(0, width) * Math.max(0, height);
  return Math.max(LABEL_FLOOR, Math.min(LABEL_BUDGET, Math.floor(area / LABEL_AREA)));
}

/** A label's box on screen, in CSS pixels. */
export interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The grid cell size the collision test buckets boxes by, in CSS pixels. */
const CELL = 64;
/** The gap kept between two labels, in CSS pixels. */
const LABEL_GAP = 2;

/** Which side of its node a label reads on. */
export type LabelSide = "right" | "left";

/** How far a forced label may stack above or below its place, in label heights, before it gives way. */
const STACK_TRIES = 3;

/**
 * Of the candidate labels, the ones a frame draws. Forced labels (the shown
 * turn's story, a hover, a pick) come first and are never cut by the budget
 * or by an ordinary label: one that would collide with another forced label
 * reads on its node's other side, else stacks a label height above or below
 * (up to STACK_TRIES each way), and only then gives way. The rest follow,
 * highest priority first, each kept only when its box overlaps no label kept
 * before it, up to `budget`. A label reads on its node's right; one whose box
 * would cross the frame's right edge (`frameWidth`) reads on the left when
 * that fits inside the frame, and an ordinary one is cut otherwise; a forced
 * one takes whichever side shows more of it. The box tested is the box drawn,
 * and `placed` hears where each kept label goes: its side, and how far it
 * stacked (CSS pixels, down positive). `candidates` is reordered in place
 * and truncated to what is kept; returns how many were cut. `box` writes a
 * candidate's screen box on a side into its argument.
 */
export function placeLabels(
  candidates: Array<number>,
  priority: (index: number) => number,
  box: (index: number, out: LabelBox, side: LabelSide) => void,
  budget: number,
  frameWidth = Number.POSITIVE_INFINITY,
  placed?: (index: number, side: LabelSide, dy: number) => void,
  forced: (index: number) => boolean = () => false,
): number {
  const total = candidates.length;
  candidates.sort(
    (left, right) =>
      Number(forced(right)) - Number(forced(left)) ||
      priority(right) - priority(left) ||
      left - right,
  );
  const kept: Array<LabelBox> = [];
  const cells = new Map<number, Array<number>>();
  const cellKey = (x: number, y: number) => (x + 32_768) * 65_536 + (y + 32_768);
  const cellsOf = (at: LabelBox) => ({
    x0: Math.floor((at.left - LABEL_GAP) / CELL),
    x1: Math.floor((at.right + LABEL_GAP) / CELL),
    y0: Math.floor((at.top - LABEL_GAP) / CELL),
    y1: Math.floor((at.bottom + LABEL_GAP) / CELL),
  });
  const clear = (at: LabelBox) => {
    const { x0, x1, y0, y1 } = cellsOf(at);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (const other of cells.get(cellKey(x, y)) ?? []) {
          const them = kept[other];
          if (
            them !== undefined &&
            at.left < them.right + LABEL_GAP &&
            them.left < at.right + LABEL_GAP &&
            at.top < them.bottom + LABEL_GAP &&
            them.top < at.bottom + LABEL_GAP
          ) {
            return false;
          }
        }
      }
    }
    return true;
  };
  const keep = (at: LabelBox) => {
    const position = kept.length;
    kept.push(at);
    const { x0, x1, y0, y1 } = cellsOf(at);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const key = cellKey(x, y);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [position]);
        else list.push(position);
      }
    }
  };
  const boxOn = (index: number, side: LabelSide) => {
    const at: LabelBox = { left: 0, top: 0, right: 0, bottom: 0 };
    box(index, at, side);
    return at;
  };
  const shifted = (at: LabelBox, dy: number): LabelBox => ({
    left: at.left,
    right: at.right,
    top: at.top + dy,
    bottom: at.bottom + dy,
  });
  let count = 0;
  let ordinary = 0;
  for (const index of candidates) {
    // The renderer draws at most LABEL_BUDGET labels, forced or not.
    if (count >= LABEL_BUDGET) break;
    const right = boxOn(index, "right");
    const left = boxOn(index, "left");
    const rightFits = right.right <= frameWidth;
    const leftFits = left.left >= 0;
    let chosen: { at: LabelBox; side: LabelSide; dy: number } | null = null;
    if (forced(index)) {
      // The sides that show it whole, else the one showing more of it.
      const sides: Array<[LabelBox, LabelSide]> = [];
      if (rightFits) sides.push([right, "right"]);
      if (leftFits) sides.push([left, "left"]);
      if (sides.length === 0) {
        sides.push(frameWidth - right.left >= left.right ? [right, "right"] : [left, "left"]);
      }
      const height = right.bottom - right.top + LABEL_GAP;
      search: for (let tries = 0; tries <= 2 * STACK_TRIES; tries += 1) {
        const dy = tries === 0 ? 0 : (tries % 2 === 1 ? 1 : -1) * Math.ceil(tries / 2) * height;
        for (const [at, side] of sides) {
          const moved = shifted(at, dy);
          if (clear(moved)) {
            chosen = { at: moved, side, dy };
            break search;
          }
        }
      }
    } else if (ordinary < budget && count < budget) {
      const at = rightFits ? right : leftFits ? left : null;
      if (at !== null && clear(at)) chosen = { at, side: rightFits ? "right" : "left", dy: 0 };
    }
    if (chosen === null) continue;
    keep(chosen.at);
    if (!forced(index)) ordinary += 1;
    placed?.(index, chosen.side, chosen.dy);
    candidates[count] = index;
    count += 1;
  }
  candidates.length = count;
  return total - count;
}

/** On-screen label rectangles, recorded only while a bench asks for them. */
export class LabelBoxes {
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly width: Float32Array;
  readonly height: Float32Array;

  constructor(capacity = LABEL_BUDGET) {
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.width = new Float32Array(capacity);
    this.height = new Float32Array(capacity);
  }

  /** A label anchored at its left end, vertically centred at (x, y): IBM Plex Mono advances 0.6 em. */
  add(x: number, y: number, characters: number, size: number): void {
    if (this.count >= this.x.length) return;
    const at = this.count;
    this.x[at] = x;
    this.y[at] = y - size / 2;
    this.width[at] = characters * size * 0.6;
    this.height[at] = size;
    this.count += 1;
  }
}

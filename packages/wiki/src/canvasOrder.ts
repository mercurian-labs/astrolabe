/**
 * Which of a board's things is on top of which: one order, kept as a key on each at `astrolabe.z`.
 * Sections stack beneath everything else; cards, arrows and drawings share one order above them.
 * Pure, and the phone draws by it too: no array methods newer than its engine has.
 */
import type {
  CanvasBounds,
  CanvasData,
  CanvasEdge,
  CanvasGroupNode,
  CanvasInk,
  CanvasNode,
} from "./canvas.ts";

// Keys are fractional indexes, as rocicorp's fractional-indexing (CC0) writes them: a whole part
// whose first letter says its length, then a fraction, all sorting as plain strings. Appending
// grows a key a character every few thousand times; a key fits between any two.
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const SMALLEST = `A${"0".repeat(26)}`;

const wholeLength = (head: string) =>
  head >= "a" && head <= "z"
    ? head.charCodeAt(0) - 97 + 2
    : head >= "A" && head <= "Z"
      ? 90 - head.charCodeAt(0) + 2
      : 0;

const isDigits = (text: string) => [...text].every((char) => DIGITS.includes(char));

/** A key the board can order by. Anything else stacks as though it had none. */
export function isCanvasOrderKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || value === SMALLEST) return false;
  const length = wholeLength(value[0] ?? "");
  if (length === 0 || value.length < length || !isDigits(value.slice(1))) return false;
  return !value.slice(length).endsWith("0");
}

/** The digits between fractions `a` and `b`; `b` null is the end. */
function midpoint(a: string, b: string | null): string {
  let shared = 0;
  if (b !== null) {
    while ((a[shared] ?? "0") === b[shared]) shared += 1;
    if (shared > 0) return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
  }
  const low = a === "" ? 0 : DIGITS.indexOf(a[0]!);
  const high = b === null ? DIGITS.length : DIGITS.indexOf(b[0]!);
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low]! + midpoint(a.slice(1), null);
}

/** The whole part one up or down, or null past the last one there is. */
function stepped(whole: string, up: boolean): string | null {
  const [head = "", ...digits] = whole;
  const [edge, wrap] = up ? [DIGITS.length - 1, 0] : [0, DIGITS.length - 1];
  let carried = true;
  for (let at = digits.length - 1; carried && at >= 0; at--) {
    const digit = DIGITS.indexOf(digits[at]!);
    if (digit === edge) digits[at] = DIGITS[wrap]!;
    else {
      digits[at] = DIGITS[digit + (up ? 1 : -1)]!;
      carried = false;
    }
  }
  if (!carried) return head + digits.join("");
  if (up ? head === "Z" : head === "a") return up ? "a0" : `Z${DIGITS[DIGITS.length - 1]}`;
  if (up ? head === "z" : head === "A") return null;
  const next = String.fromCharCode(head.charCodeAt(0) + (up ? 1 : -1));
  if (up ? next > "a" : next < "Z") digits.push(DIGITS[wrap]!);
  else digits.pop();
  return next + digits.join("");
}

/** A key that sorts after `below` and before `above`, either of which may be the end. */
export function canvasOrderKeyBetween(below: string | null, above: string | null): string {
  if (below !== null && above !== null && below >= above) {
    throw new Error(`No order key fits between ${below} and ${above}.`);
  }
  if (below === null && above === null) return "a0";
  if (below === null) {
    const whole = above!.slice(0, wholeLength(above![0]!));
    if (whole === SMALLEST) return whole + midpoint("", above!.slice(whole.length));
    if (whole < above!) return whole;
    const down = stepped(whole, false);
    if (down === null) throw new Error("No order key fits below the lowest there is.");
    return down;
  }
  const whole = below.slice(0, wholeLength(below[0]!));
  const fraction = below.slice(whole.length);
  if (above === null) return stepped(whole, true) ?? whole + midpoint(fraction, null);
  const aboveWhole = above.slice(0, wholeLength(above[0]!));
  if (whole === aboveWhole) return whole + midpoint(fraction, above.slice(whole.length));
  const up = stepped(whole, true);
  return up !== null && up < above ? up : whole + midpoint(fraction, null);
}

/** `count` keys in order between two, spread so each half has room. */
export function canvasOrderKeysBetween(
  below: string | null,
  above: string | null,
  count: number,
): string[] {
  if (count <= 0) return [];
  if (count === 1) return [canvasOrderKeyBetween(below, above)];
  // Past an open end, keys count on from it, each as short as it can be.
  if (above === null) {
    const keys: string[] = [];
    let last = below;
    for (let made = 0; made < count; made++) keys.push((last = canvasOrderKeyBetween(last, null)));
    return keys;
  }
  const middle = canvasOrderKeyBetween(below, above);
  const half = Math.floor((count - 1) / 2);
  return [
    ...canvasOrderKeysBetween(below, middle, half),
    middle,
    ...canvasOrderKeysBetween(middle, above, count - 1 - half),
  ];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A file entry's order key, when it has one the board can use. */
export function canvasOrderKeyOf(raw: unknown): string | undefined {
  if (!isRecord(raw) || !isRecord(raw.astrolabe)) return undefined;
  const { z } = raw.astrolabe;
  return isCanvasOrderKey(z) ? z : undefined;
}

/**
 * `items` as they stack, bottom first, given bottom first as a file without keys stacks them. Those
 * with keys sort by them; one without stays just above the nearest with a key below it here.
 */
export function canvasStackOrder<A>(
  items: ReadonlyArray<A>,
  keyOf: (item: A) => string | undefined,
): A[] {
  const keyed: Array<{ readonly item: A; readonly key: string; readonly at: number }> = [];
  const after = new Map<number, A[]>();
  const loose: A[] = [];
  let anchor = -1;
  items.forEach((item, at) => {
    const key = keyOf(item);
    if (key !== undefined) {
      keyed.push({ item, key, at });
      anchor = at;
      return;
    }
    if (anchor === -1) {
      loose.push(item);
      return;
    }
    const held = after.get(anchor);
    if (held === undefined) after.set(anchor, [item]);
    else held.push(item);
  });
  if (keyed.length === 0) return loose;
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.at - b.at));
  const stacked = loose;
  for (const { item, at } of keyed) stacked.push(item, ...(after.get(at) ?? []));
  return stacked;
}

/** One of the things above the sections, which share one order. */
export type CanvasLayer =
  | { readonly kind: "card"; readonly node: Exclude<CanvasNode, CanvasGroupNode> }
  | { readonly kind: "arrow"; readonly edge: CanvasEdge }
  | { readonly kind: "drawing"; readonly ink: CanvasInk };

export interface CanvasStack {
  /** Bottom first, beneath everything else. */
  readonly sections: ReadonlyArray<CanvasGroupNode>;
  /** Cards, arrows and drawings, bottom first. */
  readonly content: ReadonlyArray<CanvasLayer>;
}

const area = (node: CanvasBounds) => node.width * node.height;

/** Sections as a file without keys stacks them: the largest beneath, so each shows its own. */
const sectionsUnkeyed = (nodes: ReadonlyArray<CanvasNode>) =>
  nodes
    .filter((node): node is CanvasGroupNode => node.type === "group")
    .sort((a, b) => area(b) - area(a));

/** The rest as a file without keys stacks it: arrows, then cards, then drawings, each in file order. */
const contentUnkeyed = (data: Pick<CanvasData, "nodes" | "edges" | "drawings">): CanvasLayer[] => [
  ...data.edges.map((edge): CanvasLayer => ({ kind: "arrow", edge })),
  ...data.nodes.flatMap((node): CanvasLayer[] =>
    node.type === "group" ? [] : [{ kind: "card", node }],
  ),
  ...(data.drawings ?? []).map((ink): CanvasLayer => ({ kind: "drawing", ink })),
];

export const canvasLayerOf = (layer: CanvasLayer): CanvasNode | CanvasEdge | CanvasInk =>
  layer.kind === "card" ? layer.node : layer.kind === "arrow" ? layer.edge : layer.ink;

const layerKey = (layer: CanvasLayer) => canvasLayerOf(layer).astrolabe?.z;

/** A board's things in the order they're drawn, on screen, in an image and on the phone alike. */
export function canvasStack(data: Pick<CanvasData, "nodes" | "edges" | "drawings">): CanvasStack {
  return {
    sections: canvasStackOrder(sectionsUnkeyed(data.nodes), (node) => node.astrolabe?.z),
    content: canvasStackOrder(contentUnkeyed(data), layerKey),
  };
}

/** The `set-card`, `set-arrow` or `set-drawing` keys that give `raw` the key `z`, its `astrolabe` kept. */
export function canvasOrderKeys(
  raw: Readonly<Record<string, unknown>>,
  z: string,
): { readonly astrolabe: Record<string, unknown> } {
  return { astrolabe: { ...(isRecord(raw.astrolabe) ? raw.astrolabe : {}), z } };
}

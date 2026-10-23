/**
 * Astrolabe: sidebar threads dragged past the list onto the chat tabs open there as tabs. The
 * sidebar's drag past its list (see `threadContextDrag.ts`, where a composer takes the drop
 * instead) reports the pointer here first; the strip registers how it shows the insertion line
 * and opens the threads dropped on it, so neither side imports the other's state.
 */

/** What a strip does with a drag over it: the line at `x` (null to clear it), and a drop there. */
export interface ThreadTabDropTarget {
  readonly over: (x: number | null) => void;
  /** Opens `keys` (in list order) at `x`, showing `front`. */
  readonly drop: (keys: readonly string[], x: number, front: string) => void;
}

const strips = new Map<Element, ThreadTabDropTarget>();
let current: ThreadTabDropTarget | null = null;

/** Makes `element`, a chat tab strip, take sidebar threads dropped on it. */
export function registerThreadTabDrop(element: Element, target: ThreadTabDropTarget) {
  strips.set(element, target);
  return () => {
    if (strips.get(element) === target) strips.delete(element);
    if (current === target) current = null;
  };
}

function stripAt(point: { x: number; y: number }): ThreadTabDropTarget | null {
  for (const element of document.elementsFromPoint(point.x, point.y)) {
    const target = strips.get(element);
    if (target) return target;
  }
  return null;
}

/** Shows the insertion line on the strip under the pointer; whether there is one. */
export function moveThreadTabDrag(point: { x: number; y: number }): boolean {
  const target = stripAt(point);
  if (current !== target) current?.over(null);
  current = target;
  target?.over(point.x);
  return target !== null;
}

/** Clears the insertion line, as the drag ends anywhere. */
export function endThreadTabDrag() {
  current?.over(null);
  current = null;
}

/** Opens `keys` on the strip under the pointer, showing `front`; whether a strip took them. */
export function dropThreadTabs(
  point: { x: number; y: number },
  keys: readonly string[],
  front: string,
): boolean {
  const target = stripAt(point);
  endThreadTabDrag();
  if (!target || keys.length === 0) return false;
  target.drop(keys, point.x, front);
  return true;
}

/** `keys` in the sidebar's order (`ordered`), those it does not list kept last as given. */
export function inListOrder(keys: Iterable<string>, ordered: readonly string[]): string[] {
  const position = new Map(ordered.map((key, index) => [key, index] as const));
  return [...keys].toSorted(
    (left, right) =>
      (position.get(left) ?? Number.POSITIVE_INFINITY) -
      (position.get(right) ?? Number.POSITIVE_INFINITY),
  );
}

import type { HistoryDirection } from "~/tabNavigation.logic";

/**
 * Astrolabe: where a go-to took you from. Back and Forward follow these before the tab's own
 * history, while the tab in front is where the jump led: a jump opens a new tab or moves the
 * cursor in this one, and neither is a step of a tab's history. Kept for this page only.
 */
export interface JumpSpot {
  readonly tabKey: string;
  /** From 1; a tab with no cursor (a multi-file view) has neither. */
  readonly line?: number;
  readonly column?: number;
}

interface Jump {
  readonly from: JumpSpot;
  readonly to: JumpSpot;
}

const KEPT = 100;

export function createJumpHistory(kept = KEPT) {
  const back: Jump[] = [];
  const forward: Jump[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  /** The nearest jump `direction` from the tab; older ones are left for after it. */
  const nearest = (direction: HistoryDirection, tabKey: string) =>
    direction === "back"
      ? back.findLastIndex((jump) => jump.to.tabKey === tabKey)
      : forward.findLastIndex((jump) => jump.from.tabKey === tabKey);
  return {
    record(from: JumpSpot, toTabKey: string) {
      back.push({ from, to: { tabKey: toTabKey } });
      if (back.length > kept) back.shift();
      forward.length = 0;
      notify();
    },
    can: (direction: HistoryDirection, tabKey: string) => nearest(direction, tabKey) >= 0,
    /** Takes the step from `here`, which the opposite direction can come back to. */
    take(direction: HistoryDirection, here: JumpSpot): JumpSpot | null {
      const at = nearest(direction, here.tabKey);
      if (at < 0) return null;
      const [taken] = (direction === "back" ? back : forward).splice(at);
      if (!taken) return null;
      if (direction === "back") forward.push({ from: taken.from, to: here });
      else back.push({ from: here, to: taken.to });
      notify();
      return direction === "back" ? taken.from : taken.to;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const jumpHistory = createJumpHistory();

// Each open file tab's cursor, read at the moment a jump leaves it.
const cursors = new Map<string, () => Pick<JumpSpot, "line" | "column">>();

/** Lets a jump from `tabKey` remember the cursor, until the returned function is called. */
export function trackJumpCursor(tabKey: string, read: () => Pick<JumpSpot, "line" | "column">) {
  cursors.set(tabKey, read);
  return () => {
    if (cursors.get(tabKey) === read) cursors.delete(tabKey);
  };
}

/** `tabKey` as a jump would leave it now. */
export const jumpSpot = (tabKey: string): JumpSpot => ({ tabKey, ...cursors.get(tabKey)?.() });

/** Remembers a jump leaving `from` for the tab `to`, which is `from` for one within a file. */
export const recordJump = (from: string, to: string) => jumpHistory.record(jumpSpot(from), to);

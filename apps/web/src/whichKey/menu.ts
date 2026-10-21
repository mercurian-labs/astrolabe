import type { KeybindingCommand } from "@t3tools/contracts";

/**
 * Astrolabe: the keyboard menu's model, after LazyVim's which-key. A menu is a tree of groups;
 * each row has keys that either open a further group or run a command. The menu reads the keys
 * that follow its door one at a time, never times out, and closes only on Escape (or Backspace at
 * the root), on losing focus, or when a key runs a command. A cursor also walks the rows (the
 * arrow keys, Enter), as does the mouse. See `WhichKey.tsx` for the doors.
 */

/** The menu's own chord (⌘K, Ctrl+K) as a row's key. */
export const CHORD = "chord";

/** A row of the menu: its keys, what it says, and either a group to open or a command to run. */
export interface WhichKeyItem {
  /**
   * Every key that chooses it from its group, as `KeyboardEvent.key` names them (or `CHORD`),
   * shown as its keycaps; the first is its step in a path.
   */
  readonly keys: readonly [string, ...string[]];
  readonly label: string;
  readonly group?: WhichKeyGroup;
  /** Runs after the menu closes. */
  readonly run?: () => void;
  /** Shown faint: there is nothing for it to act on here. */
  readonly disabled?: boolean;
  /** The command it runs, for a row a keybinding made. */
  readonly command?: KeybindingCommand;
}

export interface WhichKeyGroup {
  readonly label: string;
  readonly items: readonly WhichKeyItem[];
}

/** How the menu was opened: by the chord (⌘K, Ctrl+K), or by the device's leader key. */
export type WhichKeyDoor = "chord" | "leader";

export interface WhichKeyState {
  readonly door: WhichKeyDoor;
  /** The group keys from the root to the group showing. */
  readonly path: readonly string[];
  /** The row the cursor is on, by its place in the group showing; null before it moves. */
  readonly cursor: number | null;
  /** Said beneath the rows until the next key, when a key did nothing. */
  readonly note: string | null;
  /**
   * Whether the menu is drawn. The chord shows it at once; the leader shows it only after a pause
   * (`LEADER_REVEAL_MS`), so a fast sequence runs without it flashing.
   */
  readonly shown: boolean;
}

/** How long the leader waits, after it or each group key, before the menu draws. */
export const LEADER_REVEAL_MS = 300;

export const NOT_BOUND = "Not bound";
export const NOT_HERE = "Not available here";

export function openWhichKey(door: WhichKeyDoor): WhichKeyState {
  return { door, path: [], cursor: null, note: null, shown: door === "chord" };
}

/** The row a key chooses in a group. */
function itemFor(group: WhichKeyGroup, key: string): WhichKeyItem | undefined {
  return group.items.find((item) => item.keys.includes(key));
}

/** The group a path of group keys leads to from the root. */
export function groupAt(root: WhichKeyGroup, path: readonly string[]): WhichKeyGroup {
  return path.reduce((group, key) => itemFor(group, key)?.group ?? group, root);
}

/**
 * A row's keys as its keycaps show them: `["g", "w"]`. The chord is a key of Search's row but
 * goes unshown beside another key (it is the menu's own door); alone, it shows by its label.
 */
export function keyLabels(item: WhichKeyItem, chordLabel: string): readonly string[] {
  const keys = item.keys.filter((key) => key !== CHORD);
  return keys.length > 0 ? keys : [chordLabel];
}

/** The root's name in the menu's header. */
export const MENU_TITLE = "Menu";

/** The groups the menu has entered, by name, as its header shows them: `["Menu", "Go to"]`. */
export function menuTrail(root: WhichKeyGroup, path: readonly string[]): readonly string[] {
  const trail = [MENU_TITLE];
  let group = root;
  for (const key of path) {
    const next = itemFor(group, key)?.group;
    if (!next) break;
    trail.push(next.label);
    group = next;
  }
  return trail;
}

/**
 * A trail short enough for the header: the root and the last `keep` groups, the ones between
 * folded into `…` (`Menu › … › Debug › Breakpoints`). The current group always shows whole.
 */
export function shortTrail(trail: readonly string[], keep = 2): readonly string[] {
  if (trail.length <= keep + 2) return trail;
  return [trail[0] ?? MENU_TITLE, "…", ...trail.slice(-keep)];
}

/** What a key does to the menu: its next state (null once closed), and a command to run. */
interface WhichKeyStep {
  readonly state: WhichKeyState | null;
  readonly run: (() => void) | null;
}

/** What choosing a row does: opens its group, runs its command, or says why it cannot. */
function choose(state: WhichKeyState, item: WhichKeyItem | undefined): WhichKeyStep {
  // A key that does nothing says so, and the menu shows, to say it.
  if (!item) return { state: { ...state, note: NOT_BOUND, shown: true }, run: null };
  if (item.disabled) return { state: { ...state, note: NOT_HERE, shown: true }, run: null };
  if (item.group) {
    const path = [...state.path, item.keys[0]];
    return { state: { ...state, path, cursor: null, note: null }, run: null };
  }
  return { state: null, run: item.run ?? null };
}

/**
 * Reads one key. `key` is a `KeyboardEvent.key` for a key pressed without ⌘, Ctrl or Alt, or
 * `CHORD` for the menu's own chord pressed again, which in a group goes back to the root and
 * at the root chooses the row it is a key of. ArrowDown and ArrowUp move the cursor (wrapping,
 * and showing the menu), and Enter chooses the row it is on.
 */
export function pressWhichKey(
  state: WhichKeyState,
  root: WhichKeyGroup,
  key: string,
): WhichKeyStep {
  if (key === "Escape") return { state: null, run: null };
  if (key === "Backspace") {
    return state.path.length === 0
      ? { state: null, run: null }
      : {
          state: { ...state, path: state.path.slice(0, -1), cursor: null, note: null },
          run: null,
        };
  }
  if (key === CHORD && state.path.length > 0) {
    return { state: { ...state, path: [], cursor: null, note: null }, run: null };
  }
  const group = groupAt(root, state.path);
  if (key === "ArrowDown" || key === "ArrowUp") {
    const rows = group.items.length;
    if (rows === 0) return { state, run: null };
    const step = key === "ArrowDown" ? 1 : -1;
    const from = state.cursor ?? (step === 1 ? -1 : rows);
    const cursor = (from + step + rows) % rows;
    return { state: { ...state, cursor, note: null, shown: true }, run: null };
  }
  if (key === "Enter") {
    if (state.cursor === null) return { state, run: null };
    return choose(state, group.items[state.cursor]);
  }
  return choose(state, itemFor(group, key));
}

/**
 * The page's one menu: its state, held outside React so the doors (a window listener, an
 * editor's leader key) and the popover share it, and where it was opened from (`origin`, which its
 * commands may act on). While the menu is open but not yet shown, each change restarts the pause
 * that shows it.
 */
export function createWhichKeyMenu<Origin = null>() {
  let state: WhichKeyState | null = null;
  let origin: Origin | null = null;
  let reveal: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: WhichKeyState | null) => {
    if (reveal !== null) clearTimeout(reveal);
    reveal = null;
    state = next;
    if (next && !next.shown) {
      reveal = setTimeout(() => set(state && { ...state, shown: true }), LEADER_REVEAL_MS);
    }
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Opens at the root; opening again while open starts over, by the new door. */
    open: (door: WhichKeyDoor, from: Origin | null = null) => {
      origin = from;
      set(openWhichKey(door));
    },
    /** Where the menu was last opened from. */
    origin: () => origin,
    /** Reads a key (see `pressWhichKey`); returns the command it chose, for the caller to run. */
    press(root: WhichKeyGroup, key: string): (() => void) | null {
      if (!state) return null;
      const step = pressWhichKey(state, root, key);
      set(step.state);
      return step.run;
    },
    /** Puts the cursor on a row, as the mouse does by pointing at it. */
    point(cursor: number) {
      if (state && state.cursor !== cursor) set({ ...state, cursor });
    },
    close: () => {
      if (state) set(null);
    },
  };
}

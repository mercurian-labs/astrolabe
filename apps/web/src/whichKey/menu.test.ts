import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  CHORD,
  CURSOR_DOWN,
  CURSOR_UP,
  NOT_BOUND,
  NOT_HERE,
  LEADER_REVEAL_MS,
  createWhichKeyMenu,
  keyLabels,
  pressRepeat,
  menuTrail,
  shortTrail,
  type WhichKeyGroup,
} from "./menu";

function tree() {
  const ran: string[] = [];
  const run = (name: string) => () => void ran.push(name);
  const root: WhichKeyGroup = {
    label: "Keyboard commands",
    items: [
      { keys: [":"], label: "Command palette", run: run("ex palette") },
      { keys: ["/", CHORD], label: "Search", run: run("palette") },
      {
        keys: ["g"],
        label: "Go to",
        group: {
          label: "Go to",
          items: [
            { keys: ["w"], label: "Wikis", run: run("wikis") },
            { keys: ["p"], label: "Pull requests", disabled: true, run: run("pull requests") },
          ],
        },
      },
      { keys: [","], label: "Settings", run: run("settings") },
    ],
  };
  return { root, ran };
}

describe("the keyboard menu's header", () => {
  it("names the groups entered, and folds the middle of a deep trail", () => {
    expect(menuTrail(tree().root, [])).toEqual(["Menu"]);
    expect(shortTrail(["Menu", "Go to"])).toEqual(["Menu", "Go to"]);
    expect(shortTrail(["Menu", "A", "B", "C"])).toEqual(["Menu", "A", "B", "C"]);
    expect(shortTrail(["Menu", "A", "B", "C", "D"])).toEqual(["Menu", "…", "C", "D"]);
  });
});

describe("the keyboard menu", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("walks into a group and runs a command, which closes it", () => {
    const { root, ran } = tree();
    const menu = createWhichKeyMenu();
    menu.open("chord");
    expect(menu.getState()).toMatchObject({ path: [], shown: true });
    expect(menu.press(root, "g")).toBeNull();
    expect(menu.getState()?.path).toEqual(["g"]);
    expect(menuTrail(root, menu.getState()!.path)).toEqual(["Menu", "Go to"]);
    menu.press(root, "w")?.();
    expect(menu.getState()).toBeNull();
    expect(ran).toEqual(["wikis"]);
  });

  it("goes up a level on Backspace, and closes on Backspace at the root or on Escape", () => {
    const { root } = tree();
    const menu = createWhichKeyMenu();
    menu.open("chord");
    menu.press(root, "g");
    menu.press(root, "Backspace");
    expect(menu.getState()?.path).toEqual([]);
    menu.press(root, "Backspace");
    expect(menu.getState()).toBeNull();
    menu.open("chord");
    menu.press(root, "g");
    menu.press(root, "Escape");
    expect(menu.getState()).toBeNull();
  });

  it("says Not bound for a key with no row and stays open where it was", () => {
    const { root, ran } = tree();
    const menu = createWhichKeyMenu();
    menu.open("chord");
    menu.press(root, "g");
    expect(menu.press(root, "x")).toBeNull();
    expect(menu.getState()).toMatchObject({ path: ["g"], note: NOT_BOUND });
    // A disabled row runs nothing either, and says why.
    menu.press(root, "p");
    expect(menu.getState()).toMatchObject({ path: ["g"], note: NOT_HERE });
    // The next key clears the note.
    menu.press(root, "Backspace");
    expect(menu.getState()?.note).toBeNull();
    expect(ran).toEqual([]);
  });

  it("runs a row by any of its keys: the chord again at the root, and returns to the root from a group", () => {
    const { root, ran } = tree();
    const menu = createWhichKeyMenu();
    menu.open("chord");
    menu.press(root, "g");
    expect(menu.press(root, CHORD)).toBeNull();
    expect(menu.getState()?.path).toEqual([]);
    menu.press(root, CHORD)?.();
    expect(ran).toEqual(["palette"]);
    // `/` is the same row, for Space /.
    menu.open("leader");
    menu.press(root, "/")?.();
    expect(ran).toEqual(["palette", "palette"]);
  });

  it("moves a cursor over the rows, wrapping, and Enter chooses the row it is on", () => {
    const { root, ran } = tree();
    const menu = createWhichKeyMenu();
    menu.open("leader");
    // Enter before the cursor moves chooses nothing.
    menu.press(root, "Enter");
    expect(menu.getState()).toMatchObject({ cursor: null, note: null });
    // The cursor shows the menu at once, and wraps from either end.
    menu.press(root, "ArrowUp");
    expect(menu.getState()).toMatchObject({ cursor: 3, shown: true });
    menu.press(root, "ArrowDown");
    menu.press(root, "ArrowDown");
    menu.press(root, "ArrowDown");
    expect(menu.getState()?.cursor).toBe(2);
    // A group row opens its group, with the cursor reset.
    menu.press(root, "Enter");
    expect(menu.getState()).toMatchObject({ path: ["g"], cursor: null });
    menu.press(root, "ArrowDown");
    menu.press(root, "ArrowDown");
    menu.press(root, "Enter");
    expect(menu.getState()?.note).toBe(NOT_HERE);
    // The mouse points the cursor, as a click does before it chooses.
    menu.point(0);
    menu.press(root, "Enter")?.();
    expect(menu.getState()).toBeNull();
    expect(ran).toEqual(["wikis"]);
  });

  it("runs an arrow a group binds, where the arrows would otherwise move the cursor", () => {
    const ran: string[] = [];
    const root: WhichKeyGroup = {
      label: "Keyboard commands",
      items: [
        {
          keys: ["p"],
          label: "Panes",
          group: {
            label: "Panes",
            items: [
              { keys: ["j", "ArrowDown"], label: "Focus down", run: () => ran.push("down") },
              { keys: ["v"], label: "Split right", run: () => ran.push("split") },
            ],
          },
        },
      ],
    };
    const menu = createWhichKeyMenu();
    menu.open("chord");
    menu.press(root, "p");
    // ArrowUp is unbound here, so it still moves the cursor.
    menu.press(root, "ArrowUp");
    expect(menu.getState()?.cursor).toBe(1);
    // The cursor keys (Ctrl+N, Ctrl+P on a Mac) move it past a bound arrow too.
    menu.press(root, CURSOR_DOWN);
    expect(menu.getState()?.cursor).toBe(0);
    menu.press(root, CURSOR_UP);
    expect(menu.getState()?.cursor).toBe(1);
    menu.press(root, "ArrowDown")?.();
    expect(menu.getState()).toBeNull();
    expect(ran).toEqual(["down"]);
    expect(keyLabels(root.items[0]!.group!.items[0]!, "⌘K")).toEqual(["j", "↓"]);
  });

  it("shows at once on the chord, and on Space only after a pause that each key restarts", () => {
    const { root, ran } = tree();
    const menu = createWhichKeyMenu();
    menu.open("leader");
    expect(menu.getState()?.shown).toBe(false);
    vi.advanceTimersByTime(LEADER_REVEAL_MS - 50);
    menu.press(root, "g");
    vi.advanceTimersByTime(LEADER_REVEAL_MS - 50);
    // Still hidden: the group key restarted the pause.
    expect(menu.getState()?.shown).toBe(false);
    vi.advanceTimersByTime(50);
    expect(menu.getState()).toMatchObject({ path: ["g"], shown: true });
    expect(menuTrail(root, menu.getState()!.path)).toEqual(["Menu", "Go to"]);

    // A fast sequence runs without ever showing.
    menu.open("leader");
    menu.press(root, ",")?.();
    vi.advanceTimersByTime(LEADER_REVEAL_MS * 2);
    expect(menu.getState()).toBeNull();
    expect(ran).toEqual(["settings"]);

    // A key that does nothing shows the menu at once, to say so.
    menu.open("leader");
    menu.press(root, "x");
    expect(menu.getState()).toMatchObject({ shown: true, note: NOT_BOUND });
  });

  it("never times out on its own", () => {
    const menu = createWhichKeyMenu();
    menu.open("chord");
    vi.advanceTimersByTime(60_000);
    expect(menu.getState()).not.toBeNull();
    menu.close();
    expect(menu.getState()).toBeNull();
  });
});

describe("the repeat window after a repeatable command", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function focusTree({ edge = false } = {}) {
    const ran: string[] = [];
    const move = (direction: string) => ({
      keys: [direction[0]!] as [string],
      label: `Focus ${direction}`,
      repeatable: true,
      run: () => void ran.push(direction),
    });
    const root: WhichKeyGroup = {
      label: "Keyboard commands",
      items: [
        { ...move("left"), keys: ["h"] },
        { ...move("down"), keys: ["j"], disabled: edge },
        { keys: [","], label: "Settings", run: () => void ran.push("settings") },
        {
          keys: ["p"],
          label: "Panes",
          group: {
            label: "Panes",
            items: [{ keys: ["v"], label: "Split right", run: () => void ran.push("split") }],
          },
        },
      ],
    };
    return { root, ran };
  }

  it("arms after a repeatable key, closed and unshown, and each repeat restarts it", () => {
    const { root, ran } = focusTree();
    const menu = createWhichKeyMenu();
    menu.open("leader");
    menu.press(root, "h", { repeatMs: 1000 })?.();
    expect(menu.getState()).toBeNull();
    expect(menu.isArmed()).toBe(true);
    vi.advanceTimersByTime(900);
    const step = menu.pressRepeat(root, "j", 1000);
    expect(step).toMatchObject({ consumed: true, repeating: true });
    step?.run?.();
    vi.advanceTimersByTime(900);
    // Still armed: the repeat restarted the window.
    expect(menu.isArmed()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(menu.isArmed()).toBe(false);
    expect(menu.pressRepeat(root, "h", 1000)).toBeNull();
    expect(ran).toEqual(["left", "down"]);
  });

  it("ends on another key, which goes on to the page, but spends Escape", () => {
    const { root, ran } = focusTree();
    const menu = createWhichKeyMenu();
    menu.open("chord");
    menu.press(root, "h", { repeatMs: 1000 })?.();
    expect(menu.pressRepeat(root, "x", 1000)).toEqual({
      consumed: false,
      repeating: false,
      run: null,
    });
    expect(menu.isArmed()).toBe(false);

    menu.open("chord");
    menu.press(root, "h", { repeatMs: 1000 })?.();
    // A key of the menu that is not repeatable ends it too, and is not run from here.
    expect(menu.pressRepeat(root, ",", 1000)?.consumed).toBe(false);
    expect(menu.isArmed()).toBe(false);

    menu.open("chord");
    menu.press(root, "h", { repeatMs: 1000 })?.();
    expect(menu.pressRepeat(root, "Escape", 1000)).toEqual({
      consumed: true,
      repeating: false,
      run: null,
    });
    expect(menu.isArmed()).toBe(false);
    expect(ran).toEqual(["left", "left", "left"]);
  });

  it("keeps the window on a repeatable key with nothing to act on, which runs nothing", () => {
    const { root } = focusTree({ edge: true });
    expect(pressRepeat(root, [], "j")).toEqual({ consumed: true, repeating: true, run: null });
    expect(pressRepeat(root, [], "Escape").consumed).toBe(true);
    expect(pressRepeat(root, [], "x").consumed).toBe(false);
  });

  it("never arms with a window of 0, from a click, or after a command that does not repeat", () => {
    const { root } = focusTree();
    const menu = createWhichKeyMenu();
    menu.open("chord");
    menu.press(root, "h", { repeatMs: 0 })?.();
    expect(menu.isArmed()).toBe(false);
    // A click chooses a row through Enter, without a window.
    menu.open("chord");
    menu.press(root, "ArrowDown");
    menu.press(root, "Enter")?.();
    expect(menu.isArmed()).toBe(false);
    menu.open("chord");
    menu.press(root, ",", { repeatMs: 1000 })?.();
    expect(menu.isArmed()).toBe(false);
  });

  it("ends when the menu opens again or closes, as on a click elsewhere", () => {
    const { root } = focusTree();
    const menu = createWhichKeyMenu();
    menu.open("chord");
    menu.press(root, "h", { repeatMs: 1000 })?.();
    menu.open("leader");
    expect(menu.isArmed()).toBe(false);
    menu.press(root, "h", { repeatMs: 1000 })?.();
    menu.close();
    expect(menu.isArmed()).toBe(false);
  });
});

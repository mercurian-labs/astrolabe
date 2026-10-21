import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  CHORD,
  NOT_BOUND,
  NOT_HERE,
  LEADER_REVEAL_MS,
  createWhichKeyMenu,
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

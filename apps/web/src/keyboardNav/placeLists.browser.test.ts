import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { DEFAULT_RESOLVED_TRIGGERS } from "@t3tools/shared/keybindingTriggers";
import { describe, expect, it } from "vite-plus/test";

import { appCommand, type AppCommandContext } from "~/whichKey/commands";
import { pressRepeat } from "~/whichKey/menu";
import { whichKeyRoot } from "~/whichKey/registry";
import {
  forgetEnteredRow,
  handleListKey,
  isListRow,
  keepsListFocus,
  listDefaultRow,
  takesListKey,
} from "./placeLists";

/** Forgets, as a test ends, the row it entered and what it put on the page. */
function cleanup(): Disposable {
  return {
    [Symbol.dispose]() {
      forgetEnteredRow();
      document.body.replaceChildren();
    },
  };
}

/** Presses `key` on `element` with the lists reading it; what Escape handed on, if anything. */
function press(element: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) {
  const escaped: HTMLElement[] = [];
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  element.addEventListener(
    "keydown",
    (keydown) => handleListKey(keydown, { onEscape: (row) => void escaped.push(row) }),
    { once: true },
  );
  element.dispatchEvent(event);
  return { taken: event.defaultPrevented, escaped };
}

// The sidebar beside a pane, as the app lays them out.
const SIDEBAR = `
  <div style="display: flex">
    <div data-app-sidebar>
      <div role="button" tabindex="0" data-testid="sidebar-row-card" id="a">a</div>
      <div role="button" tabindex="0" data-testid="sidebar-row-card" id="b">b</div>
    </div>
    <div data-pane-id="p"><div role="tab" tabindex="0" data-pane-tab id="pill">tab</div></div>
  </div>`;

const byId = (id: string) => document.getElementById(id)!;

/** The menu's root as the repeat window reads it, with focus on `element`. */
function rootFrom(element: Element) {
  const context: AppCommandContext = {
    section: null,
    chatTabs: null,
    panes: null,
    sections: [],
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    origin: { element, view: null, write: null },
    openSearch: () => {},
    openFilePicker: () => {},
    openCommandLine: () => {},
    findDocument: () => {},
  };
  return whichKeyRoot(DEFAULT_RESOLVED_TRIGGERS, (id) => appCommand(id, context));
}

describe("the sidebar list's keys after a focus move from the menu", () => {
  it("go on to the list: up or down with nowhere to go ends the window rather than being spent", () => {
    using _cleanup = cleanup();
    document.body.innerHTML = SIDEBAR;
    // The bug: after Space h into the sidebar, j/k (and the arrows) restarted the window and
    // moved nothing, so the list never stepped while they came faster than the window.
    for (const key of ["j", "k", "ArrowDown", "ArrowUp"]) {
      expect(pressRepeat(rootFrom(byId("a")), [], key), key).toEqual({
        consumed: false,
        repeating: false,
        run: null,
      });
    }
    // Sideways, and from a place that is no list, the window still spends the key.
    expect(pressRepeat(rootFrom(byId("a")), [], "l").consumed).toBe(true);
    expect(pressRepeat(rootFrom(byId("pill")), [], "j").consumed).toBe(true);
  });
});

describe("Enter on a sidebar row", () => {
  it("keeps focus in the list while what it opened appears, until a press elsewhere", () => {
    using _cleanup = cleanup();
    document.body.innerHTML = SIDEBAR;
    const row = byId("a");
    let clicked = 0;
    row.addEventListener("click", () => clicked++);
    row.focus();
    press(row, "Enter");
    expect(clicked).toBe(1);
    // ChatView reads this before handing focus to the composer of the thread just opened.
    expect(keepsListFocus()).toBe(true);
    byId("b").focus();
    expect(keepsListFocus()).toBe(false);
    row.focus();
    forgetEnteredRow();
    expect(keepsListFocus()).toBe(false);
  });
  it("clicks with Alt held for Alt+Enter, which opens the row in a new tab", () => {
    using _cleanup = cleanup();
    document.body.innerHTML = SIDEBAR;
    const row = byId("a");
    const clicks: boolean[] = [];
    row.addEventListener("click", (event) => clicks.push(event.altKey));
    row.focus();
    press(row, "Enter");
    expect(press(row, "Enter", { altKey: true }).taken).toBe(true);
    // Any other Alt chord stays the page's.
    expect(press(row, "j", { altKey: true }).taken).toBe(false);
    expect(clicks).toEqual([false, true]);
  });
});

describe("which keys a sidebar row keeps from the page", () => {
  it("is its list's moves, which the right panel's launcher letters leave to it", () => {
    using _cleanup = cleanup();
    document.body.innerHTML = SIDEBAR;
    for (const key of ["g", "G", "j", "k", "Home", "End", "ArrowDown"]) {
      expect(takesListKey(byId("a"), key), key).toBe(true);
    }
    // The launcher's other letters, and every key off a row, stay the page's.
    expect(takesListKey(byId("a"), "b")).toBe(false);
    expect(takesListKey(byId("pill"), "g")).toBe(false);
  });

  it("covers the legacy sidebar's thread rows too", () => {
    using _cleanup = cleanup();
    document.body.innerHTML =
      '<div data-app-sidebar><div role="button" tabindex="0" data-testid="thread-row-t1"></div></div>';
    expect(isListRow(document.querySelector("[data-testid='thread-row-t1']")!)).toBe(true);
  });
});

const RAIL = `
  <nav data-app-rail>
    <button data-sidebar="menu-button" data-slot="tooltip-trigger" id="threads">Threads</button>
    <button data-sidebar="menu-button" data-slot="tooltip-trigger" id="wikis" aria-current="page">Wikis</button>
    <button data-sidebar="menu-button" data-slot="tooltip-trigger" id="prs">Pull Requests</button>
    <button data-sidebar="menu-button" data-slot="tooltip-trigger" id="usage">Usage</button>
    <button data-sidebar="menu-button" data-slot="tooltip-trigger" id="settings">Settings</button>
  </nav>`;

describe("the icon rail's buttons, a list", () => {
  it("lands on the current section's button, then on the one last focused", () => {
    using _cleanup = cleanup();
    document.body.innerHTML = RAIL;
    const rail = document.querySelector("[data-app-rail]")!;
    expect(listDefaultRow(rail)?.id).toBe("wikis");
    press(byId("wikis"), "j");
    expect(document.activeElement?.id).toBe("prs");
    expect(listDefaultRow(rail)?.id).toBe("prs");
    // A place with no list has no row to land on.
    expect(listDefaultRow(document.body)).toBeNull();
  });

  it("steps with j/k and the arrows, jumps with gg/G and Home/End, and stops at the ends", () => {
    using _cleanup = cleanup();
    document.body.innerHTML = RAIL;
    byId("threads").focus();
    press(byId("threads"), "ArrowDown");
    press(document.activeElement as HTMLElement, "j");
    expect(document.activeElement?.id).toBe("prs");
    press(byId("prs"), "k");
    expect(document.activeElement?.id).toBe("wikis");
    press(byId("wikis"), "End");
    expect(document.activeElement?.id).toBe("settings");
    press(byId("settings"), "j");
    expect(document.activeElement?.id).toBe("settings");
    press(byId("settings"), "g");
    press(byId("settings"), "g");
    expect(document.activeElement?.id).toBe("threads");
    press(byId("threads"), "G");
    expect(document.activeElement?.id).toBe("settings");
    press(byId("settings"), "Home");
    expect(document.activeElement?.id).toBe("threads");
  });

  it("is one tab stop, the button last focused", () => {
    using _cleanup = cleanup();
    document.body.innerHTML = RAIL;
    press(byId("threads"), "j");
    const stops = [...document.querySelectorAll("button")].filter(
      (button) => button.tabIndex === 0,
    );
    expect(stops.map((button) => button.id)).toEqual(["wikis"]);
  });

  it("opens a section on Enter, hands Escape on, and leaves `/` to the page", () => {
    using _cleanup = cleanup();
    document.body.innerHTML = RAIL;
    const opened: string[] = [];
    byId("usage").addEventListener("click", () => void opened.push("usage"));
    expect(press(byId("usage"), "Enter").taken).toBe(true);
    expect(opened).toEqual(["usage"]);
    expect(press(byId("usage"), "Escape").escaped.map((row) => row.id)).toEqual(["usage"]);
    expect(press(byId("usage"), "/").taken).toBe(false);
    // Chords stay the app's: Ctrl+L moves to the place on the right.
    const chord = new KeyboardEvent("keydown", { key: "l", ctrlKey: true, cancelable: true });
    expect(handleListKey(chord, { onEscape: () => {} })).toBe(false);
  });
});

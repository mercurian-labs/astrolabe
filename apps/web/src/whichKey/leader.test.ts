// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vite-plus/test";

import { isLeaderKey, menuKeyOf, takesTyping } from "./leader";
import { CHORD, CURSOR_DOWN, CURSOR_UP } from "./menu";

afterEach(() => document.body.replaceChildren());

const space = (modifiers: Partial<KeyboardEvent> = {}) =>
  ({
    key: " ",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...modifiers,
  }) as KeyboardEvent;

const on = { leaderKey: " " };

function element(html: string) {
  document.body.innerHTML = html;
  return (
    document.body.firstElementChild?.querySelector("[data-target]") ??
    document.body.firstElementChild
  );
}

describe("Space as the leader key", () => {
  it("leads from the page and from what takes no keys of its own", () => {
    expect(isLeaderKey(space(), document.body, on)).toBe(true);
    expect(isLeaderKey(space(), element("<div><p data-target>text</p></div>"), on)).toBe(true);
    expect(isLeaderKey(space(), element('<div tabindex="-1">pane</div>'), on)).toBe(true);
  });

  it("stays with text fields, editors, and controls, which Space types into or presses", () => {
    for (const html of [
      "<input />",
      "<textarea></textarea>",
      '<div contenteditable="true"><span data-target>x</span></div>',
      "<button>Go</button>",
      '<a href="/x">Link</a>',
      '<div role="tab">Tab</div>',
      '<div role="option"><span data-target>row</span></div>',
      '<div tabindex="0">scroll region</div>',
    ]) {
      expect(isLeaderKey(space(), element(html), on), html).toBe(false);
    }
  });

  it("is off with the setting, in a dialog, with a modifier, or held", () => {
    expect(isLeaderKey(space(), document.body, { leaderKey: null })).toBe(false);
    const dialog = element('<div role="dialog"><div tabindex="-1" data-target>body</div></div>');
    expect(isLeaderKey(space(), dialog, on)).toBe(false);
    expect(isLeaderKey(space({ shiftKey: true }), document.body, on)).toBe(false);
    expect(isLeaderKey(space({ ctrlKey: true }), document.body, on)).toBe(false);
    expect(isLeaderKey(space({ repeat: true }), document.body, on)).toBe(false);
    expect(isLeaderKey(space({ key: "a" }), document.body, on)).toBe(false);
  });
});

describe("where focus takes typing, which ends the repeat window", () => {
  it("is a text field, an editor, or a terminal", () => {
    for (const html of [
      "<input />",
      "<textarea></textarea>",
      '<div class="cm-editor"><div class="cm-content" contenteditable="true" data-target></div></div>',
      '<div data-terminal-owner="right-panel"><canvas data-target></canvas></div>',
    ]) {
      expect(takesTyping(element(html)), html).toBe(true);
    }
  });

  it("is not a sidebar row, a pane's tab, a rail button, or the page", () => {
    for (const html of [
      '<div role="button" tabindex="0" data-testid="sidebar-row-card">row</div>',
      '<div role="tab" tabindex="0" data-pane-tab>tab</div>',
      '<nav data-app-rail><button data-target aria-current="page">Threads</button></nav>',
    ]) {
      expect(takesTyping(element(html)), html).toBe(false);
    }
    expect(takesTyping(document.body)).toBe(false);
    expect(takesTyping(null)).toBe(false);
  });
});

describe("another leader key", () => {
  it("leads with the key it names, shifted or not, and never with none", () => {
    const comma = { leaderKey: "," };
    expect(isLeaderKey(space({ key: "," }), document.body, comma)).toBe(true);
    expect(
      isLeaderKey(space({ key: "<", shiftKey: true }), document.body, { leaderKey: "<" }),
    ).toBe(true);
    expect(isLeaderKey(space(), document.body, comma)).toBe(false);
    expect(isLeaderKey(space({ key: "," }), element("<input />"), comma)).toBe(false);
    expect(isLeaderKey(space({ key: "," }), document.body, { leaderKey: null })).toBe(false);
  });
});

describe("the keys the open menu reads", () => {
  it("reads plain keys, the chord, and nothing for a modifier alone or a held key", () => {
    const mac = { mac: true };
    expect(menuKeyOf(space({ key: "g" }), false, mac)).toBe("g");
    expect(menuKeyOf(space({ key: ":", shiftKey: true }), false, mac)).toBe(":");
    expect(menuKeyOf(space({ key: "k", metaKey: true }), true, mac)).toBe(CHORD);
    // Any other chord reaches no row.
    expect(menuKeyOf(space({ key: "g", ctrlKey: true }), false, mac)).toBe("");
    expect(menuKeyOf(space({ key: "Shift", shiftKey: true }), false, mac)).toBeNull();
    expect(menuKeyOf(space({ key: "g", repeat: true }), false, mac)).toBeNull();
    // A held arrow keeps stepping.
    expect(menuKeyOf(space({ key: "ArrowDown", repeat: true }), false, mac)).toBe("ArrowDown");
  });

  it("steps the cursor on Ctrl+N and Ctrl+P on a Mac only", () => {
    // The cursor's own keys, not the arrows, which the root binds to focus moves.
    expect(menuKeyOf(space({ key: "n", ctrlKey: true }), false, { mac: true })).toBe(CURSOR_DOWN);
    expect(menuKeyOf(space({ key: "p", ctrlKey: true }), false, { mac: true })).toBe(CURSOR_UP);
    // Elsewhere Ctrl+N and Ctrl+P are the app's shortcuts, which reach no row here.
    expect(menuKeyOf(space({ key: "n", ctrlKey: true }), false, { mac: false })).toBe("");
    expect(
      menuKeyOf(space({ key: "n", ctrlKey: true, shiftKey: true }), false, { mac: true }),
    ).toBe("");
  });
});

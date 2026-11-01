import { describe, expect, it } from "vite-plus/test";

import {
  activateTab,
  closeTab,
  focusPane,
  openBeside,
  openTab,
  startingArrangement,
  type Arrangement,
} from "./arrangement";
import {
  hiddenLinkedTabs,
  linkedArrangement,
  linkedToggle,
  linkTab,
  openLinked,
  settleLinks,
  unlinkTab,
  type LinkContext,
  type LinkedArrangement,
} from "./linkedTabs";
import { followRecord, type PanelRecord } from "./surfaceMirror";
import { leaves } from "./tree";

const chatA = "chat:e:a";
const chatB = "chat:e:b";
const group = "change-group:e:g";
const terminalA = "chat-surface:e:a:terminal:1";
const diffA = "chat-surface:e:a:diff";
const filesB = "chat-surface:e:b:files";
const file = "repository:file";

const closedPanels = new Set<string>();
const context: LinkContext = {
  isOwner: (key) => key.startsWith("chat:"),
  shows: (owner, front) => owner === front || (owner === group && front === chatA),
  open: (front) => !closedPanels.has(front),
  // B's thread has its Files surface, which no pane holds until B first comes to the front.
  arriving: (front) => (front === chatB ? [filesB] : []),
};

function panes(state: LinkedArrangement) {
  return leaves(state.arrangement.root).map((leaf) => leaf.tabs);
}

function settle(state: LinkedArrangement) {
  return settleLinks(state, context);
}

function change(state: LinkedArrangement, update: (arrangement: Arrangement) => Arrangement) {
  return settle({ ...state, arrangement: update(state.arrangement) });
}

/** Chats A and B in one pane, A in front, with A's terminal and diff linked in a pane beside. */
function withPanel(): LinkedArrangement {
  const chats = openTab(openTab(startingArrangement(), chatB), chatA);
  let state = settle(linkedArrangement(chats));
  state = openLinked(state, terminalA);
  state = settle(openLinked(state, diffA));
  return state;
}

describe("a chat's linked tabs", () => {
  it("open in a pane beside the chat in front, keeping the focus on the chat", () => {
    const state = withPanel();
    expect(state.front).toBe(chatA);
    expect(panes(state)).toEqual([
      [chatB, chatA],
      [terminalA, diffA],
    ]);
    expect(state.arrangement.focused).toBe("p0");
  });

  it("make way for the next chat's in the same pane, and come back when it does", () => {
    // B's files were never placed: they come in where A's tabs stood.
    let state = change(withPanel(), (arrangement) => activateTab(arrangement, chatB));
    expect(state.front).toBe(chatB);
    expect(panes(state)).toEqual([[chatB, chatA], [filesB]]);
    state = change(state, (arrangement) => activateTab(arrangement, chatA));
    expect(panes(state)).toEqual([
      [chatB, chatA],
      [terminalA, diffA],
    ]);
    expect(leaves(state.arrangement.root)[1]?.active).toBe(diffA);
  });

  it("set aside with nothing in their place close their pane, and reopen it beside the chat", () => {
    const solo = settle(
      openLinked(settle(linkedArrangement(openTab(startingArrangement(), chatA))), diffA),
    );
    let state = change(solo, (arrangement) => openTab(arrangement, file, "p0"));
    expect(panes(state)).toEqual([[chatA, file]]);
    expect(Object.keys(state.parked)).toEqual([diffA]);
    state = change(state, (arrangement) => activateTab(arrangement, chatA));
    expect(panes(state)).toEqual([[chatA, file], [diffA]]);
  });

  it("follow the chat focused most recently when two chats are in front", () => {
    let state = withPanel();
    // B beside A, its own pane focused.
    state = change(state, (arrangement) => openBeside(arrangement, chatB, "p0", "left"));
    expect(state.front).toBe(chatB);
    expect(panes(state)).toEqual([[chatB], [chatA], [filesB]]);
    // A file's pane focused leaves B in front.
    state = change(state, (arrangement) => openBeside(arrangement, file, "p0", "bottom"));
    expect(state.front).toBe(chatB);
    state = change(state, (arrangement) => focusPane(arrangement, "p0"));
    expect(state.front).toBe(chatA);
    // Back in the pane they stood in, where B's files stood meanwhile.
    expect(panes(state)).toEqual([[chatB], [chatA], [file], [terminalA, diffA]]);
  });

  it("close with their chat, set aside or not", () => {
    let state = change(withPanel(), (arrangement) => activateTab(arrangement, chatB));
    state = change(state, (arrangement) => closeTab(arrangement, chatA));
    expect(state.parked).toEqual({});
    expect(state.owners).toEqual({ [filesB]: chatB });
    expect(panes(state)).toEqual([[chatB], [filesB]]);
  });

  it("hide while the chat's panel is closed, and come back as it opens", () => {
    closedPanels.add(chatA);
    try {
      const state = settle(withPanel());
      expect(panes(state)).toEqual([[chatB, chatA]]);
    } finally {
      closedPanels.delete(chatA);
    }
    const reopened = settle(settle(withPanel()));
    expect(panes(reopened)).toEqual([
      [chatB, chatA],
      [terminalA, diffA],
    ]);
  });

  it("stay put once unlinked, whichever chat comes to the front", () => {
    let state = unlinkTab(withPanel(), diffA);
    state = change(state, (arrangement) => activateTab(arrangement, chatB));
    expect(panes(state)).toEqual([[chatB, chatA], [filesB], [diffA]]);
  });

  it("show for every thread of a change group they are linked to, and no other", () => {
    const changeRequest = "wiki-change:e:w:cr1";
    let state = change(withPanel(), (arrangement) => openTab(arrangement, changeRequest, "p1"));
    state = settle(linkTab(state, changeRequest, group));
    state = change(state, (arrangement) => activateTab(arrangement, chatB));
    expect(panes(state)).toEqual([[chatB, chatA], [filesB]]);
    state = change(state, (arrangement) => activateTab(arrangement, chatA));
    expect(panes(state)).toEqual([
      [chatB, chatA],
      [terminalA, diffA, changeRequest],
    ]);
  });
});

/** Runs `body` with these chats' panels closed. */
function withClosed<T>(chats: readonly string[], body: () => T): T {
  for (const chat of chats) closedPanels.add(chat);
  try {
    return body();
  } finally {
    for (const chat of chats) closedPanels.delete(chat);
  }
}

describe("hiding a chat's linked tabs", () => {
  it("closes an empty tab rather than set it aside, so nothing comes back for it", () => {
    const empty = "empty/7";
    const solo = settle(
      openLinked(settle(linkedArrangement(openTab(startingArrangement(), chatA))), empty),
    );
    expect(panes(solo)).toEqual([[chatA], [empty]]);
    const hidden = withClosed([chatA], () => settle(solo));
    expect(panes(hidden)).toEqual([[chatA]]);
    expect(hidden.parked).toEqual({});
    expect(hidden.owners).toEqual({});
    expect(withClosed([chatA], () => linkedToggle(hidden, chatA, context))).toEqual({
      kind: "none",
    });
  });

  it("sets aside an empty tab whose chat only went behind another, as any other", () => {
    const empty = "empty/7";
    let state = settle(openLinked(withPanel(), empty));
    state = change(state, (arrangement) => activateTab(arrangement, chatB));
    expect(Object.keys(state.parked)).toContain(empty);
  });
});

describe("a chat's linked-tabs toggle", () => {
  it("hides while the chat's panel is open, whether its tabs are on screen or not", () => {
    const state = withPanel();
    expect(linkedToggle(state, chatA, context)).toEqual({ kind: "showing" });
    expect(linkedToggle(state, chatB, context)).toEqual({ kind: "showing" });
  });

  it("lists the tabs set aside with the chat's panel, in the order they stood", () => {
    const state = withClosed([chatA], () => settle(withPanel()));
    expect(withClosed([chatA], () => linkedToggle(state, chatA, context))).toEqual({
      kind: "hidden",
      tabs: [terminalA, diffA],
    });
  });

  it("counts only the chat's own hidden tabs and its group's, not another chat's", () => {
    const changeRequest = "wiki-change:e:w:cr1";
    let state = change(withPanel(), (arrangement) => openTab(arrangement, changeRequest, "p1"));
    state = settle(linkTab(state, changeRequest, group));
    state = withClosed([chatA, chatB], () => settle(state));
    withClosed([chatA, chatB], () => {
      expect(hiddenLinkedTabs(state, chatA, context)).toEqual([terminalA, diffA, changeRequest]);
      // B's Files surface is in its thread's record, though no pane has held it yet.
      expect(hiddenLinkedTabs(state, chatB, context)).toEqual([filesB]);
    });
  });

  it("offers a new tab with nothing set aside", () => {
    const state = settle(linkedArrangement(openTab(startingArrangement(), chatA)));
    expect(withClosed([chatA], () => linkedToggle(state, chatA, context))).toEqual({
      kind: "none",
    });
  });

  it("no longer lists a tab closed for good, nor brings it back", () => {
    let state = change(withPanel(), (arrangement) => closeTab(arrangement, diffA));
    state = withClosed([chatA], () => settle(state));
    expect(withClosed([chatA], () => hiddenLinkedTabs(state, chatA, context))).toEqual([terminalA]);
    expect(panes(settle(state))).toEqual([[chatB, chatA], [terminalA]]);
  });
});

describe("a chat's surfaces from its right-panel record", () => {
  const keys = (chat: string, splitFrom: string | null) => ({
    key: (id: string) => `chat-surface:${chat.slice("chat:".length)}:${id}`,
    id: (key: string) =>
      key.startsWith(`chat-surface:${chat.slice("chat:".length)}:`)
        ? key.slice(`chat-surface:${chat.slice("chat:".length)}:`.length)
        : null,
    splitFrom,
  });
  const record = (active: string, ids: string[]): PanelRecord => ({
    isOpen: true,
    activeSurfaceId: active,
    surfaceIds: ids,
  });

  it("open the first in a new pane beside the chat, and the next beside it", () => {
    const chats = openTab(startingArrangement(), chatA);
    const first = followRecord(chats, null, record("diff", ["diff"]), null, keys(chatA, "p0"));
    const second = followRecord(
      first.arrangement,
      record("diff", ["diff"]),
      record("terminal:1", ["diff", "terminal:1"]),
      null,
      keys(chatA, "p0"),
    );
    expect(leaves(second.arrangement.root).map((leaf) => leaf.tabs)).toEqual([
      [chatA],
      [diffA, terminalA],
    ]);
    expect(second.arrangement.focused).toBe("p0");
  });
});

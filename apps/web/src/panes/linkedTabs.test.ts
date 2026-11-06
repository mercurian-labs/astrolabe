import { describe, expect, it } from "vite-plus/test";

import {
  activateTab,
  closeTab,
  focusPane,
  moveTabs,
  openBeside,
  openTab,
  resizePanes,
  startingArrangement,
  type Arrangement,
} from "./arrangement";
import {
  hideLinkedTab,
  keptFromPane,
  linkedArrangement,
  linkedTabsOf,
  linkTab,
  openLinked,
  settleLinks,
  unlinkTab,
  type LinkContext,
  type LinkedArrangement,
  showLinkedTabs,
} from "./linkedTabs";
import { followRecord, type PanelRecord } from "./surfaceMirror";
import { leaves, type Branch } from "./tree";

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

  it("leave their chat's pane for a new one beside it, the chat showing in their place", () => {
    const solo = settle(
      openLinked(settle(linkedArrangement(openTab(startingArrangement(), chatA))), diffA),
    );
    const state = change(solo, (arrangement) => focusPane(openTab(arrangement, diffA, "p0"), "p0"));
    expect(panes(state)).toEqual([[chatA], [diffA]]);
    expect(leaves(state.arrangement.root)[0]?.active).toBe(chatA);
    expect(state.front).toBe(chatA);
    expect(state.parked).toEqual({});
  });

  it("join the chat's other linked tabs when one lands in the chat's pane", () => {
    const state = change(withPanel(), (arrangement) => moveTabs(arrangement, [terminalA], "p0"));
    expect(panes(state)).toEqual([
      [chatB, chatA],
      [diffA, terminalA],
    ]);
    expect(leaves(state.arrangement.root)[0]?.active).toBe(chatA);
    expect(state.front).toBe(chatA);
  });

  it("step out beside a chat dragged into their pane", () => {
    const start = withPanel();
    const linkedPane = leaves(start.arrangement.root)[1]?.id ?? "";
    const state = change(start, (arrangement) => moveTabs(arrangement, [chatA], linkedPane));
    expect(panes(state)).toEqual([[chatB], [chatA], [terminalA, diffA]]);
    expect(state.front).toBe(chatA);
  });

  it("come back beside a chat that took the pane they were set aside from", () => {
    const state = settle({
      ...linkedArrangement(openTab(startingArrangement(), chatA)),
      owners: { [diffA]: chatA },
      parked: { [diffA]: { pane: "p0", index: 1, active: true } },
    });
    expect(panes(state)).toEqual([[chatA], [diffA]]);
    expect(state.parked).toEqual({});
  });

  it("are the only ones kept out of their owner's pane: a change group's stay", () => {
    const beside = openBeside(
      openTab(openTab(startingArrangement(), group), file),
      chatA,
      "p0",
      "right",
      { focus: true },
    );
    const state = settle(linkTab(linkedArrangement(beside), file, group));
    expect(panes(state)).toEqual([[group, file], [chatA]]);
  });

  it("keep a drag of only linked tabs off their chat's own pane, and no one else's", () => {
    const { owners } = withPanel();
    const chats = [chatB, chatA];
    expect(keptFromPane(owners, [terminalA, diffA], chats, context.isOwner)).toBe(true);
    expect(keptFromPane(owners, [terminalA, file], chats, context.isOwner)).toBe(false);
    expect(keptFromPane(owners, [terminalA], [chatB], context.isOwner)).toBe(false);
    expect(keptFromPane({ [file]: group }, [file], [group], context.isOwner)).toBe(false);
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
    expect(withClosed([chatA], () => linkedTabsOf(hidden, chatA, context))).toEqual([]);
  });

  it("sets aside an empty tab whose chat only went behind another, as any other", () => {
    const empty = "empty/7";
    let state = settle(openLinked(withPanel(), empty));
    state = change(state, (arrangement) => activateTab(arrangement, chatB));
    expect(Object.keys(state.parked)).toContain(empty);
  });
});

describe("showing and hiding a chat's linked tabs", () => {
  it("gives the room their pane took back to the chat, every other pane as it was", () => {
    const other = "repository:other";
    let arrangement = openTab(startingArrangement(), chatA);
    arrangement = openBeside(arrangement, file, "p0", "left");
    arrangement = openBeside(arrangement, other, "p0", "right");
    arrangement = focusPane(resizePanes(arrangement, arrangement.root.id, [1, 3, 2]), "p0");
    const shown = settle(openLinked(settle(linkedArrangement(arrangement)), diffA));
    expect(panes(shown)).toEqual([[file], [chatA], [diffA], [other]]);
    const shownWeights = (shown.arrangement.root as Branch).weights;
    expect(shownWeights[2]).toBeCloseTo(3 * 0.45);

    const hidden = withClosed([chatA], () => settle(shown));
    expect(panes(hidden)).toEqual([[file], [chatA], [other]]);
    const [fileWeight, chatWeight, otherWeight] = (hidden.arrangement.root as Branch).weights;
    expect(fileWeight).toBe(1);
    expect(otherWeight).toBe(2);
    expect(chatWeight).toBeCloseTo(3);

    // Shown again, the pane opens beside the chat at the same share.
    const again = settle(hidden);
    expect(panes(again)).toEqual([[file], [chatA], [diffA], [other]]);
    const againWeights = (again.arrangement.root as Branch).weights;
    shownWeights.forEach((weight, index) => expect(againWeights[index]).toBeCloseTo(weight));
  });
});

describe("a chat's linked tabs", () => {
  const keysOf = (tabs: readonly { readonly key: string }[]) => tabs.map((tab) => tab.key);

  it("all show while the chat's panel is open, whether on screen or not", () => {
    const state = withPanel();
    expect(linkedTabsOf(state, chatA, context).every((tab) => tab.shown)).toBe(true);
    expect(linkedTabsOf(state, chatB, context).every((tab) => tab.shown)).toBe(true);
  });

  it("are listed as they stood, none showing, with the chat's panel closed", () => {
    const state = withClosed([chatA], () => settle(withPanel()));
    expect(withClosed([chatA], () => linkedTabsOf(state, chatA, context))).toEqual([
      { key: terminalA, shown: false },
      { key: diffA, shown: false },
    ]);
  });

  it("count the chat's own and its group's, not another chat's", () => {
    const changeRequest = "wiki-change:e:w:cr1";
    let state = change(withPanel(), (arrangement) => openTab(arrangement, changeRequest, "p1"));
    state = settle(linkTab(state, changeRequest, group));
    state = withClosed([chatA, chatB], () => settle(state));
    withClosed([chatA, chatB], () => {
      expect(keysOf(linkedTabsOf(state, chatA, context))).toEqual([
        terminalA,
        diffA,
        changeRequest,
      ]);
      // B's Files surface is in its thread's record, though no pane has held it yet.
      expect(keysOf(linkedTabsOf(state, chatB, context))).toEqual([filesB]);
    });
  });

  it("are none with nothing linked", () => {
    const state = settle(linkedArrangement(openTab(startingArrangement(), chatA)));
    expect(withClosed([chatA], () => linkedTabsOf(state, chatA, context))).toEqual([]);
  });

  it("no longer list a tab closed for good, nor bring it back", () => {
    let state = change(withPanel(), (arrangement) => closeTab(arrangement, diffA));
    state = withClosed([chatA], () => settle(state));
    expect(withClosed([chatA], () => keysOf(linkedTabsOf(state, chatA, context)))).toEqual([
      terminalA,
    ]);
    expect(panes(settle(state))).toEqual([[chatB, chatA], [terminalA]]);
  });

  it("can hide one, which stays aside while the rest show and returns where it stood", () => {
    const state = settle(hideLinkedTab(withPanel(), terminalA, chatA));
    expect(panes(state)).toEqual([[chatB, chatA], [diffA]]);
    expect(linkedTabsOf(state, chatA, context)).toEqual([
      { key: terminalA, shown: false },
      { key: diffA, shown: true },
    ]);

    // Going behind another chat and back leaves it hidden.
    const behind = change(state, (arrangement) => activateTab(arrangement, chatB));
    const back = change(behind, (arrangement) => activateTab(arrangement, chatA));
    expect(panes(back)).toEqual([[chatB, chatA], [diffA]]);

    expect(panes(settle(showLinkedTabs(back, [terminalA])))).toEqual([
      [chatB, chatA],
      [terminalA, diffA],
    ]);
  });

  it("keep their order when hidden one by one from the left, listed and returning", () => {
    const third = "chat-surface:e:a:files";
    const three = settle(openLinked(withPanel(), third));
    expect(panes(three)).toEqual([
      [chatB, chatA],
      [terminalA, diffA, third],
    ]);
    const state = settle(
      hideLinkedTab(settle(hideLinkedTab(three, terminalA, chatA)), diffA, chatA),
    );
    expect(keysOf(linkedTabsOf(state, chatA, context))).toEqual([terminalA, diffA, third]);
    expect(panes(settle(showLinkedTabs(state, [diffA, terminalA])))).toEqual([
      [chatB, chatA],
      [terminalA, diffA, third],
    ]);
  });

  it("stop being aside when opened again by name", () => {
    const hidden = settle(hideLinkedTab(withPanel(), terminalA, chatA));
    const opened = change(hidden, (arrangement) => openTab(arrangement, terminalA, "p1"));
    expect(opened.parked[terminalA]).toBeUndefined();
    expect(opened.owners[terminalA]).toBe(chatA);
  });
});

describe("a new linked tab", () => {
  const empty = "empty/7";

  it("opens in front beside the chat's tabs showing, the focus staying on the chat", () => {
    const state = settle(openLinked(withPanel(), empty));
    expect(panes(state)).toEqual([
      [chatB, chatA],
      [terminalA, diffA, empty],
    ]);
    expect(leaves(state.arrangement.root)[1]?.active).toBe(empty);
    expect(state.arrangement.focused).toBe("p0");
  });

  it("opens in front among the chat's hidden tabs once they are back where they stood", () => {
    const hidden = withClosed([chatA], () => settle(withPanel()));
    expect(panes(hidden)).toEqual([[chatB, chatA]]);
    const back = settle(hidden);
    expect(panes(back)).toEqual([
      [chatB, chatA],
      [terminalA, diffA],
    ]);
    expect(leaves(back.arrangement.root)[1]?.active).toBe(diffA);
    const state = settle(openLinked(back, empty));
    expect(panes(state)).toEqual([
      [chatB, chatA],
      [terminalA, diffA, empty],
    ]);
    expect(leaves(state.arrangement.root)[1]?.active).toBe(empty);
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

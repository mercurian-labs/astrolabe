import { describe, expect, it } from "vite-plus/test";

import {
  activateTab,
  allTabs,
  closeTab,
  focusPane,
  moveTabs,
  openBeside,
  openTab,
  resizePanes,
  splitTab,
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
import { leafWithTab, leaves, type Branch, type SplitNode } from "./tree";

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
    // B's files join the pane beside the chats rather than divide them again.
    expect(panes(state)).toEqual([
      [chatB, chatA],
      [diffA, filesB],
    ]);
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
    // Chats either side, so neither neighbour takes the linked tab and the chat's pane divides.
    const file = "chat:e:c";
    const other = "chat:e:d";
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

describe("tabs arriving together", () => {
  it("keep their order, wherever a pane adds a tab", () => {
    const surfaces = ["diff", "files", "terminal:1", "terminal:2"].map(
      (id) => `chat-surface:e:a:${id}`,
    );
    const afterCurrent: LinkContext = {
      ...context,
      arriving: (front) => (front === chatA ? surfaces : []),
      newTabIndex: (pane) => pane.tabs.indexOf(pane.active) + 1,
    };
    const state = settleLinks(
      linkedArrangement(openTab(startingArrangement(), chatA)),
      afterCurrent,
    );
    expect(panes(state)).toEqual([[chatA], surfaces]);
  });
});

describe("a chat's terminal, which stands alone", () => {
  const terminal = "chat-terminal:e:a";
  const terminalB = "chat-terminal:e:b";
  const alone = (key: string) => key.startsWith("chat-terminal:");
  const asked = { below: true, sideTabs: false };
  const placing: LinkContext = {
    ...context,
    arriving: () => [],
    standsAlone: alone,
    joinsOwner: (key) => (alone(key) ? !asked.below : asked.sideTabs),
  };
  const settled = (state: LinkedArrangement) => settleLinks(state, placing);
  const opened = (state: LinkedArrangement, key: string, owner = state.front ?? chatA) =>
    settled({
      ...state,
      owners: { ...state.owners, [key]: owner },
      parked: { ...state.parked, [key]: { pane: "", index: 1e15, active: true } },
    });
  const hidden = (state: LinkedArrangement) =>
    settled(hideLinkedTab(state, terminal, chatA, alone));
  const shownAgain = (state: LinkedArrangement) => settled(showLinkedTabs(state, [terminal]));
  const alonePlain = () =>
    settled(linkedArrangement(openTab(openTab(startingArrangement(), chatB), chatA)));

  function reset() {
    asked.below = true;
    asked.sideTabs = false;
  }

  it("splits the chat's whole pane down, with every tab of it staying above", () => {
    reset();
    const state = opened(alonePlain(), terminal);
    expect(panes(state)).toEqual([[chatB, chatA], [terminal]]);
    const root = state.arrangement.root as Branch;
    expect(root.direction).toBe("column");
    expect(root.weights[1]).toBeLessThan(root.weights[0] ?? 0);
  });

  it("joins a pane already below the chat's rather than split again", () => {
    reset();
    const start = alonePlain();
    const stacked = settled({
      ...start,
      arrangement: openBeside(start.arrangement, file, "p0", "bottom", { focus: false }),
    });
    const state = opened(stacked, terminal);
    expect(panes(state)).toEqual([
      [chatB, chatA],
      [file, terminal],
    ]);
    expect(leaves(state.arrangement.root)[1]?.active).toBe(terminal);
  });

  it("shows without the chat's panel, and the panel's closing leaves it", () => {
    reset();
    closedPanels.add(chatA);
    const state = opened(alonePlain(), terminal);
    expect(panes(state)).toEqual([[chatB, chatA], [terminal]]);
    closedPanels.delete(chatA);
  });

  it("anchors none of the chat's side tabs: they still open beside the chat", () => {
    reset();
    const state = settled(openLinked(opened(alonePlain(), terminal), diffA, { context: placing }));
    expect(panes(state)).toEqual([[chatB, chatA], [diffA], [terminal]]);
    const root = state.arrangement.root as Branch;
    expect(root.direction).toBe("column");
  });

  it("comes back where it stood, at the size it was left, once hidden", () => {
    reset();
    const start = opened(alonePlain(), terminal);
    const root = start.arrangement.root as Branch;
    const sized = settled({
      ...start,
      arrangement: resizePanes(start.arrangement, root.id, [3, 1]),
    });
    const away = hidden(sized);
    expect(panes(away)).toEqual([[chatB, chatA]]);
    const back = shownAgain(away);
    expect(panes(back)).toEqual([[chatB, chatA], [terminal]]);
    const [above = 0, below = 0] = (back.arrangement.root as Branch).weights;
    expect(below / (above + below)).toBeCloseTo(0.25);
  });

  it("comes back spanning what it spanned, a side tab opened in the meantime", () => {
    reset();
    const start = settled(openLinked(opened(alonePlain(), terminal), diffA, { context: placing }));
    const spans = (state: LinkedArrangement) => {
      const root = state.arrangement.root as Branch;
      expect(root.direction).toBe("column");
      const top = root.children[0] as Branch;
      expect(top.direction).toBe("row");
      expect(leaves(top).map((leaf) => leaf.tabs)).toEqual([[chatB, chatA], [diffA]]);
      expect(root.children[1]).toMatchObject({ type: "leaf", tabs: [terminal] });
    };
    spans(start);
    spans(shownAgain(hidden(start)));
  });

  it("comes back along what is left of what it spanned", () => {
    reset();
    const start = settled(openLinked(opened(alonePlain(), terminal), diffA, { context: placing }));
    const away = hidden(start);
    const without = settled({
      ...unlinkTab(away, diffA),
      arrangement: closeTab(away.arrangement, diffA),
    });
    expect(panes(shownAgain(without))).toEqual([[chatB, chatA], [terminal]]);
    expect((shownAgain(without).arrangement.root as Branch).direction).toBe("column");
  });

  it("waits aside for its closed chat, where the tabs of others go with it", () => {
    reset();
    const state = opened(alonePlain(), terminal);
    const closed = settled({
      ...state,
      arrangement: closeTab(state.arrangement, chatA),
    });
    expect(panes(closed)).toEqual([[chatB]]);
    expect(closed.parked[terminal]).toBeDefined();
    expect(closed.owners[terminal]).toBe(chatA);
  });

  it("stays in its chat's pane until the settings are read", () => {
    reset();
    asked.below = false;
    const state = opened(alonePlain(), terminal);
    asked.below = true;
    const unknown = { ...placing, placementUnknown: () => true };
    expect(panes(settleLinks(state, unknown))).toEqual([[chatB, chatA, terminal]]);
    const onB = settleLinks(
      { ...state, arrangement: activateTab(state.arrangement, chatB) },
      unknown,
    );
    // Nothing is placed before they are read: it waits aside, for where they say it goes.
    const back = settleLinks({ ...onB, arrangement: activateTab(onB.arrangement, chatA) }, unknown);
    expect(panes(back)).toEqual([[chatB, chatA]]);
    asked.below = false;
    expect(panes(settled(back))).toEqual([[chatB, chatA, terminal]]);
  });

  it("comes back beside the chat when dragged there, not below it", () => {
    reset();
    const start = alonePlain();
    const beside = settled({
      ...opened(start, terminal),
      arrangement: openBeside(opened(start, terminal).arrangement, terminal, "p0", "right", {
        focus: false,
      }),
    });
    const back = shownAgain(hidden(beside));
    expect((back.arrangement.root as Branch).direction).toBe("row");
  });

  it("parks with its chat and comes back with it, the next chat's tabs clear of its pane", () => {
    reset();
    const start = opened(alonePlain(), terminal);
    const onB = settled({ ...start, arrangement: activateTab(start.arrangement, chatB) });
    expect(onB.parked[terminal]).toMatchObject({ pane: leaves(start.arrangement.root)[1]?.id });
    expect(panes(onB)).toEqual([[chatB, chatA]]);
    const back = settled({ ...onB, arrangement: activateTab(onB.arrangement, chatA) });
    expect(panes(back)).toEqual([[chatB, chatA], [terminal]]);
  });

  it("gives each chat its own in the same place", () => {
    reset();
    const a = opened(alonePlain(), terminal);
    const b = opened(
      settled({ ...a, arrangement: activateTab(a.arrangement, chatB) }),
      terminalB,
      chatB,
    );
    expect(panes(b)).toEqual([[chatB, chatA], [terminalB]]);
    const backA = settled({ ...b, arrangement: activateTab(b.arrangement, chatA) });
    expect(panes(backA)).toEqual([[chatB, chatA], [terminal]]);
  });

  it("lists as shown with the chat's panel closed, and hidden once set aside", () => {
    reset();
    closedPanels.add(chatA);
    const state = opened(alonePlain(), terminal);
    expect(linkedTabsOf(state, chatA, placing)).toEqual([{ key: terminal, shown: true }]);
    expect(linkedTabsOf(hidden(state), chatA, placing)).toEqual([{ key: terminal, shown: false }]);
    closedPanels.delete(chatA);
  });

  it("stands in the chat's own pane as a tab when the settings ask, the chat staying in front", () => {
    reset();
    asked.below = false;
    const state = opened(alonePlain(), terminal);
    expect(panes(state)).toEqual([[chatB, chatA, terminal]]);
    expect(leaves(state.arrangement.root)[0]?.active).toBe(terminal);
    expect(state.front).toBe(chatA);
    const elsewhere = settled({
      ...state,
      arrangement: openBeside(state.arrangement, file, "p0", "right"),
    });
    expect(elsewhere.front).toBe(chatA);
    expect(panes(elsewhere)).toEqual([[chatB, chatA, terminal], [file]]);
    expect(
      keptFromPane(state.owners, [terminal], [chatA], placing.isOwner, placing.joinsOwner),
    ).toBe(false);
  });

  it("leaves the chat's pane again once the settings stop asking", () => {
    reset();
    asked.below = false;
    const state = opened(alonePlain(), terminal);
    asked.below = true;
    expect(panes(settled(state))).toEqual([[chatB, chatA], [terminal]]);
  });

  it("lets side tabs share the chat's pane when the settings ask", () => {
    reset();
    asked.sideTabs = true;
    const state = settled(openLinked(alonePlain(), diffA, { context: placing }));
    expect(panes(state)).toEqual([[chatB, chatA, diffA]]);
    const onB = settled({ ...state, arrangement: activateTab(state.arrangement, chatB) });
    const back = settled({ ...onB, arrangement: activateTab(onB.arrangement, chatA) });
    expect(panes(back)).toEqual([[chatB, chatA, diffA]]);
  });
});

describe("linked tabs through any sequence of moves", () => {
  const chats = [chatA, chatB];
  const terminalOf = (chat: string) => chat.replace("chat:", "chat-terminal:");
  const alone = (key: string) => key.startsWith("chat-terminal:");
  const placing: LinkContext = { ...context, arriving: () => [], standsAlone: alone };
  const settled = (state: LinkedArrangement) => settleLinks(state, placing);
  const on = (state: LinkedArrangement, update: (arrangement: Arrangement) => Arrangement) =>
    settled({ ...state, arrangement: update(state.arrangement) });

  /** Mulberry32: the same sequences on every run. */
  function randomFrom(seed: number) {
    let value = seed;
    return (below: number) => {
      value = (value + 0x6d2b79f5) | 0;
      let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296) * below);
    };
  }

  interface Box {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  }

  /** Each pane's tabs and place in the unit square. */
  function boxesOf(node: SplitNode, box: Box): { tabs: readonly string[]; box: Box }[] {
    if (node.type === "leaf") return [{ tabs: node.tabs, box }];
    const total = node.weights.reduce((sum, weight) => sum + weight, 0);
    let start = 0;
    return node.children.flatMap((child, index) => {
      const end = start + (node.weights[index] ?? 1) / total;
      const lerp = (from: number, to: number, at: number) => from + (to - from) * at;
      const part =
        node.direction === "row"
          ? {
              ...box,
              left: lerp(box.left, box.right, start),
              right: lerp(box.left, box.right, end),
            }
          : {
              ...box,
              top: lerp(box.top, box.bottom, start),
              bottom: lerp(box.top, box.bottom, end),
            };
      start = end;
      return boxesOf(child, part);
    });
  }

  /** The branch `key`'s pane stands in, if any. */
  function branchAround(node: SplitNode, key: string): Branch | null {
    if (node.type === "leaf") return null;
    if (node.children.some((child) => child.type === "leaf" && child.tabs.includes(key))) {
      return node;
    }
    for (const child of node.children) {
      const found = branchAround(child, key);
      if (found) return found;
    }
    return null;
  }

  /** The tabs of each pane `key`'s pane runs along: across its edges inside its branch. */
  function panesAlong(root: SplitNode, key: string): (readonly string[])[] {
    const all = boxesOf(root, { left: 0, right: 1, top: 0, bottom: 1 });
    const own = all.find((pane) => pane.tabs.includes(key))?.box;
    const branch = branchAround(root, key);
    if (!own || !branch) return [];
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const overlap = (a0: number, a1: number, b0: number, b1: number) =>
      Math.min(a1, b1) - Math.max(a0, b0) > 1e-9;
    return all
      .filter(({ tabs, box }) => {
        if (tabs.includes(key)) return false;
        return branch.direction === "column"
          ? (near(box.bottom, own.top) || near(box.top, own.bottom)) &&
              overlap(box.left, box.right, own.left, own.right)
          : (near(box.right, own.left) || near(box.left, own.right)) &&
              overlap(box.top, box.bottom, own.top, own.bottom);
      })
      .map(({ tabs }) => tabs);
  }

  /** What `key` stands by: the panes it runs along and the branch it stands in. */
  const standingBy = (root: SplitNode, key: string) => [
    ...panesAlong(root, key).flat(),
    ...(branchAround(root, key) ? leaves(branchAround(root, key) as Branch) : []).flatMap(
      (leaf) => leaf.tabs,
    ),
  ];

  /** Every pane `key` runs along held a tab it stood by: it covers nothing new. */
  function expectNoNewNeighbours(
    before: readonly string[],
    root: SplitNode,
    key: string,
    context: string,
  ) {
    for (const tabs of panesAlong(root, key)) {
      expect(
        tabs.some((tab) => before.includes(tab)),
        `${context}: ${tabs.join(",")}`,
      ).toBe(true);
    }
  }

  it("keeps tabs whole, and a returning terminal off panes it did not span, across moves", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const random = randomFrom(seed);
      const pick = <T>(items: readonly T[]) => items[random(items.length)] as T;
      const sideBySide = random(2) === 0;
      const start = openTab(openTab(startingArrangement(), chatB), chatA);
      let state = settled(linkedArrangement(sideBySide ? splitTab(start, chatB, "right") : start));
      let made = 0;
      const known = new Set(chats);
      const held = () => [...allTabs(state.arrangement), ...Object.keys(state.parked)];

      for (let step = 0; step < 14; step += 1) {
        const chat = pick(chats);
        state = on(state, (arrangement) => activateTab(arrangement, chat));
        const terminal = terminalOf(chat);
        const pane = pick(leaves(state.arrangement.root));
        made += 1;
        switch (random(5)) {
          case 0: {
            const note = `repository:note-${made}`;
            known.add(note);
            const side = pick(["left", "right", "top", "bottom"] as const);
            state = on(state, (arrangement) =>
              openBeside(arrangement, note, pane.id, side, { focus: false }),
            );
            break;
          }
          case 1: {
            const tab = `${chat.replace("chat:", "chat-surface:")}:s${made}`;
            known.add(tab);
            state = settled(openLinked(state, tab, { context: placing }));
            break;
          }
          case 2: {
            if (leafWithTab(state.arrangement.root, terminal) || terminal in state.parked) break;
            known.add(terminal);
            state = settled({
              ...state,
              owners: { ...state.owners, [terminal]: chat },
              parked: { ...state.parked, [terminal]: { pane: "", index: 1e15, active: true } },
            });
            break;
          }
          case 3: {
            if (!leafWithTab(state.arrangement.root, terminal)) break;
            const around = standingBy(state.arrangement.root, terminal);
            state = settled(hideLinkedTab(state, terminal, chat, alone));
            state = settled(showLinkedTabs(state, [terminal]));
            expectNoNewNeighbours(
              around,
              state.arrangement.root,
              terminal,
              `seed ${seed} step ${step}`,
            );
            break;
          }
          default: {
            if (!leafWithTab(state.arrangement.root, terminal)) break;
            const around = standingBy(state.arrangement.root, terminal);
            const other = chats.find((each) => each !== chat) ?? chat;
            state = on(state, (arrangement) => activateTab(arrangement, other));
            state = on(state, (arrangement) => activateTab(arrangement, chat));
            expectNoNewNeighbours(
              around,
              state.arrangement.root,
              terminal,
              `seed ${seed} step ${step}`,
            );
          }
        }
        const tabs = held();
        expect(new Set(tabs).size, `seed ${seed} step ${step}`).toBe(tabs.length);
        for (const key of known) expect(tabs, `seed ${seed} step ${step}`).toContain(key);
      }
    }
  });
});

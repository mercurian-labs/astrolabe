import { describe, expect, it } from "vite-plus/test";

import type { Arrangement } from "./arrangement";
import { CHAT_ROOM_PX, openNear, paneWidthPx } from "./placement";
import { chatTerminalKey } from "~/sectionTabs/sectionTabs";

import { leaves, type SplitNode } from "./tree";

const chat = "chat:e:a";
const otherChat = "chat:e:b";
const note = "wiki:e:w:note";
const diff = "chat-surface:e:a:diff";

const leaf = (id: string, tabs: string[], active = tabs[0] ?? "") => ({
  type: "leaf" as const,
  id,
  tabs,
  active,
});
const row = (children: SplitNode[], weights = children.map(() => 1)): SplitNode => ({
  type: "branch",
  id: "row",
  direction: "row",
  children,
  weights,
});
const arranged = (root: SplitNode, focused = "p1"): Arrangement => ({ root, focused, seq: 10 });
const tabsOf = (arrangement: Arrangement) => leaves(arrangement.root).map((pane) => pane.tabs);

// An even split gives the chat half: it needs its room twice over.
const wide = 2 * CHAT_ROOM_PX;

describe("opening a view near the pane you are reading", () => {
  it("divides the pane while both halves keep their room, and opens a tab once they would not", () => {
    const alone = arranged(leaf("p1", [chat]));
    expect(tabsOf(openNear(alone, note, "p1", { widthPx: wide }))).toEqual([[chat], [note]]);
    expect(tabsOf(openNear(alone, note, "p1", { widthPx: wide - 1 }))).toEqual([[chat, note]]);
    // The new pane's share counts: 40% of a pane wide enough for two halves is too narrow.
    expect(tabsOf(openNear(alone, note, "p1", { widthPx: wide, weight: 0.4 }))).toEqual([
      [chat, note],
    ]);
    // Settings › General › Panes › Open beside: As a tab.
    expect(tabsOf(openNear(alone, note, "p1", { widthPx: wide, divides: false }))).toEqual([
      [chat, note],
    ]);
  });

  it("joins the pane beside it rather than divide again, however wide the panes are", () => {
    const two = arranged(row([leaf("p1", [chat]), leaf("p2", [diff])]));
    const opened = openNear(two, note, "p1", { widthPx: 4000 });
    expect(tabsOf(opened)).toEqual([[chat], [diff, note]]);
    expect(leaves(opened.root)[1]?.active).toBe(note);
  });

  it("never covers another chat, or a chat's terminal, taking the nearest pane that shows none", () => {
    const panes = arranged(row([leaf("p0", [diff]), leaf("p1", [chat]), leaf("p2", [otherChat])]));
    expect(tabsOf(openNear(panes, note, "p1", { widthPx: 4000 }))).toEqual([
      [diff, note],
      [chat],
      [otherChat],
    ]);
    const terminal = chatTerminalKey(chat);
    const below = arranged(row([leaf("p1", [chat]), leaf("p2", [terminal])]));
    expect(tabsOf(openNear(below, note, "p1", { widthPx: 4000 }))).toEqual([
      [chat],
      [note],
      [terminal],
    ]);
  });

  it("divides for a tab that may not share the chat's pane, room or not", () => {
    const alone = arranged(leaf("p1", [chat]));
    expect(tabsOf(openNear(alone, diff, "p1", { widthPx: 300, ownPane: true }))).toEqual([
      [chat],
      [diff],
    ]);
  });

  it("moves the tab in front out only while the tab it uncovers keeps its room", () => {
    const covered = arranged(leaf("p1", [note, chat], note));
    expect(tabsOf(openNear(covered, note, "p1", { widthPx: 820 }))).toEqual([[note, chat]]);
    expect(tabsOf(openNear(covered, note, "p1", { widthPx: wide }))).toEqual([[chat], [note]]);
  });

  it("splits rather than join a side pane, for a view that opens files there", () => {
    const two = arranged(row([leaf("p1", [note]), leaf("p2", [diff])]));
    expect(
      tabsOf(openNear(two, "graph", "p1", { widthPx: 300, ownPane: true, joins: false })),
    ).toEqual([[note], ["graph"], [diff]]);
  });

  it("brings one open elsewhere to the front where it is", () => {
    const two = arranged(row([leaf("p1", [chat]), leaf("p2", [note, diff], diff)]));
    const opened = openNear(two, note, "p1", { widthPx: 300 });
    expect(tabsOf(opened)).toEqual(tabsOf(two));
    expect(leaves(opened.root)[1]?.active).toBe(note);
  });
});

describe("a pane's width", () => {
  it("is its share of the row it stands in, nested rows dividing their share again", () => {
    const root = row([leaf("p1", [chat]), row([leaf("p2", [note]), leaf("p3", [diff])])], [1, 1]);
    expect(paneWidthPx(root, "p1", 1200)).toBe(600);
    expect(paneWidthPx(root, "p3", 1200)).toBe(300);
    expect(paneWidthPx(root, "missing", 1200)).toBeNull();
  });
});

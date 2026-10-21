import { describe, expect, it } from "vite-plus/test";

import { neighbourRegion, type RegionBox, type RegionCandidate } from "./regions.logic";

const box = (left: number, top: number, right: number, bottom: number): RegionBox => ({
  left,
  top,
  right,
  bottom,
});

const candidate = (region: string, at: RegionBox, recency = 0): RegionCandidate<string> => ({
  region,
  box: at,
  recency,
});

// The icon rail (below the title bar), the sidebar, the chat column, and a right panel split
// into a top and a bottom pane, with 1px dividers between them.
const rail = box(0, 40, 44, 900);
const sidebar = box(45, 0, 300, 900);
const chat = box(301, 0, 900, 900);
const top = box(901, 0, 1400, 450);
const bottom = box(901, 451, 1400, 900);
const layout = [
  candidate("rail", rail),
  candidate("sidebar", sidebar),
  candidate("chat", chat),
  candidate("top", top),
  candidate("bottom", bottom),
];
const others = (from: string) => layout.filter((entry) => entry.region !== from);

describe("neighbourRegion", () => {
  it("moves to the touching region that overlaps across the direction", () => {
    expect(neighbourRegion(chat, others("chat"), "left")).toBe("sidebar");
    expect(neighbourRegion(top, others("top"), "down")).toBe("bottom");
    expect(neighbourRegion(bottom, others("bottom"), "up")).toBe("top");
    expect(neighbourRegion(bottom, others("bottom"), "left")).toBe("chat");
  });

  it("prefers the nearest of several, never one past it", () => {
    expect(neighbourRegion(top, others("top"), "left")).toBe("chat");
  });

  it("goes back to the most recently focused of two equally near regions", () => {
    const recent = [
      candidate("sidebar", sidebar),
      candidate("top", top, 1),
      candidate("bottom", bottom, 2),
    ];
    expect(neighbourRegion(chat, recent, "right")).toBe("bottom");
  });

  it("reaches the icon rail leftmost, past the sidebar or, collapsed, straight from the chat", () => {
    expect(neighbourRegion(sidebar, others("sidebar"), "left")).toBe("rail");
    expect(neighbourRegion(rail, others("rail"), "right")).toBe("sidebar");
    const collapsed = layout.filter((entry) => entry.region !== "sidebar");
    const chatBesideRail = box(45, 0, 900, 900);
    expect(
      neighbourRegion(
        chatBesideRail,
        collapsed.filter((e) => e.region !== "chat"),
        "left",
      ),
    ).toBe("rail");
    expect(neighbourRegion(rail, [candidate("chat", chatBesideRail)], "right")).toBe("chat");
    // Nothing lies above or below it.
    expect(neighbourRegion(rail, others("rail"), "down")).toBeNull();
  });

  it("goes between a right panel's panes split down, from either, as on Wikis", () => {
    expect(neighbourRegion(top, others("top"), "down")).toBe("bottom");
    expect(neighbourRegion(bottom, others("bottom"), "up")).toBe("top");
    // The chat and the sidebar beside them have nothing above or below.
    expect(neighbourRegion(chat, others("chat"), "down")).toBeNull();
    expect(neighbourRegion(sidebar, others("sidebar"), "up")).toBeNull();
  });

  it("does not wrap at the edge", () => {
    expect(neighbourRegion(rail, others("rail"), "left")).toBeNull();
    expect(neighbourRegion(top, others("top"), "right")).toBeNull();
    expect(neighbourRegion(chat, others("chat"), "up")).toBeNull();
  });

  it("falls back to the nearest centre when nothing overlaps that way", () => {
    // A pane down and to the right, below the chat's bottom edge and off its columns.
    const diagonal = [
      candidate("far", box(1000, 1000, 1200, 1200)),
      candidate("near", box(950, 920, 1100, 1000)),
    ];
    expect(neighbourRegion(chat, diagonal, "down")).toBe("near");
  });

  it("moves only among the candidates it is given, so a skipped region is never chosen", () => {
    // A collapsed sidebar or a pane hidden behind a maximized one is left out by the caller.
    expect(neighbourRegion(chat, [candidate("top", top)], "left")).toBeNull();
    expect(neighbourRegion(top, [candidate("sidebar", sidebar)], "left")).toBe("sidebar");
  });
});

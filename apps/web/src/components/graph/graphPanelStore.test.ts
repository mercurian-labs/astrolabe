import type { ThreadRecord } from "@mercurian/graph/model";
import { describe, expect, it } from "vite-plus/test";

import { CLOSED_PANEL, graphPanelReducer, useGraphPanelStore } from "./graphPanelStore";
import { LIVE_STRIP } from "./turnStrip";

const thread: ThreadRecord = {
  id: "thread",
  title: "",
  memoryId: "thread",
  turns: [
    {
      id: "c1",
      label: "One",
      events: [
        { kind: "write", note: "A", name: "A" },
        { kind: "write", note: "B", name: "B" },
      ],
    },
    { id: "c2", label: "Two", events: [{ kind: "amend", note: "A" }] },
    { id: "r3", label: "Three", events: [{ kind: "amend", note: "B" }] },
  ],
};

describe("the Graph surface's state per thread", () => {
  it("keeps what the reader had across a remount: the pinned turn, the move, the popover", () => {
    const store = useGraphPanelStore.getState();
    store.dispatch("a", { type: "pick", turn: 0, live: 2 }, CLOSED_PANEL);
    store.dispatch("a", { type: "choose", play: 1, live: 2 }, CLOSED_PANEL);
    // The panel unmounts and mounts again (a pane moved): it reads the thread's entry back.
    const restored = useGraphPanelStore.getState().byThread.a;
    expect(restored?.strip).toMatchObject({ pinned: 0, play: 1, playing: false });
    expect(restored?.popover).toBe(true);
    // Another thread has its own.
    expect(useGraphPanelStore.getState().byThread.b).toBeUndefined();
  });

  it("resets only on Live, a rollback that took the pin, or a pinned working turn settling", () => {
    const pinned = graphPanelReducer(CLOSED_PANEL, { type: "pick", turn: 0, live: 2 });
    expect(graphPanelReducer(pinned, { type: "live" })).toEqual(CLOSED_PANEL);
    expect(graphPanelReducer(pinned, { type: "turns", turns: 3 })).toBe(pinned);
    expect(graphPanelReducer(pinned, { type: "turns", turns: 0 }).strip).toEqual(LIVE_STRIP);
    // A pick of an earlier turn is not the working turn: settling leaves it.
    expect(graphPanelReducer(pinned, { type: "settled", live: 2, working: false })).toBe(pinned);
    // Played to the working turn and paused on its settle beat: pinned only as the working turn.
    const atLive = { ...CLOSED_PANEL, strip: { ...LIVE_STRIP, pinned: 2 } };
    expect(graphPanelReducer(atLive, { type: "settled", live: 2, working: true })).toBe(atLive);
    expect(graphPanelReducer(atLive, { type: "settled", live: 2, working: false }).strip).toEqual(
      LIVE_STRIP,
    );
    // A move chosen in it holds it.
    const chosen = graphPanelReducer(atLive, { type: "choose", play: 0, live: 2 });
    expect(graphPanelReducer(chosen, { type: "settled", live: 2, working: false })).toBe(chosen);
  });

  it("opens the popover on a pick or Play, closes it on Live, and keeps a reader's toggle", () => {
    const played = graphPanelReducer(CLOSED_PANEL, { type: "toggle-play", thread, live: 2 });
    expect(played.popover).toBe(true);
    const closed = graphPanelReducer(played, { type: "popover", open: false });
    expect(closed.popover).toBe(false);
    expect(closed.strip).toBe(played.strip);
    expect(graphPanelReducer(closed, { type: "live" }).popover).toBe(false);
  });
});

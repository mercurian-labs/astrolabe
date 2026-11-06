import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

vi.mock(import("~/env"), async (original) => ({ ...(await original()), isElectron: true }));

import "../index.css";
import type { Arrangement } from "./arrangement";
import { useMaximizedPaneStore } from "./maximize";
import {
  PanesHostContext,
  type PanesHost,
  PanesLayoutKeyContext,
  type PaneTabLabelProps,
} from "./panesHost";
import { PaneTree } from "./PaneTree";

const LAYOUT_KEY = "test";
const crowded = Array.from({ length: 30 }, (_, index) => `tab-${index}`);
const arrangement: Arrangement = {
  root: {
    type: "branch",
    id: "b0",
    direction: "row",
    weights: [1, 1],
    children: [
      { type: "leaf", id: "p0", tabs: crowded, active: "tab-0" },
      { type: "leaf", id: "p1", tabs: ["only"], active: "only" },
    ],
  },
  focused: "p0",
  seq: 2,
};
const snapshot = { arrangement, hostPaneId: null };
const host = {
  controller: {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    update: () => undefined,
  },
  tabs: {
    Label: ({ tabKey, children }: PaneTabLabelProps) => children({ title: tabKey, icon: null }),
    close: () => undefined,
    NewTab: () => null,
    place: () => undefined,
    Overlay: () => null,
    reservesTopRight: false,
  },
} as unknown as PanesHost;

/** Every title-bar rectangle that keeps the window from dragging, as Electron collects them. */
const noDragBoxes = (root: Element) =>
  [...root.querySelectorAll("*")]
    .filter(
      (element) => getComputedStyle(element).getPropertyValue("-webkit-app-region") === "no-drag",
    )
    .map((element) => element.getBoundingClientRect());

async function renderPanes() {
  return render(
    <div style={{ display: "flex", width: 800, height: 300 }}>
      <PanesHostContext.Provider value={host}>
        <PanesLayoutKeyContext.Provider value={LAYOUT_KEY}>
          <PaneTree snapshot={snapshot} panelMaximized />
        </PanesLayoutKeyContext.Provider>
      </PanesHostContext.Provider>
    </div>,
  );
}

describe("a pane strip in the title bar", () => {
  it("keeps tabs scrolled out of it from blocking window drags past its edge", async () => {
    await using screen = await renderPanes();
    const list = screen.container.querySelector('[data-pane-id="p0"] [data-pane-tabs]')!;
    expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    const { left, right } = screen.container
      .querySelector('[data-pane-id="p0"]')!
      .getBoundingClientRect();

    const boxes = noDragBoxes(screen.container.querySelector('[data-pane-id="p0"]')!);

    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.filter((box) => box.left < left || box.right > right)).toEqual([]);
  });

  it("leaves the pane beneath a maximized one out of the title bar", async () => {
    using _restore = { [Symbol.dispose]: () => useMaximizedPaneStore.getState().restore() };
    useMaximizedPaneStore.getState().toggle(LAYOUT_KEY, "p1");
    await using screen = await renderPanes();

    expect(noDragBoxes(screen.container.querySelector('[data-pane-id="p0"]')!)).toEqual([]);
  });
});

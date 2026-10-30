import { describe, expect, it } from "vite-plus/test";

import { focusedPane } from "./arrangement";
import { createSectionPanes } from "./sectionPanes";

function section() {
  return createSectionPanes({
    storageKey: "test:section-panes",
    historyStorageKey: "test:section-panes-history",
    isKey: (key) => key.startsWith("file:") || key.startsWith("results:"),
    keepsPlace: (key) => key.startsWith("results:"),
  });
}

describe("createSectionPanes", () => {
  it("shows a sidebar click over a file tab, with Back to it", () => {
    const panes = section();
    panes.show("file:a");
    panes.show("file:b");
    expect(focusedPane(panes.arrangement()).tabs).toEqual(["file:b"]);
    panes.step("back");
    expect(focusedPane(panes.arrangement()).tabs).toEqual(["file:a"]);
  });

  it("opens a sidebar click or a step beside a tab that keeps its place", () => {
    const panes = section();
    panes.show("file:a");
    panes.show("results:search");
    expect(focusedPane(panes.arrangement()).tabs).toEqual(["results:search"]);
    panes.show("file:b");
    expect(focusedPane(panes.arrangement())).toMatchObject({
      tabs: ["results:search", "file:b"],
      active: "file:b",
    });
    panes.open("results:search");
    panes.step("back");
    expect(focusedPane(panes.arrangement())).toMatchObject({
      tabs: ["results:search", "file:a", "file:b"],
      active: "file:a",
    });
  });
});

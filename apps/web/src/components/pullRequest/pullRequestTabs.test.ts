import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { openBeside, openTab, startingArrangement, surfaceKey } from "~/panes/arrangement";
import { useMaximizedPaneStore } from "~/panes/maximize";
import type { PaneArrangementStore } from "~/panes/panesHost";
import { WORKSPACE_LAYOUT_KEY } from "~/panes/workspace";
import { pullRequestSurface } from "~/rightPanelStore";
import { pullRequestTargetOfKey } from "./pullRequestTabs";
import { maximizeForGuide, pullRequestTabKey } from "./pullRequestWorkspace";

const full = (number: number) =>
  pullRequestSurface({
    environmentId: "env-1",
    projectId: "project/1",
    host: "GitHub.com",
    repository: "acme/app",
    number,
  });

describe("pull request tabs saved by key", () => {
  it("reads a pull request back from a tab key that names it in full", () => {
    expect(pullRequestTargetOfKey(surfaceKey(full(7).id))).toEqual({
      environmentId: "env-1",
      projectId: "project/1",
      host: "github.com",
      repository: "acme/app",
      number: 7,
    });
  });

  it("does not read a key without its server and host, or another surface", () => {
    const partial = pullRequestSurface({ projectId: "p", repository: "r", number: 1 });
    expect(pullRequestTargetOfKey(surfaceKey(partial.id))).toBeNull();
    expect(pullRequestTargetOfKey(surfaceKey("diff"))).toBeNull();
    expect(pullRequestTargetOfKey("wiki-note:a:b::c")).toBeNull();
  });

  it("names a row's pull request in full, and nothing it cannot place on a server", () => {
    const target = {
      environmentId: "env-1",
      projectId: "project/1",
      host: "GitHub.com",
      repository: "acme/app",
      number: 7,
    };
    expect(pullRequestTabKey(target)).toBe(surfaceKey(full(7).id));
    expect(pullRequestTargetOfKey(pullRequestTabKey(target) ?? "")?.number).toBe(7);
    expect(pullRequestTabKey({ projectId: "p", repository: "r", number: 1, host: "h" })).toBeNull();
  });
});

describe("a review's Guide taking the shared panes", () => {
  afterEach(() => useMaximizedPaneStore.getState().restore());

  const panesOf = (arrangement: ReturnType<typeof startingArrangement>): PaneArrangementStore => {
    let snapshot = { arrangement, hostPaneId: null };
    return {
      update: (change) => {
        snapshot = { ...snapshot, arrangement: change(snapshot.arrangement) };
      },
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    };
  };
  const one = surfaceKey(full(1).id);
  const two = surfaceKey(full(2).id);
  /** #1 in one pane, and #2 beside it in the focused one. */
  const twoPanes = () => openBeside(openTab(startingArrangement(), one), two, "p0", "right");
  const maximized = () => useMaximizedPaneStore.getState().maximized;

  it("folds the list away and maximizes the focused pane showing the tour", () => {
    const arrangement = twoPanes();
    const hideList = vi.fn();
    maximizeForGuide(two, hideList, panesOf(arrangement));
    expect(hideList).toHaveBeenCalledOnce();
    expect(maximized()).toEqual({ layoutKey: WORKSPACE_LAYOUT_KEY, paneId: arrangement.focused });
  });

  it("only folds the list away beside a lone pane, which already fills the area", () => {
    const hideList = vi.fn();
    maximizeForGuide(one, hideList, panesOf(openTab(startingArrangement(), one)));
    expect(hideList).toHaveBeenCalledOnce();
    expect(maximized()).toBeNull();
  });

  it("leaves everything as it is for a tour outside the focused pane", () => {
    const hideList = vi.fn();
    maximizeForGuide(one, hideList, panesOf(twoPanes()));
    expect(hideList).not.toHaveBeenCalled();
    expect(maximized()).toBeNull();
  });

  it("keeps a pane maximized by hand before the tour showed", () => {
    const arrangement = twoPanes();
    useMaximizedPaneStore.getState().toggle(WORKSPACE_LAYOUT_KEY, arrangement.focused);
    maximizeForGuide(two, () => {}, panesOf(arrangement));
    expect(maximized()?.paneId).toBe(arrangement.focused);
  });
});

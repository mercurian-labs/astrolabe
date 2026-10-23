import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  activateTab,
  focusedPane,
  openBeside,
  openTab,
  startingArrangement,
  surfaceKey,
  type Arrangement,
} from "~/panes/arrangement";
import { useMaximizedPaneStore } from "~/panes/maximize";
import type { PaneArrangementStore } from "~/panes/panesHost";
import { followRecord } from "~/panes/surfaceMirror";
import { pullRequestSurface } from "~/rightPanelStore";
import {
  keepStoredHistory,
  maximizeForGuide,
  parseStoredHistory,
  PULL_REQUEST_PANES_LAYOUT_KEY,
  pullRequestOpenFor,
  pullRequestsToRestore,
  pullRequestTargetOfKey,
} from "./pullRequestTabs";

const pr = (number: number) =>
  pullRequestSurface({ projectId: "p", repository: "acme/app", number, environmentId: "e" });

describe("what a pull request row click does to the panes", () => {
  const one = openTab(startingArrangement(), surfaceKey(pr(1).id));

  it("replaces the focused pane's tab in front, or fills an empty one", () => {
    expect(pullRequestOpenFor(one, pr(2).id, "replace")).toEqual({
      kind: "replace",
      from: surfaceKey(pr(1).id),
    });
    expect(pullRequestOpenFor(startingArrangement(), pr(2).id, "replace")).toMatchObject({
      kind: "tab",
    });
  });

  it("brings one already open to the front, and opens a new tab as asked", () => {
    expect(pullRequestOpenFor(one, pr(1).id, "replace")).toEqual({
      kind: "front",
      key: surfaceKey(pr(1).id),
    });
    expect(pullRequestOpenFor(one, pr(2).id, "new-tab")).toEqual({
      kind: "tab",
      paneId: one.focused,
    });
    // Mod-click opens a new tab in the focused pane too, as Option-click does.
    expect(pullRequestOpenFor(one, pr(2).id, "mod")).toEqual({
      kind: "tab",
      paneId: one.focused,
    });
  });

  it("keeps a replaced tab's place: the record swaps the surface in one change", () => {
    // The focused pane shows #3 in front, between #1 and #4.
    const three = activateTab(
      openTab(openTab(one, surfaceKey(pr(3).id)), surfaceKey(pr(4).id)),
      surfaceKey(pr(3).id),
    );
    const before = {
      isOpen: true,
      activeSurfaceId: pr(3).id,
      surfaceIds: [1, 3, 4].map((n) => pr(n).id),
    };
    const after = {
      isOpen: true,
      activeSurfaceId: pr(6).id,
      surfaceIds: [1, 6, 4].map((n) => pr(n).id),
    };
    const pane = focusedPane(followRecord(three, before, after).arrangement);
    expect(pane.tabs).toEqual([1, 6, 4].map((n) => surfaceKey(pr(n).id)));
    expect(pane.active).toBe(surfaceKey(pr(6).id));
  });
});

describe("a pull request tab's stored history", () => {
  it("reads only well-formed entries", () => {
    const stored = parseStoredHistory({
      histories: { a: { back: ["b", 3], forward: [] } },
      surfaces: {
        b: { projectId: "p", repository: "acme/app", number: 2, environmentId: "e" },
        c: { projectId: "p", repository: "acme/app" },
      },
    });
    expect(stored.histories).toEqual({ a: { back: ["b"], forward: [] } });
    expect(stored.surfaces).toEqual({ b: pr(2) });
    expect(parseStoredHistory("nope")).toEqual({ histories: {}, surfaces: {} });
  });

  it("forgets closed tabs' histories and the pull requests only they named", () => {
    const stored = {
      histories: {
        a: { back: ["b"], forward: [] },
        x: { back: ["y"], forward: [] },
      },
      surfaces: { b: pr(2), y: pr(3) },
    };
    expect(keepStoredHistory(stored, ["a"])).toEqual({
      histories: { a: { back: ["b"], forward: [] } },
      surfaces: { b: pr(2) },
    });
  });
});

describe("a pull request row over another kind of tab", () => {
  it("replaces a wiki change request in front, as it replaces a pull request", () => {
    const wiki = openTab(startingArrangement(), "wiki-change:e:w:cr1");
    expect(pullRequestOpenFor(wiki, pr(2).id, "replace")).toEqual({
      kind: "replace-other",
      from: "wiki-change:e:w:cr1",
    });
    expect(pullRequestOpenFor(wiki, pr(2).id, "new-tab")).toMatchObject({ kind: "tab" });
  });
});

describe("pull request tabs saved by key", () => {
  const full = (number: number) =>
    pullRequestSurface({
      environmentId: "env-1",
      projectId: "project/1",
      host: "GitHub.com",
      repository: "acme/app",
      number,
    });

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
    expect(pullRequestTargetOfKey(surfaceKey(pr(7).id))).toBeNull();
    expect(
      pullRequestTargetOfKey(
        surfaceKey(pullRequestSurface({ projectId: "p", repository: "r", number: 1 }).id),
      ),
    ).toBeNull();
    expect(pullRequestTargetOfKey(surfaceKey("diff"))).toBeNull();
    expect(pullRequestTargetOfKey("wiki-note:a:b::c")).toBeNull();
  });

  it("restores the saved tabs the record lacks, with the focused pane's in front", () => {
    let arrangement = openTab(startingArrangement(), surfaceKey(full(1).id));
    arrangement = openTab(arrangement, surfaceKey(full(2).id));
    arrangement = activateTab(arrangement, surfaceKey(full(1).id));
    const restored = pullRequestsToRestore(arrangement, [full(2).id]);
    expect(restored.targets.map((target) => target.number)).toEqual([1]);
    expect(restored.front).toBe(full(1).id);
    expect(pullRequestsToRestore(arrangement, [full(1).id, full(2).id]).targets).toEqual([]);
  });
});

describe("a review's Guide taking the Change Requests area", () => {
  afterEach(() => useMaximizedPaneStore.getState().restore());

  /** Panes holding `arrangement`, as the area's attached panes do. */
  const panesOf = (arrangement: Arrangement): PaneArrangementStore => {
    let snapshot = { arrangement, hostPaneId: null };
    return {
      update: (change) => {
        snapshot = { ...snapshot, arrangement: change(snapshot.arrangement) };
      },
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    };
  };
  /** #1 in one pane, and #2 beside it in the focused one. */
  const twoPanes = () =>
    openBeside(
      openTab(startingArrangement(), surfaceKey(pr(1).id)),
      surfaceKey(pr(2).id),
      "p0",
      "right",
    );
  const maximized = () => useMaximizedPaneStore.getState().maximized;

  it("folds the list away and maximizes the focused pane showing the tour", () => {
    const arrangement = twoPanes();
    const hideList = vi.fn();
    maximizeForGuide(pr(2).id, hideList, panesOf(arrangement));
    expect(hideList).toHaveBeenCalledOnce();
    expect(maximized()).toEqual({
      layoutKey: PULL_REQUEST_PANES_LAYOUT_KEY,
      paneId: arrangement.focused,
    });
  });

  it("only folds the list away beside a lone pane, which already fills the area", () => {
    const hideList = vi.fn();
    maximizeForGuide(
      pr(1).id,
      hideList,
      panesOf(openTab(startingArrangement(), surfaceKey(pr(1).id))),
    );
    expect(hideList).toHaveBeenCalledOnce();
    expect(maximized()).toBeNull();
  });

  it("leaves everything as it is for a tour outside the focused pane", () => {
    const hideList = vi.fn();
    maximizeForGuide(pr(1).id, hideList, panesOf(twoPanes()));
    maximizeForGuide(pr(2).id, hideList, null);
    expect(hideList).not.toHaveBeenCalled();
    expect(maximized()).toBeNull();
  });

  it("keeps a pane maximized by hand before the tour showed", () => {
    const arrangement = twoPanes();
    useMaximizedPaneStore.getState().toggle(PULL_REQUEST_PANES_LAYOUT_KEY, arrangement.focused);
    maximizeForGuide(pr(2).id, () => {}, panesOf(arrangement));
    expect(maximized()?.paneId).toBe(arrangement.focused);
  });
});

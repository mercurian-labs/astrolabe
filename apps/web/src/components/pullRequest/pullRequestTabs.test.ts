import { describe, expect, it } from "vite-plus/test";

import {
  activateTab,
  focusedPane,
  openTab,
  startingArrangement,
  surfaceKey,
} from "~/panes/arrangement";
import { followRecord } from "~/panes/surfaceMirror";
import { pullRequestSurface } from "~/rightPanelStore";
import { keepStoredHistory, parseStoredHistory, pullRequestOpenFor } from "./pullRequestTabs";

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

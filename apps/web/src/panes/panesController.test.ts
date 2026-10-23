import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { activateTab, openBeside, surfaceKey } from "./arrangement";
import { createPanesController } from "./panesController";
import type { StorageLike } from "./persistence";
import { leaves } from "./tree";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

function memoryStorage(): StorageLike {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

function panes(controller: ReturnType<typeof createPanesController>) {
  const snapshot = controller.getSnapshot();
  return snapshot ? leaves(snapshot.arrangement.root).map((leaf) => leaf.tabs) : [];
}

function record(ref = refA) {
  return selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
}

beforeEach(() => {
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
});

describe("the right panel's panes following T3 Code's panel record", () => {
  it("keep following after a remount re-subscribes, as StrictMode does", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const first = controller.follow();
    first();
    controller.load(refA, scopedThreadKey(refA));
    const second = controller.follow();
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openFile(refA, "README.md");
    expect(panes(controller)).toEqual([[surfaceKey("file:README.md")]]);
    second();
  });

  it("take in changes made between loading a thread and following it", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    useRightPanelStore.getState().open(refA, "diff");
    const stop = controller.follow();
    expect(panes(controller)).toEqual([[surfaceKey("diff")]]);
    stop();
  });

  it("make the surface a pane brings forward the one T3 Code shows, and leave the panel open", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const stop = controller.follow();
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    expect(record()).toMatchObject({ isOpen: true, activeSurfaceId: "files" });
    // Diff moves into its own pane beside Files, taking focus: it becomes the one shown.
    controller.update((arrangement) => openBeside(arrangement, surfaceKey("diff"), "p0", "right"));
    expect(panes(controller)).toEqual([[surfaceKey("files")], [surfaceKey("diff")]]);
    expect(record()).toMatchObject({ isOpen: true, activeSurfaceId: "diff" });
    expect(controller.getSnapshot()?.hostPaneId).toBe("p1");
    controller.update((arrangement) => activateTab(arrangement, surfaceKey("files")));
    expect(record()).toMatchObject({ isOpen: true, activeSurfaceId: "files" });
    expect(controller.getSnapshot()?.hostPaneId).toBe("p0");
    stop();
  });

  it("keep the tabs while T3 Code hides its panel, and never open it themselves", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const stop = controller.follow();
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().close(refA);
    expect(panes(controller)).toEqual([[surfaceKey("diff")]]);
    controller.update((arrangement) => activateTab(arrangement, surfaceKey("diff")));
    expect(record()).toMatchObject({ isOpen: false });
    stop();
  });

  it("show each thread its own arrangement, remembered across a switch", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const stop = controller.follow();
    useRightPanelStore.getState().open(refA, "diff");
    expect(panes(controller)).toEqual([[surfaceKey("diff")]]);
    controller.load(refB, scopedThreadKey(refB));
    expect(panes(controller)).toEqual([["empty/0"]]);
    // The other thread's record moving does not touch these panes.
    useRightPanelStore.getState().open(refA, "files");
    expect(panes(controller)).toEqual([["empty/0"]]);
    controller.load(refA, scopedThreadKey(refA));
    expect(panes(controller)).toEqual([[surfaceKey("diff"), surfaceKey("files")]]);
    stop();
  });
});

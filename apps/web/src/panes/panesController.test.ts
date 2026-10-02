import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { CONVERSATION, activateTab, openTab, surfaceKey } from "./arrangement";
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

describe("the panes following T3 Code's panel record", () => {
  it("keep following after a remount re-subscribes, as StrictMode does", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const first = controller.follow();
    first();
    controller.load(refA, scopedThreadKey(refA));
    const second = controller.follow();
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openFile(refA, "README.md");
    expect(panes(controller)).toEqual([[CONVERSATION], [surfaceKey("file:README.md")]]);
    second();
  });

  it("take in changes made between loading a thread and following it", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    useRightPanelStore.getState().open(refA, "diff");
    const stop = controller.follow();
    expect(panes(controller)).toEqual([[CONVERSATION], [surfaceKey("diff")]]);
    stop();
  });

  it("close the panel when no surface tab is shown, and show the surface a tab brings forward", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const stop = controller.follow();
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    expect(record()).toMatchObject({ isOpen: true, activeSurfaceId: "files" });
    // The conversation moves over the surfaces: none is shown, so the panel closes, tabs kept.
    controller.update((arrangement) => openTab(arrangement, CONVERSATION, "p1"));
    expect(panes(controller)).toEqual([[surfaceKey("diff"), surfaceKey("files"), CONVERSATION]]);
    expect(record()).toMatchObject({ isOpen: false });
    controller.update((arrangement) => activateTab(arrangement, surfaceKey("diff")));
    expect(record()).toMatchObject({ isOpen: true, activeSurfaceId: "diff" });
    stop();
  });

  it("show each thread its own arrangement, remembered across a switch", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const stop = controller.follow();
    useRightPanelStore.getState().open(refA, "diff");
    expect(panes(controller)).toEqual([[CONVERSATION], [surfaceKey("diff")]]);
    controller.load(refB, scopedThreadKey(refB));
    expect(panes(controller)).toEqual([[CONVERSATION]]);
    // The other thread's record moving does not touch these panes.
    useRightPanelStore.getState().open(refA, "files");
    expect(panes(controller)).toEqual([[CONVERSATION]]);
    controller.load(refA, scopedThreadKey(refA));
    expect(panes(controller)).toEqual([[CONVERSATION], [surfaceKey("diff"), surfaceKey("files")]]);
    stop();
  });
});

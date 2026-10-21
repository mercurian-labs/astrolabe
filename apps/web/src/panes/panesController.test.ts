import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
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
  useTerminalUiStateStore.setState({ terminalUiStateByThreadKey: {} });
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

describe("terminals inside the panes", () => {
  function drawerOpen(ref = refA) {
    return selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      ref,
    ).terminalOpen;
  }

  it("show a terminal the drawer was opened for as a panel terminal across the bottom, drawer shut", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const stop = controller.follow();
    // As running a project script does.
    useTerminalUiStateStore.getState().ensureTerminal(refA, "term-2", { open: true, active: true });
    expect(drawerOpen()).toBe(false);
    expect(panes(controller)).toEqual([[CONVERSATION], [surfaceKey("terminal:term-2")]]);
    expect(controller.getSnapshot()?.arrangement.root).toMatchObject({ direction: "column" });
    expect(record()).toMatchObject({ isOpen: true, activeSurfaceId: "terminal:term-2" });
    stop();
  });

  it("go to an open terminal, then back to the conversation, on the terminal shortcut", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const stop = controller.follow();
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    controller.update((arrangement) => activateTab(arrangement, CONVERSATION));
    expect(controller.getSnapshot()?.arrangement.focused).toBe("p0");
    expect(controller.toggleTerminal()).toBe("terminal");
    const terminalPane = leaves(controller.getSnapshot()!.arrangement.root).find((leaf) =>
      leaf.tabs.includes(surfaceKey("terminal:term-1")),
    );
    expect(controller.getSnapshot()?.arrangement.focused).toBe(terminalPane?.id);
    expect(controller.toggleTerminal()).toBe("conversation");
    expect(controller.getSnapshot()?.arrangement.focused).toBe("p0");
    stop();
  });

  it("bring a hidden terminal back when the shortcut goes to it", () => {
    const controller = createPanesController(memoryStorage());
    controller.load(refA, scopedThreadKey(refA));
    const stop = controller.follow();
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().close(refA);
    expect(panes(controller)).toEqual([[CONVERSATION]]);
    controller.toggleTerminal();
    expect(panes(controller)).toEqual([[CONVERSATION], [surfaceKey("terminal:term-1")]]);
    stop();
  });
});

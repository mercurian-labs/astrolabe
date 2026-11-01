import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { chatSurfaceKey, chatTabKey } from "../sectionTabs/sectionTabs";
import type { StorageLike } from "./persistence";
import { leaves } from "./tree";
import { createWorkspace, WORKSPACE_STORAGE_KEY } from "./workspace";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));
const chatA = chatTabKey(refA);
const chatB = chatTabKey(refB);

function memoryStorage(entries: Record<string, string> = {}): StorageLike & {
  readonly items: Map<string, string>;
} {
  const items = new Map(Object.entries(entries));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/** A device whose chat tabs were A then B, A in front. */
function chatTabsDevice() {
  return memoryStorage({
    "t3code:chat-tabs:v1": JSON.stringify({
      state: {
        keys: [scopedThreadKey(refA), scopedThreadKey(refB)],
        active: scopedThreadKey(refA),
      },
      version: 1,
    }),
  });
}

function panes(workspace: ReturnType<typeof createWorkspace>) {
  return leaves(workspace.arrangement().root).map((leaf) => leaf.tabs);
}

beforeEach(() => {
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
});

describe("the shared panes", () => {
  it("bring in the chat tabs and the sections' panes once, and drop thread panels", () => {
    const device = chatTabsDevice();
    device.setItem(
      "astrolabe:repository-panes:v1",
      JSON.stringify({
        root: { type: "leaf", id: "p0", tabs: [chatA, "empty/0"], active: chatA },
        focused: "p0",
        seq: 1,
      }),
    );
    device.setItem("t3code:right-panel-panes:v1:env-1:thread-A", "{}");
    const workspace = createWorkspace(() => device);
    // A chat open in both comes in once, with the chats.
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(workspace.linked().front).toBe(chatA);
    expect(device.items.has("t3code:chat-tabs:v1")).toBe(false);
    expect(device.items.has("astrolabe:repository-panes:v1")).toBe(false);
    workspace.store.flush();
    expect(device.items.has(WORKSPACE_STORAGE_KEY)).toBe(true);
  });

  it("show the chat in front's surfaces beside it, and the next chat's in their place", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "diff");
    expect(panes(workspace)).toEqual([[chatA, chatB], [chatSurfaceKey(chatA, "diff")]]);
    useRightPanelStore.getState().open(refB, "files");
    workspace.arriveChat(chatB);
    expect(panes(workspace)).toEqual([[chatA, chatB], [chatSurfaceKey(chatB, "files")]]);
    workspace.arriveChat(chatA);
    expect(panes(workspace)).toEqual([[chatA, chatB], [chatSurfaceKey(chatA, "diff")]]);
    // The chat keeps the focus as its surfaces come and go.
    expect(workspace.arrangement().focused).toBe("p0");
    stop();
  });

  it("close a chat's panel once its last linked tab is closed by hand", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().show(refA);
    const [, linked] = panes(workspace);
    expect(linked).toHaveLength(1);
    workspace.close(linked?.[0] ?? "");
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    const record = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(record.isOpen).toBe(false);
    stop();
  });

  it("hide a chat's linked tabs with its panel, and bring them back with the one picked in front", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    const files = chatSurfaceKey(chatA, "files");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    expect(workspace.toggleOf(chatA)).toEqual({ kind: "showing" });
    useRightPanelStore.getState().close(refA);
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(workspace.toggleOf(chatA)).toEqual({ kind: "hidden", tabs: [diff, files] });
    // Another chat's toggle counts only its own.
    expect(workspace.toggleOf(chatB)).toEqual({ kind: "none" });

    workspace.showLinked(chatA, diff);
    expect(panes(workspace)).toEqual([
      [chatA, chatB],
      [diff, files],
    ]);
    expect(leaves(workspace.arrangement().root)[1]?.active).toBe(diff);
    expect(workspace.toggleOf(chatA)).toEqual({ kind: "showing" });
    stop();
  });

  it("bring hidden tabs back with a new empty one in front", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().close(refA);
    workspace.showLinked(chatA, null);
    const [, linked] = panes(workspace);
    expect(linked).toEqual([chatSurfaceKey(chatA, "diff"), expect.stringMatching(/^empty\//)]);
    expect(leaves(workspace.arrangement().root)[1]?.active).toBe(linked?.[1]);
    stop();
  });

  it("forget a surface closed for good: the toggle neither counts nor brings it back", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().closeSurface(refA, "diff");
    useRightPanelStore.getState().close(refA);
    const files = chatSurfaceKey(chatA, "files");
    expect(workspace.toggleOf(chatA)).toEqual({ kind: "hidden", tabs: [files] });
    useRightPanelStore.getState().show(refA);
    expect(panes(workspace)).toEqual([[chatA, chatB], [files]]);
    stop();
  });

  it("keep a chat's other linked tabs showing when its last surface closes", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const doc = "wiki:doc";
    useRightPanelStore.getState().open(refA, "diff");
    workspace.openLinked(doc);
    useRightPanelStore.getState().closeSurface(refA, "diff");
    expect(panes(workspace)).toEqual([[chatA, chatB], [doc]]);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).isOpen,
    ).toBe(true);
    // The last surface alone closes the panel, as T3 Code's does: nothing is left set aside.
    workspace.close(doc);
    expect(workspace.toggleOf(chatA)).toEqual({ kind: "none" });
    stop();
  });

  it("put a chat that the route shows in place of the chat in front", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const refC = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-C"));
    workspace.arriveChat(chatTabKey(refC));
    expect(panes(workspace)).toEqual([[chatTabKey(refC), chatB]]);
    workspace.step("back");
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
  });
});

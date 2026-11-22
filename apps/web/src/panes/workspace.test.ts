import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { repositoryTabKey } from "../components/repositories/repositoryTabs";
import {
  pullRequestSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { chatSurfaceKey, chatTabKey, chatTerminalKey } from "../sectionTabs/sectionTabs";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { DEFAULT_THREAD_TERMINAL_ID } from "../types";
import { useClosedViewStore } from "../closedViewStore";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_LAYOUT_SETTINGS,
  type LayoutSettings,
} from "@t3tools/contracts/settings";
import { __setClientSettingsForTests } from "../hooks/useSettings";
import { focusTerminal } from "../lib/terminalFocus";
import { lendChat, type ChatBridge } from "./chatBridge";
import { settingsSettled, type LayoutBehavior } from "./layoutBehavior";
import { useMaximizedPaneStore } from "./maximize";
import type { ChatRoute } from "../chatTabs/chatTabLabel";
import { agentsRoute } from "./agentsRoute";
import { repositoryFileReveal } from "../components/repositories/repositoryFileReveal";
import {
  activateTab,
  allTabs,
  focusedPane,
  focusPane,
  moveTabs,
  newTab,
  openBeside,
  openTab,
  splitTab,
  splitWithTabs,
  surfaceKey,
} from "./arrangement";
import { recordJump, trackJumpCursor } from "./jumpHistory";
import type { StorageLike } from "./persistence";
import { setPanesWidthPx } from "./placement";
import { leafWithTab, leaves, type Branch, type SplitNode } from "./tree";
import { linkTab } from "./linkedTabs";
import {
  createWorkspace,
  focusedChatOf,
  standaloneKeyOf,
  WORKSPACE_LAYOUT_KEY,
  WORKSPACE_STORAGE_KEY,
} from "./workspace";

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
  useTerminalUiStateStore.setState({
    terminalUiStateByThreadKey: {},
    suppressedTerminalIdsByThreadKey: {},
  });
  useClosedViewStore.setState({ entries: [] });
  useMaximizedPaneStore.getState().restore();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  // No page here: a frame is the very next thing.
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => run(0));
});

/** Client settings as these panes see them: `known` until told otherwise, changed by `set`. */
function layoutSettings(known = true) {
  let layout: LayoutSettings = DEFAULT_LAYOUT_SETTINGS;
  let isKnown = known;
  const listeners = new Set<() => void>();
  const behavior: LayoutBehavior = {
    read: () => layout,
    known: () => isKnown,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const set = (next: Partial<LayoutSettings>) => {
    layout = { ...DEFAULT_LAYOUT_SETTINGS, ...next };
    isKnown = true;
    for (const listener of listeners) listener();
  };
  return { behavior, set };
}

/** A ChatView's loan to the panes, its side pane opening nothing unless told to. */
function chatBridge(overrides: Partial<ChatBridge> = {}): ChatBridge {
  return {
    launchContext: null,
    addTerminalContext: () => {},
    endTerminals: () => {},
    openSidePane: () => false,
    focusComposer: () => {},
    ...overrides,
  };
}

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

  it("bring Changes' panes in once, beside the shared ones, with their tabs' history", () => {
    const pr = (number: number) =>
      surfaceKey(
        pullRequestSurface({
          environmentId: "env-1",
          projectId: "project-1",
          host: "github.com",
          repository: "acme/app",
          number,
        }).id,
      );
    const device = memoryStorage({
      [WORKSPACE_STORAGE_KEY]: JSON.stringify({
        root: { type: "leaf", id: "p0", tabs: [chatA], active: chatA },
        focused: "p0",
        seq: 1,
        owners: {},
        parked: {},
        front: chatA,
      }),
      "t3code:right-panel-panes:v1:pull-requests": JSON.stringify({
        root: {
          type: "branch",
          id: "p2",
          direction: "row",
          children: [
            { type: "leaf", id: "p0", tabs: [pr(1), chatA], active: pr(1) },
            { type: "leaf", id: "p1", tabs: ["empty/0"], active: "empty/0" },
          ],
          weights: [1, 1],
        },
        focused: "p0",
        seq: 3,
      }),
      "astrolabe:pull-request-tab-history:v1": JSON.stringify({
        histories: { [pr(1)]: { back: [pr(2)], forward: [] } },
        surfaces: {},
      }),
    });
    const workspace = createWorkspace(() => device);
    // A chat open in both stays where the shared panes had it; an empty pane does not come.
    expect(panes(workspace)).toEqual([[chatA], [pr(1)]]);
    expect(workspace.arrangement().focused).toBe("p0");
    expect(workspace.linked().front).toBe(chatA);
    workspace.update((arrangement) => activateTab(arrangement, pr(1)));
    expect(workspace.canStep("back")).toBe(true);
    expect(device.items.has("t3code:right-panel-panes:v1:pull-requests")).toBe(false);
    expect(device.items.has("astrolabe:pull-request-tab-history:v1")).toBe(false);
    workspace.store.flush();
    expect(createWorkspace(() => device).arrangement()).toEqual(workspace.arrangement());
  });

  it("show the chat in front's surfaces beside it, and the next chat's in their place", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "diff");
    expect(panes(workspace)).toEqual([[chatA, chatB], [chatSurfaceKey(chatA, "diff")]]);
    useRightPanelStore.getState().open(refB, "files");
    workspace.openChat(chatB);
    expect(panes(workspace)).toEqual([[chatA, chatB], [chatSurfaceKey(chatB, "files")]]);
    workspace.openChat(chatA);
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

  it("hide a chat's linked tabs with its panel, and bring them back as they stood", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    const files = chatSurfaceKey(chatA, "files");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    expect(workspace.linkedTabsOf(chatA).every((tab) => tab.shown)).toBe(true);
    useRightPanelStore.getState().close(refA);
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(workspace.linkedTabsOf(chatA)).toEqual([
      { key: diff, shown: false },
      { key: files, shown: false },
    ]);
    // Another chat's toggle counts only its own.
    expect(workspace.linkedTabsOf(chatB)).toEqual([]);

    useRightPanelStore.getState().activateSurface(refA, "diff");
    useRightPanelStore.getState().show(refA);
    expect(panes(workspace)).toEqual([
      [chatA, chatB],
      [diff, files],
    ]);
    expect(leaves(workspace.arrangement().root)[1]?.active).toBe(diff);
    expect(workspace.linkedTabsOf(chatA).every((tab) => tab.shown)).toBe(true);

    // A new tab opening with them lands after the ones coming back.
    useRightPanelStore.getState().close(refA);
    useRightPanelStore.getState().open(refA, "graph");
    expect(panes(workspace)).toEqual([
      [chatA, chatB],
      [diff, files, chatSurfaceKey(chatA, "graph")],
    ]);
    stop();
  });

  it("bring hidden tabs back with a new empty one in front", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().close(refA);
    workspace.newLinkedTab(chatA);
    const [, linked] = panes(workspace);
    expect(linked).toEqual([chatSurfaceKey(chatA, "diff"), expect.stringMatching(/^empty\//)]);
    expect(leaves(workspace.arrangement().root)[1]?.active).toBe(linked?.[1]);
    expect(workspace.linkedTabsOf(chatA).every((tab) => tab.shown)).toBe(true);
    stop();
  });

  it("open a new linked tab in front beside the ones showing", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    const files = chatSurfaceKey(chatA, "files");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    workspace.newLinkedTab(chatA);
    const [, linked] = panes(workspace);
    expect(linked).toEqual([diff, files, expect.stringMatching(/^empty\//)]);
    expect(leaves(workspace.arrangement().root)[1]?.active).toBe(linked?.[2]);
    expect(workspace.linked().owners[linked?.[2] ?? ""]).toBe(chatA);
    expect(workspace.arrangement().focused).toBe("p0");
    stop();
  });

  it("hide one linked tab with the rest showing, until it is shown or asked for", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    const files = chatSurfaceKey(chatA, "files");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");

    workspace.setLinkedTabShown(chatA, diff, false);
    expect(panes(workspace)).toEqual([[chatA, chatB], [files]]);
    // The record keeps the surface and moves on from it; following it opens nothing back.
    const record = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(record().surfaces.map((surface) => surface.id)).toEqual(["diff", "files"]);
    expect(record().activeSurfaceId).toBe("files");
    useRightPanelStore.getState().open(refA, "files");
    expect(panes(workspace)).toEqual([[chatA, chatB], [files]]);

    workspace.setLinkedTabShown(chatA, diff, true);
    expect(panes(workspace)).toEqual([
      [chatA, chatB],
      [diff, files],
    ]);
    expect(leaves(workspace.arrangement().root)[1]?.active).toBe(diff);

    workspace.setLinkedTabShown(chatA, diff, false);
    // Opened by name, as a chat's diff link does, it comes back.
    useRightPanelStore.getState().activateSurface(refA, "diff");
    expect(panes(workspace)).toEqual([
      [chatA, chatB],
      [diff, files],
    ]);
    stop();
  });

  it("minimize a linked tab into its chat's menu, the last one showing with the chat's panel", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    const files = chatSurfaceKey(chatA, "files");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    let hidden = 0;
    const hide = () => {
      hidden += 1;
      useRightPanelStore.getState().close(refA);
    };
    workspace.setPanel({ onHide: hide } as unknown as Parameters<typeof workspace.setPanel>[0]);
    // A chat, and a tab no chat's menu lists, close as ever.
    expect(workspace.minimizeLinkedTab(chatA)).toBe(false);
    expect(workspace.minimizeLinkedTab("wiki:doc")).toBe(false);

    expect(workspace.minimizeLinkedTab(diff)).toBe(true);
    expect(panes(workspace)).toEqual([[chatA, chatB], [files]]);
    expect(workspace.linkedTabsOf(chatA)).toEqual([
      { key: diff, shown: false },
      { key: files, shown: true },
    ]);
    expect(hidden).toBe(0);

    expect(workspace.minimizeLinkedTab(files)).toBe(true);
    expect(hidden).toBe(1);
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(workspace.minimizes(files)).toBe(false);

    // An empty New tab holds nothing to bring back: it closes rather than minimizes.
    workspace.newLinkedTab(chatA);
    const blank = panes(workspace)[1]?.find((key) => key.startsWith("empty/")) ?? "";
    expect(workspace.minimizes(blank)).toBe(false);
    stop();
  });

  it("show only the tab picked while its chat's panel is closed", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    const files = chatSurfaceKey(chatA, "files");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().close(refA);

    workspace.setLinkedTabShown(chatA, files, true);
    expect(panes(workspace)).toEqual([[chatA, chatB], [files]]);
    expect(workspace.linkedTabsOf(chatA)).toEqual([
      { key: diff, shown: false },
      { key: files, shown: true },
    ]);

    workspace.showAllLinkedTabs(chatA);
    expect(panes(workspace)).toEqual([
      [chatA, chatB],
      [diff, files],
    ]);
    stop();
  });

  it("delete a hidden tab for good, a surface or a document", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const doc = "wiki:doc";
    const diff = chatSurfaceKey(chatA, "diff");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    workspace.openLinked(doc);
    workspace.setLinkedTabShown(chatA, doc, false);
    workspace.setLinkedTabShown(chatA, diff, false);

    workspace.close(doc);
    useRightPanelStore.getState().closeSurface(refA, "diff");
    expect(workspace.linkedTabsOf(chatA)).toEqual([
      { key: chatSurfaceKey(chatA, "files"), shown: true },
    ]);

    // Set aside with the panel too, a surface closed for good does not come back with it.
    useRightPanelStore.getState().close(refA);
    useRightPanelStore.getState().closeSurface(refA, "files");
    expect(workspace.linkedTabsOf(chatA)).toEqual([]);
    expect(workspace.linked().parked).toEqual({});
    stop();
  });

  it("close the panel when the last tab showing closes, keeping the hidden ones hidden", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    workspace.setLinkedTabShown(chatA, diff, false);

    useRightPanelStore.getState().closeSurface(refA, "files");
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(workspace.linkedTabsOf(chatA)).toEqual([{ key: diff, shown: false }]);

    // Opened again with every tab hidden, the panel shows them, not an empty tab.
    useRightPanelStore.getState().show(refA);
    expect(panes(workspace)).toEqual([[chatA, chatB], [diff]]);
    stop();
  });

  it("keep a hidden tab hidden across a reload", () => {
    const device = chatTabsDevice();
    const workspace = createWorkspace(() => device);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    workspace.setLinkedTabShown(chatA, diff, false);
    workspace.store.flush();
    stop();

    const reloaded = createWorkspace(() => device);
    expect(reloaded.linkedTabsOf(chatA)[0]).toEqual({ key: diff, shown: false });
    expect(panes(reloaded)).toEqual([[chatA, chatB], [chatSurfaceKey(chatA, "files")]]);
  });

  it("open a chat with no linked tabs one new tab in a pane beside it", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    expect(workspace.linkedTabsOf(chatA)).toEqual([]);
    workspace.newLinkedTab(chatA);
    expect(panes(workspace)).toEqual([[chatA, chatB], [expect.stringMatching(/^empty\//)]]);
    expect(workspace.linkedTabsOf(chatA).every((tab) => tab.shown)).toBe(true);
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
    expect(workspace.linkedTabsOf(chatA)).toEqual([{ key: files, shown: false }]);
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
    expect(workspace.linkedTabsOf(chatA)).toEqual([]);
    stop();
  });

  it("open a new chat right after the chat in front, which stays open, its linked tabs set aside", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    useRightPanelStore.getState().open(refA, "diff");
    const chatC = chatTabKey(scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-C")));
    workspace.openChat(chatC);
    expect(panes(workspace)).toEqual([[chatA, chatC, chatB]]);
    expect(leaves(workspace.arrangement().root)[0]?.active).toBe(chatC);
    expect(workspace.linked().front).toBe(chatC);
    expect(workspace.linked().owners[diff]).toBe(chatA);
    expect(workspace.linked().parked[diff]).toBeDefined();
    // Nothing was replaced, so the new tab has nowhere to go back to.
    expect(workspace.canStep("back")).toBe(false);
    workspace.openChat(chatA);
    expect(panes(workspace)).toEqual([[chatA, chatC, chatB], [diff]]);
    stop();
  });

  it("bring an open chat forward in its own pane rather than open it twice", () => {
    const workspace = createWorkspace(chatTabsDevice);
    workspace.update((arrangement) => splitTab(arrangement, chatB, "right"));
    workspace.update((arrangement) => focusPane(arrangement, "p0"));
    const paneB = leaves(workspace.arrangement().root)[1]!.id;
    workspace.openChat(chatB);
    expect(panes(workspace)).toEqual([[chatA], [chatB]]);
    expect(workspace.arrangement().focused).toBe(paneB);
  });

  it("open a new chat after the focused pane's tab in front when no chat is in front", () => {
    const file = (path: string) =>
      repositoryTabKey({
        kind: "file",
        environmentId: "env-1" as EnvironmentId,
        projectId: ProjectId.make("project-1"),
        checkout: { cwd: "/work/tree" },
        path,
      });
    const device = memoryStorage({
      [WORKSPACE_STORAGE_KEY]: JSON.stringify({
        root: {
          type: "branch",
          id: "p2",
          direction: "row",
          children: [
            { type: "leaf", id: "p0", tabs: [file("a.ts")], active: file("a.ts") },
            { type: "leaf", id: "p1", tabs: [file("b.ts"), file("c.ts")], active: file("b.ts") },
          ],
          weights: [1, 1],
        },
        focused: "p1",
        seq: 3,
        owners: {},
        parked: {},
        front: null,
      }),
    });
    const workspace = createWorkspace(() => device);
    workspace.openChat(chatA);
    expect(panes(workspace)).toEqual([[file("a.ts")], [file("b.ts"), chatA, file("c.ts")]]);
    expect(workspace.arrangement().focused).toBe("p1");
    expect(workspace.linked().front).toBe(chatA);
  });

  it("step the tab named back and forward, not the focused one", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const file = (path: string) =>
      repositoryTabKey({
        kind: "file",
        environmentId: "env-1" as EnvironmentId,
        projectId: ProjectId.make("project-1"),
        checkout: { cwd: "/work/tree" },
        path,
      });
    workspace.update((arrangement) => splitTab(arrangement, chatB, "right"));
    workspace.show(file("one.ts"), "p1");
    workspace.show(file("two.ts"), "p1");
    workspace.update((arrangement) => focusPane(arrangement, "p0"));
    expect(panes(workspace)).toEqual([[chatA], [chatB, file("two.ts")]]);

    expect(workspace.canStep("back")).toBe(false);
    expect(workspace.canStep("back", file("two.ts"))).toBe(true);
    workspace.step("back");
    expect(panes(workspace)).toEqual([[chatA], [chatB, file("two.ts")]]);

    workspace.step("back", file("two.ts"));
    expect(panes(workspace)).toEqual([[chatA], [chatB, file("one.ts")]]);
    expect(workspace.canStep("back", file("one.ts"))).toBe(false);
    expect(workspace.canStep("forward", file("one.ts"))).toBe(true);
    workspace.step("forward", file("one.ts"));
    expect(panes(workspace)).toEqual([[chatA], [chatB, file("two.ts")]]);
    expect(workspace.arrangement().focused).toBe("p0");
  });

  it("never step a tab to itself once the entries between are gone", () => {
    const one = repositoryTabKey({
      kind: "file",
      environmentId: "env-1" as EnvironmentId,
      projectId: ProjectId.make("project-1"),
      checkout: { cwd: "/work/tree" },
      path: "one.ts",
    });
    const device = memoryStorage({
      [WORKSPACE_STORAGE_KEY]: JSON.stringify({
        root: { type: "leaf", id: "p0", tabs: [one], active: one },
        focused: "p0",
        seq: 1,
        owners: {},
        parked: {},
        front: null,
      }),
      // The file came back in place of a tab whose key no longer reads.
      "astrolabe:workspace-tab-history:v1": JSON.stringify({
        [one]: { back: [one, "gone/1"], forward: [] },
      }),
    });
    const workspace = createWorkspace(() => device);
    expect(panes(workspace)).toEqual([[one]]);
    expect(workspace.canStep("back")).toBe(true);

    workspace.step("back");

    expect(panes(workspace)).toEqual([[one]]);
    expect(workspace.canStep("back")).toBe(false);
  });

  it("never step a chat back or forward, so its linked tabs never lose their chat", () => {
    const device = memoryStorage({
      [WORKSPACE_STORAGE_KEY]: JSON.stringify({
        root: { type: "leaf", id: "p0", tabs: [chatA], active: chatA },
        focused: "p0",
        seq: 1,
        owners: {},
        parked: {},
        front: chatA,
      }),
      // History saved before chats stopped taking each other's place.
      "astrolabe:workspace-tab-history:v1": JSON.stringify({
        [chatA]: { back: [chatB], forward: [] },
      }),
    });
    const workspace = createWorkspace(() => device);
    expect(workspace.canStep("back")).toBe(false);

    workspace.step("back");

    expect(panes(workspace)).toEqual([[chatA]]);
  });

  it("put a new chat in the New tab in focus, where it stood", () => {
    const workspace = createWorkspace(chatTabsDevice);
    workspace.update((arrangement) => splitTab(arrangement, chatB, "right"));
    workspace.update((arrangement) => newTab(arrangement, "p0"));
    const [[, blank]] = panes(workspace) as [[string, string]];
    const refC = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-C"));
    workspace.openChat(chatTabKey(refC));
    expect(panes(workspace)).toEqual([[chatA, chatTabKey(refC)], [chatB]]);
    expect(blank).toMatch(/^empty\//);
    expect(workspace.arrangement().focused).toBe("p0");
  });

  it("put the surface picked in a linked New tab in its place, linked", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "files");
    workspace.newLinkedTab(chatA);
    const linkedPane = leaves(workspace.arrangement().root)[1]!;
    const [files, blank] = linkedPane.tabs as [string, string];
    workspace.targetPane(linkedPane.id, blank);
    // The user looks at Files again before the diff they asked for arrives.
    workspace.update((arrangement) => activateTab(arrangement, files));
    useRightPanelStore.getState().open(refA, "diff");
    const diff = chatSurfaceKey(chatA, "diff");
    expect(panes(workspace)).toEqual([
      [chatA, chatB],
      [files, diff],
    ]);
    expect(workspace.linked().owners[diff]).toBe(chatA);
    stop();
  });

  it("open a thread's surface as its own tab in its place, letting the thread's record go", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().open(refA, "diff");
    const diff = chatSurfaceKey(chatA, "diff");
    const files = chatSurfaceKey(chatA, "files");
    const changes = repositoryTabKey({
      kind: "diff",
      environmentId: refA.environmentId,
      projectId: ProjectId.make("project-1"),
      checkout: { cwd: "/repo" },
      source: "working-tree",
    });
    workspace.openOnItsOwn(diff, changes);
    expect(panes(workspace)).toEqual([
      [chatA, chatB],
      [files, changes],
    ]);
    expect(workspace.linked().owners[changes]).toBeUndefined();
    const record = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA);
    expect(record.surfaces.map((surface) => surface.id)).toEqual(["files"]);
    // It stands on its own: another chat in front leaves it where it is.
    workspace.openChat(chatB);
    expect(panes(workspace)).toEqual([[chatA, chatB], [changes]]);
    stop();
  });

  it("keep a lone surface opened as its own tab, closing the chat's panel behind it", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "diff");
    const changes = "repo-diff:changes";
    workspace.openOnItsOwn(chatSurfaceKey(chatA, "diff"), changes);
    expect(panes(workspace)).toEqual([[chatA, chatB], [changes]]);
    expect(workspace.linkedTabsOf(chatA)).toEqual([]);
    stop();
  });

  it("bring hidden linked tabs straight back when the chat's panel shows again", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    const diff = chatSurfaceKey(chatA, "diff");
    const files = chatSurfaceKey(chatA, "files");
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().activateSurface(refA, "diff");
    // The right-panel shortcut, twice: hide, then show.
    useRightPanelStore.getState().toggleVisibility(refA);
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    useRightPanelStore.getState().toggleVisibility(refA);
    expect(panes(workspace)).toEqual([
      [chatA, chatB],
      [diff, files],
    ]);
    expect(leaves(workspace.arrangement().root)[1]?.active).toBe(diff);
    stop();
  });
});

describe("switching to Agents", () => {
  const file = repositoryTabKey({
    kind: "file",
    environmentId: "env-1" as EnvironmentId,
    projectId: ProjectId.make("project-1"),
    checkout: { cwd: "/repo" },
    path: "README.md",
  });
  const terminal = chatSurfaceKey(chatA, "terminal:t1");
  const routeOf = (chatKey: string): ChatRoute | null =>
    chatKey === chatA ? { kind: "thread", ref: refA } : null;

  /** Chats A and B in one pane, A's terminal beside them, and a repository file focused. */
  function threePanes() {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().openTerminal(refA, "t1");
    workspace.open(file, "beside");
    return { workspace, stop };
  }
  const paneOf = (workspace: ReturnType<typeof createWorkspace>, key: string) =>
    leaves(workspace.arrangement().root).find((leaf) => leaf.tabs.includes(key))?.id ?? "";

  it("selects the focused chat's thread, or the thread a focused linked tab belongs to", () => {
    const { workspace, stop } = threePanes();
    expect(panes(workspace)).toEqual([[chatA, chatB], [file], [terminal]]);
    expect(focusedChatOf(workspace.linked())).toBeNull();
    workspace.update((arrangement) => focusPane(arrangement, paneOf(workspace, chatA)));
    expect(focusedChatOf(workspace.linked())).toBe(chatA);
    workspace.update((arrangement) => focusPane(arrangement, paneOf(workspace, terminal)));
    expect(focusedChatOf(workspace.linked())).toBe(chatA);
    workspace.update((arrangement) => newTab(arrangement));
    expect(focusedChatOf(workspace.linked())).toBeNull();
    stop();
  });

  it("selects no thread for a tab linked to a change group", () => {
    const { workspace, stop } = threePanes();
    const linked = linkTab(workspace.linked(), file, "change-group:env-1:thread-A");
    expect(focusedChatOf(linked)).toBeNull();
    stop();
  });

  it("leads to the start page with a file in focus, leaving the panes as they stand", () => {
    const { workspace, stop } = threePanes();
    const before = workspace.linked();
    expect(agentsRoute(before, routeOf)).toEqual({ to: "/" });
    expect(workspace.linked()).toBe(before);
    stop();
  });

  it("leads to the thread of a focused linked tab, whose route leaves it in front", () => {
    const { workspace, stop } = threePanes();
    workspace.update((arrangement) => focusPane(arrangement, paneOf(workspace, terminal)));
    const before = workspace.linked();
    expect(before.front).toBe(chatA);
    expect(agentsRoute(before, routeOf)).toEqual({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-1", threadId: "thread-A" },
    });
    // As the thread's route arrives: focus stays on the terminal, nothing moves.
    workspace.openChat(chatA);
    expect(workspace.linked()).toBe(before);
    stop();
  });

  it("leads to the start page for a chat gone", () => {
    const { workspace, stop } = threePanes();
    workspace.update((arrangement) => activateTab(arrangement, chatB));
    expect(agentsRoute(workspace.linked(), routeOf)).toEqual({ to: "/" });
    stop();
  });
});

describe("a thread's surface on its own", () => {
  const checkout = {
    environmentId: "env-1" as EnvironmentId,
    projectId: ProjectId.make("project-1"),
    checkout: { cwd: "/work/tree" },
  };

  it("is a file of the thread's checkout for a file, and its uncommitted changes for the diff", () => {
    useRightPanelStore.getState().openFile(refA, "src/app.ts");
    const [file] = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      refA,
    ).surfaces;
    expect(standaloneKeyOf(file!, checkout)).toBe(
      repositoryTabKey({ kind: "file", ...checkout, path: "src/app.ts" }),
    );
    expect(standaloneKeyOf({ id: "diff", kind: "diff" }, checkout)).toBe(
      repositoryTabKey({ kind: "diff", ...checkout, source: "working-tree" }),
    );
  });

  it("is the pull request named in full, which reads on its own", () => {
    const surface = pullRequestSurface({
      projectId: "project-1",
      host: "github.com",
      repository: "acme/app",
      number: 7,
    });
    expect(standaloneKeyOf(surface, checkout)).toBe(
      surfaceKey(pullRequestSurface({ ...surface, environmentId: "env-1", host: "github.com" }).id),
    );
    // Without its host the key would not read on its own.
    const { host: _host, ...hostless } = surface;
    expect(standaloneKeyOf(hostless, checkout)).toBeNull();
  });

  it("is nothing for a surface that means nothing without its thread", () => {
    expect(standaloneKeyOf({ id: "graph", kind: "graph" }, checkout)).toBeNull();
    expect(standaloneKeyOf({ id: "files", kind: "files" }, checkout)).toBeNull();
  });
});

describe("a sidebar click with a chat in front", () => {
  const file = (path: string) =>
    repositoryTabKey({
      kind: "file",
      environmentId: "env-1" as EnvironmentId,
      projectId: ProjectId.make("project-1"),
      checkout: { cwd: "/repo" },
      path,
    });

  it("shows beside the chat: in the pane beside it, else a split with room, else a tab", () => {
    using _width = { [Symbol.dispose]: () => setPanesWidthPx(null) };
    const wide = createWorkspace(() => memoryStorage());
    wide.openChat(chatA);
    setPanesWidthPx(1200);
    wide.show(file("a.ts"));
    expect(panes(wide)).toEqual([[chatA], [file("a.ts")]]);
    wide.update((arrangement) => focusPane(arrangement, leaves(arrangement.root)[0]!.id));
    wide.show(file("b.ts"));
    expect(panes(wide)).toEqual([[chatA], [file("b.ts")]]);

    const narrow = createWorkspace(() => memoryStorage());
    narrow.openChat(chatA);
    setPanesWidthPx(700);
    narrow.show(file("a.ts"));
    expect(panes(narrow)).toEqual([[chatA, file("a.ts")]]);
  });
});

describe("results tabs", () => {
  const checkout = {
    environmentId: "env-1" as EnvironmentId,
    projectId: ProjectId.make("project-1"),
    cwd: "/repo",
  };
  const file = (path: string) =>
    repositoryTabKey({
      kind: "file",
      environmentId: checkout.environmentId,
      projectId: checkout.projectId,
      checkout: { cwd: checkout.cwd },
      path,
    });

  it("keep their place: a sidebar click or a step opens beside them", () => {
    const workspace = createWorkspace(() => memoryStorage());
    const problems = repositoryTabKey({ kind: "problems", ...checkout });
    workspace.show(file("a.ts"));
    workspace.show(file("b.ts"));
    expect(panes(workspace)).toEqual([[file("b.ts")]]);
    workspace.step("back");
    expect(panes(workspace)).toEqual([[file("a.ts")]]);

    workspace.show(problems);
    expect(panes(workspace)).toEqual([[problems]]);
    workspace.show(file("c.ts"));
    expect(panes(workspace)).toEqual([[problems, file("c.ts")]]);
    workspace.open(problems);
    workspace.step("back");
    expect(panes(workspace)).toEqual([[problems, file("a.ts"), file("c.ts")]]);
  });

  it("step back through a jump to its line first, then through the tab's own history", () => {
    const workspace = createWorkspace(() => memoryStorage());
    const from = file("jump-from.ts");
    const landed = file("jump-landed.ts");
    workspace.show(file("before.ts"));
    workspace.show(from);
    using _cursor = { [Symbol.dispose]: trackJumpCursor(from, () => ({ line: 7, column: 3 })) };
    recordJump(from, landed);
    workspace.open(landed);
    expect(workspace.canStep("back", landed)).toBe(true);

    workspace.step("back");
    expect(focusedPane(workspace.arrangement()).active).toBe(from);
    expect(repositoryFileReveal.get()).toMatchObject({ tabKey: from, line: 7, column: 3 });

    workspace.step("forward");
    expect(focusedPane(workspace.arrangement()).active).toBe(landed);

    workspace.step("back");
    workspace.step("back");
    expect(focusedPane(workspace.arrangement()).active).toBe(file("before.ts"));
  });
});

describe("a chat's terminal tab", () => {
  const terminalA = chatTerminalKey(chatA);
  const terminalB = chatTerminalKey(chatB);
  const terminals = () => useTerminalUiStateStore.getState();

  function withChats() {
    const layout = layoutSettings();
    const workspace = createWorkspace(() => chatTabsDevice(), layout.behavior);
    const stop = workspace.follow();
    return { workspace, stop, layout };
  }

  it("follows the thread's terminal record, whatever opened it", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA]]);
    expect(workspace.linked().owners[terminalA]).toBe(chatA);
    terminals().setTerminalOpen(refA, false);
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(workspace.linked().parked[terminalA]?.hidden).toBe(true);
    stop();
  });

  it("minimizes apart from its chat's panel, which goes with its last tab", () => {
    const { workspace, stop } = withChats();
    const diff = chatSurfaceKey(chatA, "diff");
    useRightPanelStore.getState().open(refA, "diff");
    terminals().setTerminalOpen(refA, true);
    let hidden = 0;
    const hide = () => {
      hidden += 1;
      useRightPanelStore.getState().close(refA);
    };
    workspace.setPanel({ onHide: hide } as unknown as Parameters<typeof workspace.setPanel>[0]);
    expect(workspace.minimizeLinkedTab(diff)).toBe(true);
    expect(hidden).toBe(1);
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA]]);
    expect(workspace.minimizeLinkedTab(terminalA)).toBe(true);
    expect(hidden).toBe(1);
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(workspace.linkedTabsOf(chatA)).toContainEqual({ key: terminalA, shown: false });
    stop();
  });

  it("opens from a stored layout with none, for a thread already left open", () => {
    terminals().setTerminalOpen(refA, true);
    const workspace = createWorkspace(() => chatTabsDevice());
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA]]);
  });

  it("hides and comes back in the same pane, and hands focus to the chat", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    workspace.update((arrangement) => activateTab(arrangement, terminalA));
    expect(focusedChatOf(workspace.linked())).toBe(chatA);
    terminals().setTerminalOpen(refA, false);
    expect(workspace.arrangement().focused).toBe(leaves(workspace.arrangement().root)[0]?.id);
    expect(workspace.linked().front).toBe(chatA);
    terminals().setTerminalOpen(refA, true);
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA]]);
    stop();
  });

  it("parks with its chat, and comes back with it", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    workspace.update((arrangement) => activateTab(arrangement, chatB));
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(workspace.linked().parked[terminalA]?.hidden).toBeUndefined();
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA]]);
    stop();
  });

  it("keeps each thread's own", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    workspace.update((arrangement) => activateTab(arrangement, chatB));
    terminals().setTerminalOpen(refB, true);
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalB]]);
    stop();
  });

  it("stands apart from the panel: toggling either leaves the other", () => {
    const { workspace, stop } = withChats();
    useRightPanelStore.getState().open(refA, "diff");
    terminals().setTerminalOpen(refA, true);
    const diff = chatSurfaceKey(chatA, "diff");
    // Below the chat's pane alone: the diff beside it keeps its full height.
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA], [diff]]);
    useRightPanelStore.getState().close(refA);
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA]]);
    useRightPanelStore.getState().show(refA);
    terminals().setTerminalOpen(refA, false);
    expect(panes(workspace)).toEqual([[chatA, chatB], [diff]]);
    stop();
  });

  it("keeps the panel closing with its last side tab, the terminal aside", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().closeSurface(refA, "diff");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).isOpen,
    ).toBe(false);
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA]]);
    stop();
  });

  it("is listed by the filter and answers it through the record", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    expect(workspace.linkedTabsOf(chatA)).toEqual([{ key: terminalA, shown: true }]);
    workspace.setLinkedTabShown(chatA, terminalA, false);
    expect(workspace.linkedTabsOf(chatA)).toEqual([{ key: terminalA, shown: false }]);
    expect(terminals().terminalUiStateByThreadKey[scopedThreadKey(refA)]?.terminalOpen).toBe(false);
    workspace.setLinkedTabShown(chatA, terminalA, true);
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA]]);
    stop();
  });

  it("closes as hidden, its sessions running, and asks to be restored", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    workspace.closeTerminalTab(terminalA);
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(useClosedViewStore.getState().entries.map((entry) => entry.kind)).toEqual([
      "terminal-tab",
    ]);
    expect(
      terminals().terminalUiStateByThreadKey[scopedThreadKey(refA)]?.terminalIds.length,
    ).toBeGreaterThan(0);
    stop();
  });

  it("goes for good with its last terminal", () => {
    const { workspace, stop } = withChats();
    terminals().ensureTerminal(refA, "term-1", { open: true, active: true });
    terminals().closeTerminal(refA, "term-1");
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    expect(workspace.linked().parked[terminalA]).toBeUndefined();
    expect(workspace.linked().owners[terminalA]).toBeUndefined();
    stop();
  });

  it("comes back with its chat closed and reopened, as its sessions never ended", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    workspace.close(chatA);
    expect(panes(workspace)).toEqual([[chatB]]);
    workspace.openChat(chatA);
    expect(workspace.linked().owners[terminalA]).toBe(chatA);
    expect(panes(workspace).flat()).toContain(terminalA);
    stop();
  });

  it("asked for by name comes to the front once, and from under a maximized pane", () => {
    const { workspace, stop } = withChats();
    terminals().ensureTerminal(refA, "term-1", { open: true, active: true });
    const paneId = leaves(workspace.arrangement().root)[1]?.id ?? "";
    workspace.update((arrangement) => openTab(arrangement, "wiki:e:note", paneId, false));
    useMaximizedPaneStore.getState().toggle(WORKSPACE_LAYOUT_KEY, "p0");
    focusTerminal(refA, "term-1");
    expect(leaves(workspace.arrangement().root)[1]?.active).toBe(terminalA);
    expect(useMaximizedPaneStore.getState().maximized).toBeNull();
    // The request still waits (nothing is mounted here); moving on must not pull focus back.
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    expect(focusedChatOf(workspace.linked())).toBe(chatA);
    expect(workspace.arrangement().focused).toBe(leaves(workspace.arrangement().root)[0]?.id);
    stop();
  });

  it("stands in the chat's pane as a tab, and moves below once the setting changes", () => {
    const { workspace, stop, layout } = withChats();
    layout.set({ terminalPlacement: "new-tab", newTabPosition: "after-current" });
    terminals().setTerminalOpen(refA, true);
    expect(panes(workspace)).toEqual([[chatA, terminalA, chatB]]);
    layout.set({});
    expect(panes(workspace)).toEqual([[chatA, chatB], [terminalA]]);
    stop();
  });

  it("joins after the chat, behind it, when the setting changes and the thread comes back", () => {
    const { workspace, stop, layout } = withChats();
    terminals().setTerminalOpen(refA, true);
    layout.set({ terminalPlacement: "new-tab" });
    workspace.update((arrangement) => activateTab(arrangement, chatB));
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    expect(panes(workspace)).toEqual([[chatA, chatB, terminalA]]);
    expect(leaves(workspace.arrangement().root)[0]?.active).toBe(chatA);
    stop();
  });

  it("joins after the chat, in front, shown on purpose once the setting changed", () => {
    const { workspace, stop, layout } = withChats();
    terminals().setTerminalOpen(refA, true);
    layout.set({ terminalPlacement: "new-tab", newTabPosition: "after-current" });
    terminals().setTerminalOpen(refA, false);
    terminals().setTerminalOpen(refA, true);
    expect(panes(workspace)).toEqual([[chatA, terminalA, chatB]]);
    expect(leaves(workspace.arrangement().root)[0]?.active).toBe(terminalA);
    stop();
  });

  it("hides from the panes on mod+j only while it can be seen", () => {
    const { workspace, stop } = withChats();
    terminals().ensureTerminal(refA, "term-1", { open: true, active: true });
    const paneId = leaves(workspace.arrangement().root)[1]?.id ?? "";
    expect(workspace.terminalOnScreen(chatA)).toBe(true);
    expect(workspace.revealTerminal(chatA)).toBe(false);

    // Behind another tab of its pane.
    workspace.update((arrangement) => openTab(arrangement, "wiki:e:note", paneId, false));
    expect(workspace.terminalOnScreen(chatA)).toBe(false);
    expect(workspace.revealTerminal(chatA)).toBe(true);
    expect(leaves(workspace.arrangement().root)[1]?.active).toBe(terminalA);
    expect(workspace.arrangement().focused).toBe(paneId);

    // Covered by a pane maximized over it.
    useMaximizedPaneStore.getState().toggle(WORKSPACE_LAYOUT_KEY, "p0");
    expect(workspace.terminalOnScreen(chatA)).toBe(false);
    expect(workspace.revealTerminal(chatA)).toBe(true);
    expect(useMaximizedPaneStore.getState().maximized).toBeNull();

    // Its own pane maximized is on screen.
    useMaximizedPaneStore.getState().toggle(WORKSPACE_LAYOUT_KEY, paneId);
    expect(workspace.terminalOnScreen(chatA)).toBe(true);
    stop();
  });

  it("hands focus to its chat as it hides, not as it opens or as another chat's parks", () => {
    const { workspace, stop } = withChats();
    let focused = 0;
    using _lent = {
      [Symbol.dispose]: lendChat(chatA, chatBridge({ focusComposer: () => void (focused += 1) })),
    };
    terminals().setTerminalOpen(refA, true);
    expect(focused).toBe(0);
    workspace.update((arrangement) => activateTab(arrangement, chatB));
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    expect(focused).toBe(0);
    terminals().setTerminalOpen(refA, false);
    expect(focused).toBe(1);
    // Its last shell ending hands focus over only from the terminal itself, never from elsewhere.
    terminals().setTerminalOpen(refA, true);
    terminals().closeTerminal(refA, DEFAULT_THREAD_TERMINAL_ID);
    expect(focused).toBe(1);
    terminals().setTerminalOpen(refA, true);
    const terminalPane = leafWithTab(workspace.arrangement().root, chatTerminalKey(chatA))!.id;
    workspace.update((arrangement) => focusPane(arrangement, terminalPane));
    terminals().closeTerminal(refA, DEFAULT_THREAD_TERMINAL_ID);
    expect(focused).toBe(2);
    stop();
  });

  it("comes back to the side it was dragged to, its chat closed and reopened", () => {
    const device = memoryStorage();
    const workspace = createWorkspace(() => device, layoutSettings().behavior);
    const stop = workspace.follow();
    workspace.openChat(chatA);
    terminals().setTerminalOpen(refA, true);
    const chatPane = leaves(workspace.arrangement().root)[0]?.id ?? "";
    workspace.update((arrangement) => splitWithTabs(arrangement, [terminalA], chatPane, "right"));
    const direction = () => (workspace.arrangement().root as Branch).direction;
    expect(direction()).toBe("row");

    workspace.close(chatA);
    expect(allTabs(workspace.arrangement())).not.toContain(terminalA);
    workspace.openChat(chatA);
    expect(allTabs(workspace.arrangement())).toEqual([chatA, terminalA]);
    expect(direction()).toBe("row");
    stop();
  });

  it("is forgotten, once its closed chat's thread has no terminals left", () => {
    const { workspace, stop } = withChats();
    terminals().ensureTerminal(refA, "term-1", { open: true, active: true });
    workspace.close(chatA);
    expect(workspace.linked().parked[terminalA]).toBeDefined();
    terminals().closeTerminal(refA, "term-1");
    expect(workspace.linked().parked[terminalA]).toBeUndefined();
    expect(workspace.linked().owners[terminalA]).toBeUndefined();
    stop();
  });
});

describe("a chat's linked tabs across a switch", () => {
  const terminalA = chatTerminalKey(chatA);
  const terminalB = chatTerminalKey(chatB);
  const diffA = chatSurfaceKey(chatA, "diff");
  const terminals = () => useTerminalUiStateStore.getState();
  const show = (workspace: ReturnType<typeof createWorkspace>, chat: string) =>
    workspace.update((arrangement) => activateTab(arrangement, chat));
  const shape = (node: SplitNode): unknown =>
    node.type === "leaf" ? node.tabs : { [node.direction]: node.children.map(shape) };
  /** A pane's share of the whole area. */
  const areaOf = (node: SplitNode, id: string, room = 1): number | null => {
    if (node.type === "leaf") return node.id === id ? room : null;
    const total = node.weights.reduce((sum, weight) => sum + weight, 0);
    for (const [index, child] of node.children.entries()) {
      const area = areaOf(child, id, (room * (node.weights[index] ?? 1)) / total);
      if (area !== null) return area;
    }
    return null;
  };
  const shareOf = (workspace: ReturnType<typeof createWorkspace>, key: string) => {
    const { root } = workspace.arrangement();
    return areaOf(root, leafWithTab(root, key)?.id ?? "");
  };
  function withChats(device = chatTabsDevice()) {
    const workspace = createWorkspace(() => device, layoutSettings().behavior);
    return { workspace, stop: workspace.follow() };
  }

  it("leave a terminal's size as it was over round trips between two chats with terminals", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    show(workspace, chatB);
    terminals().setTerminalOpen(refB, true);
    const shareA = shareOf(workspace, terminalB);
    for (let trip = 0; trip < 4; trip += 1) {
      show(workspace, chatA);
      expect(shareOf(workspace, terminalA)).toBeCloseTo(shareA ?? 0);
      show(workspace, chatB);
      expect(shareOf(workspace, terminalB)).toBeCloseTo(shareA ?? 0);
    }
    stop();
  });

  it("keep a terminal spanning the chat and its side tab across thread switches", () => {
    const { workspace, stop } = withChats();
    terminals().setTerminalOpen(refA, true);
    useRightPanelStore.getState().open(refA, "diff");
    const arranged = { column: [{ row: [[chatA, chatB], [diffA]] }, [terminalA]] };
    expect(shape(workspace.arrangement().root)).toEqual(arranged);
    for (let trip = 0; trip < 3; trip += 1) {
      show(workspace, chatB);
      show(workspace, chatA);
      expect(shape(workspace.arrangement().root)).toEqual(arranged);
    }
    stop();
  });

  it("keep a terminal below the chat alone, the side tab at full height, the same way", () => {
    const { workspace, stop } = withChats();
    useRightPanelStore.getState().open(refA, "diff");
    terminals().setTerminalOpen(refA, true);
    const arranged = { row: [{ column: [[chatA, chatB], [terminalA]] }, [diffA]] };
    expect(shape(workspace.arrangement().root)).toEqual(arranged);
    show(workspace, chatB);
    show(workspace, chatA);
    expect(shape(workspace.arrangement().root)).toEqual(arranged);
    stop();
  });

  it("never widen a terminal over a pane it did not span, returning after a switch", () => {
    const { workspace, stop } = withChats();
    workspace.update((arrangement) => splitTab(arrangement, chatB, "right"));
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    terminals().setTerminalOpen(refA, true);
    useRightPanelStore.getState().open(refA, "diff");
    const arranged = { row: [{ column: [{ row: [[chatA], [diffA]] }, [terminalA]] }, [chatB]] };
    expect(shape(workspace.arrangement().root)).toEqual(arranged);
    const shareOfTerminal = shareOf(workspace, terminalA);
    const shareOfB = shareOf(workspace, chatB);
    for (let trip = 0; trip < 3; trip += 1) {
      show(workspace, chatB);
      show(workspace, chatA);
      expect(shape(workspace.arrangement().root)).toEqual(arranged);
      expect(shareOf(workspace, terminalA)).toBeCloseTo(shareOfTerminal ?? 0);
      expect(shareOf(workspace, chatB)).toBeCloseTo(shareOfB ?? 0);
    }
    stop();
  });

  it("never widen a terminal over a pane it did not span, hidden and shown", () => {
    const note = "wiki:e:note";
    const { workspace, stop } = withChats();
    workspace.update((arrangement) => openBeside(arrangement, note, "p0", "right"));
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    terminals().setTerminalOpen(refA, true);
    useRightPanelStore.getState().open(refA, "diff");
    const arranged = shape(workspace.arrangement().root);
    terminals().setTerminalOpen(refA, false);
    terminals().setTerminalOpen(refA, true);
    expect(shape(workspace.arrangement().root)).toEqual(arranged);
    stop();
  });

  it("fall back to below the chat alone when what it spanned no longer stands together", () => {
    const [noteA, noteB] = ["wiki:e:a", "wiki:e:b"];
    const { workspace, stop } = withChats(memoryStorage());
    workspace.openChat(chatA);
    terminals().setTerminalOpen(refA, true);
    const chatPane = () => leafWithTab(workspace.arrangement().root, chatA)?.id ?? "";
    workspace.update((arrangement) => openBeside(arrangement, noteA, chatPane(), "right"));
    expect(shape(workspace.arrangement().root)).toEqual({
      column: [{ row: [[chatA], [noteA]] }, [terminalA]],
    });
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    terminals().setTerminalOpen(refA, false);
    // A pane now stands between the two it spanned.
    workspace.update((arrangement) => openBeside(arrangement, noteB, chatPane(), "right"));
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    terminals().setTerminalOpen(refA, true);
    expect(shape(workspace.arrangement().root)).toEqual({
      row: [{ column: [[chatA], [terminalA]] }, [noteB], [noteA]],
    });
    stop();
  });

  it("keep that arrangement with a sole chat closed and reopened", () => {
    const { workspace, stop } = withChats(memoryStorage());
    workspace.openChat(chatA);
    terminals().setTerminalOpen(refA, true);
    useRightPanelStore.getState().open(refA, "diff");
    const arranged = { column: [{ row: [[chatA], [diffA]] }, [terminalA]] };
    expect(shape(workspace.arrangement().root)).toEqual(arranged);
    workspace.close(chatA);
    workspace.openChat(chatA);
    expect(shape(workspace.arrangement().root)).toEqual(arranged);
    stop();
  });

  it("bring a terminal back below its chat, reopened in another pane", () => {
    const note = "wiki:e:note";
    const { workspace, stop } = withChats();
    workspace.update((arrangement) => splitTab(arrangement, chatB, "right"));
    workspace.update((arrangement) => openTab(arrangement, note, "p0", false));
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    terminals().setTerminalOpen(refA, true);
    workspace.close(chatA);
    workspace.openChat(chatA);
    expect(shape(workspace.arrangement().root)).toEqual({
      row: [[note], { column: [[chatB, chatA], [terminalA]] }],
    });
    stop();
  });

  it("bring a hidden terminal back below its chat, dragged to another pane meanwhile", () => {
    const note = "wiki:e:note";
    const { workspace, stop } = withChats();
    workspace.update((arrangement) => splitTab(arrangement, chatB, "right"));
    workspace.update((arrangement) => openTab(arrangement, note, "p0", false));
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    terminals().setTerminalOpen(refA, true);
    terminals().setTerminalOpen(refA, false);
    const right = leafWithTab(workspace.arrangement().root, chatB)?.id ?? "";
    workspace.update((arrangement) => moveTabs(arrangement, [chatA], right));
    terminals().setTerminalOpen(refA, true);
    expect(shape(workspace.arrangement().root)).toEqual({
      row: [[note], { column: [[chatB, chatA], [terminalA]] }],
    });
    stop();
  });

  it("bring back a terminal dragged below another pane where it stood, its chat elsewhere", () => {
    const note = "wiki:e:note";
    const { workspace, stop } = withChats();
    workspace.update((arrangement) => openBeside(arrangement, note, "p0", "right"));
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    terminals().setTerminalOpen(refA, true);
    const notePane = leafWithTab(workspace.arrangement().root, note)?.id ?? "";
    workspace.update((arrangement) => splitWithTabs(arrangement, [terminalA], notePane, "bottom"));
    workspace.update((arrangement) => activateTab(arrangement, chatA));
    const arranged = { row: [[chatA, chatB], { column: [[note], [terminalA]] }] };
    expect(shape(workspace.arrangement().root)).toEqual(arranged);
    terminals().setTerminalOpen(refA, false);
    terminals().setTerminalOpen(refA, true);
    expect(shape(workspace.arrangement().root)).toEqual(arranged);
    stop();
  });
});

describe("the side pane's setting on a thread with linked tabs", () => {
  const note = "wiki:e:note";
  function withBridge() {
    const workspace = createWorkspace(() => chatTabsDevice(), layoutSettings().behavior);
    const stop = workspace.follow();
    let opened = 0;
    const stopLending = lendChat(
      chatA,
      chatBridge({
        openSidePane: () => {
          opened += 1;
          return true;
        },
      }),
    );
    return {
      workspace,
      opens: () => opened,
      stop: () => {
        stopLending();
        stop();
      },
    };
  }

  it("leaves New linked tab a New tab beside a linked document", () => {
    const { workspace, opens, stop } = withBridge();
    workspace.openLinked(note, chatA);
    workspace.newLinkedTab(chatA);
    expect(opens()).toBe(0);
    expect(workspace.sidePaneEmpty(chatA)).toBe(false);
    expect(panes(workspace)[1]).toContain(note);
    expect(panes(workspace)[1]?.at(-1)).toMatch(/^empty\//);
    stop();
  });

  it("leaves New linked tab a New tab beside a terminal that shows", () => {
    const { workspace, opens, stop } = withBridge();
    useTerminalUiStateStore.getState().setTerminalOpen(refA, true);
    workspace.newLinkedTab(chatA);
    expect(opens()).toBe(0);
    stop();
  });

  it("still applies with only a hidden terminal, where the header shows its one button", () => {
    const { workspace, opens, stop } = withBridge();
    useTerminalUiStateStore.getState().setTerminalOpen(refA, true);
    useTerminalUiStateStore.getState().setTerminalOpen(refA, false);
    expect(workspace.sidePaneEmpty(chatA)).toBe(true);
    workspace.newLinkedTab(chatA);
    expect(opens()).toBe(1);
    stop();
  });
});

describe("mod+j with a tab of no chat's in front of the terminal", () => {
  it("answers from the pane holding the terminal, and from no other", () => {
    const terminal = chatTerminalKey(chatA);
    const workspace = createWorkspace(() => chatTabsDevice(), layoutSettings().behavior);
    const stop = workspace.follow();
    useTerminalUiStateStore.getState().setTerminalOpen(refA, true);
    expect(workspace.terminalBehindFocusedTab()).toBeNull();
    const pane = leafWithTab(workspace.arrangement().root, terminal)?.id ?? "";
    workspace.update((arrangement) => focusPane(newTab(arrangement, pane), pane));
    expect(workspace.terminalBehindFocusedTab()).toBe(chatA);
    // An unrelated file in another pane holds no terminal to bring forward.
    workspace.update((arrangement) => openBeside(arrangement, "wiki:e:note", "p0", "right"));
    expect(workspace.terminalBehindFocusedTab()).toBeNull();
    stop();
  });
});

describe("the layout settings", () => {
  it("open a thread's side tabs among the chat's, at the end when asked", () => {
    const layout = layoutSettings();
    const workspace = createWorkspace(() => chatTabsDevice(), layout.behavior);
    const stop = workspace.follow();
    layout.set({ sidePanePlacement: "new-tab", newTabPosition: "end" });
    useRightPanelStore.getState().open(refA, "diff");
    expect(panes(workspace)).toEqual([[chatA, chatB, chatSurfaceKey(chatA, "diff")]]);
    stop();
  });

  it("leave a chat opening after the chat in front, whichever the new tab position", () => {
    const refC = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-C"));
    for (const newTabPosition of ["end", "after-current"] as const) {
      const layout = layoutSettings();
      const workspace = createWorkspace(() => chatTabsDevice(), layout.behavior);
      layout.set({ newTabPosition });
      workspace.openChat(chatTabKey(refC));
      expect(panes(workspace)).toEqual([[chatA, chatTabKey(refC), chatB]]);
    }
  });

  it("put a new surface after an unlinked tab, as before they knew of tab positions", () => {
    const file = "wiki:e:note";
    const diff = chatSurfaceKey(chatA, "diff");
    const workspace = createWorkspace(() => chatTabsDevice(), layoutSettings().behavior);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "diff");
    const pane = leafWithTab(workspace.arrangement().root, diff)?.id ?? "";
    workspace.update((arrangement) => openTab(arrangement, file, pane, false));
    useRightPanelStore.getState().close(refA);
    expect(panes(workspace)).toEqual([[chatA, chatB], [file]]);
    useRightPanelStore.getState().open(refA, "files");
    expect(panes(workspace)[1]).toEqual([diff, file, chatSurfaceKey(chatA, "files")]);
    stop();
  });

  it("put a new linked tab at the end by default, after the current one when asked", () => {
    const layout = layoutSettings();
    const workspace = createWorkspace(() => chatTabsDevice(), layout.behavior);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "files");
    const [diff, files] = [chatSurfaceKey(chatA, "diff"), chatSurfaceKey(chatA, "files")];
    workspace.update((arrangement) => activateTab(arrangement, diff, false));
    workspace.newLinkedTab(chatA);
    expect(leaves(workspace.arrangement().root)[1]?.tabs).toEqual([
      diff,
      files,
      expect.stringMatching(/^empty\//),
    ]);
    layout.set({ newTabPosition: "after-current" });
    workspace.update((arrangement) => activateTab(arrangement, diff, false));
    workspace.newLinkedTab(chatA);
    expect(leaves(workspace.arrangement().root)[1]?.tabs.slice(0, 2)).toEqual([
      diff,
      expect.stringMatching(/^empty\//),
    ]);
    stop();
  });

  describe("across a reload", () => {
    const diff = chatSurfaceKey(chatA, "diff");
    const stored = () =>
      memoryStorage({
        [WORKSPACE_STORAGE_KEY]: JSON.stringify({
          root: { type: "leaf", id: "p0", tabs: [chatA, diff], active: chatA },
          focused: "p0",
          seq: 2,
          owners: { [diff]: chatA },
          parked: {},
          front: chatA,
        }),
      });

    it("leave a tab in its chat's pane until the settings are read, then keep it there", () => {
      useRightPanelStore.getState().open(refA, "diff");
      const device = stored();
      const layout = layoutSettings(false);
      const workspace = createWorkspace(() => device, layout.behavior);
      const stop = workspace.follow();
      expect(panes(workspace)).toEqual([[chatA, diff]]);
      layout.set({ sidePanePlacement: "new-tab" });
      expect(panes(workspace)).toEqual([[chatA, diff]]);
      stop();
    });

    it("place a surface the stored panes lack once the settings are read", () => {
      useRightPanelStore.getState().open(refA, "diff");
      const device = memoryStorage({
        [WORKSPACE_STORAGE_KEY]: JSON.stringify({
          root: { type: "leaf", id: "p0", tabs: [chatA], active: chatA },
          focused: "p0",
          seq: 1,
          owners: {},
          parked: {},
          front: chatA,
        }),
      });
      const layout = layoutSettings(false);
      const workspace = createWorkspace(() => device, layout.behavior);
      const stop = workspace.follow();
      expect(panes(workspace)).toEqual([[chatA]]);
      layout.set({ sidePanePlacement: "new-tab" });
      expect(panes(workspace)).toEqual([[chatA, diff]]);
      stop();
    });

    it("move it out once the settings turn out not to ask for it", () => {
      useRightPanelStore.getState().open(refA, "diff");
      const device = stored();
      const layout = layoutSettings(false);
      const workspace = createWorkspace(() => device, layout.behavior);
      const stop = workspace.follow();
      layout.set({});
      expect(panes(workspace)).toEqual([[chatA], [diff]]);
      stop();
    });
  });
});

describe("whether client settings are settled", () => {
  it("stays so once a first read has ended, a retry included", () => {
    expect(settingsSettled("pending")).toBe(false);
    expect(settingsSettled("ready")).toBe(true);
    expect(settingsSettled("failed")).toBe(true);
    expect(settingsSettled("retrying")).toBe(true);
  });
});

describe("the side pane's default", () => {
  it("opens from the header's New linked tab, and a thread with none set gets the New tab", () => {
    const workspace = createWorkspace(() => chatTabsDevice(), layoutSettings().behavior);
    const stop = workspace.follow();
    let opened = 0;
    let opens = true;
    using _lent = {
      [Symbol.dispose]: lendChat(
        chatA,
        chatBridge({
          openSidePane: () => {
            opened += 1;
            return opens;
          },
        }),
      ),
    };
    workspace.newLinkedTab(chatA);
    expect(opened).toBe(1);
    expect(panes(workspace)).toEqual([[chatA, chatB]]);
    opens = false;
    workspace.newLinkedTab(chatA);
    expect(panes(workspace)[1]).toEqual([expect.stringMatching(/^empty\//)]);
    stop();
  });
});

describe("Show all in the linked tabs filter", () => {
  it("opens no side panel with only the terminal to show", () => {
    const workspace = createWorkspace(() => chatTabsDevice(), layoutSettings().behavior);
    const stop = workspace.follow();
    const terminals = useTerminalUiStateStore.getState();
    terminals.setTerminalOpen(refA, true);
    terminals.setTerminalOpen(refA, false);
    workspace.showAllLinkedTabs(chatA);
    expect(panes(workspace)).toEqual([[chatA, chatB], [chatTerminalKey(chatA)]]);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, refA).isOpen,
    ).toBe(false);
    stop();
  });
});

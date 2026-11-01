import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { repositoryTabKey } from "../components/repositories/repositoryTabs";
import {
  pullRequestSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
} from "../rightPanelStore";
import { chatSurfaceKey, chatTabKey } from "../sectionTabs/sectionTabs";
import type { ChatRoute } from "../chatTabs/chatTabLabel";
import { agentsRoute } from "./agentsRoute";
import { activateTab, focusPane, newTab, splitTab, surfaceKey } from "./arrangement";
import type { StorageLike } from "./persistence";
import { leaves } from "./tree";
import { linkTab } from "./linkedTabs";
import {
  createWorkspace,
  focusedChatOf,
  standaloneKeyOf,
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

  it("put a new chat in the New tab in focus, where it stood", () => {
    const workspace = createWorkspace(chatTabsDevice);
    workspace.update((arrangement) => splitTab(arrangement, chatB, "right"));
    workspace.update((arrangement) => newTab(arrangement, "p0"));
    const [[, blank]] = panes(workspace) as [[string, string]];
    const refC = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-C"));
    workspace.arriveChat(chatTabKey(refC));
    expect(panes(workspace)).toEqual([[chatA, chatTabKey(refC)], [chatB]]);
    expect(blank).toMatch(/^empty\//);
    expect(workspace.arrangement().focused).toBe("p0");
  });

  it("put the surface picked in a linked New tab in its place, linked", () => {
    const workspace = createWorkspace(chatTabsDevice);
    const stop = workspace.follow();
    useRightPanelStore.getState().open(refA, "files");
    workspace.showLinked(chatA, null);
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
      cwd: "/repo",
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
    workspace.arriveChat(chatB);
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
    expect(workspace.toggleOf(chatA)).toEqual({ kind: "none" });
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
    cwd: "/repo",
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
    workspace.arriveChat(chatA);
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
    cwd: "/work/tree",
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

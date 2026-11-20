import {
  DEFAULT_CLIENT_SETTINGS,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { type ClosedViewEntry, useClosedViewStore } from "./closedViewStore";
import { __setClientSettingsForTests } from "./hooks/useSettings";
import { readThreadPreviewState, resetPreviewStateForTests } from "./previewStateStore";
import { planNextReopen, type ReopenOwnerState, reopenClosedView } from "./reopenClosedView";
import {
  hostRightPanel,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
  useRightPanelStore,
} from "./rightPanelStore";
import { closeTab } from "./panes/arrangement";
import { leaves } from "./panes/tree";
import { workspace } from "./panes/workspace";
import { chatTabKey, parseChatTabKey } from "./sectionTabs/sectionTabs";

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};
const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "old-tab",
  navStatus: { _tag: "Success", url: "https://example.com", title: "Example" },
  canGoBack: false,
  canGoForward: false,
  viewport: { _tag: "freeform", width: 1200, height: 800 },
  profileId: "work",
  updatedAt: "2026-09-22T12:00:00.000Z",
};

beforeEach(() => {
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  resetPreviewStateForTests();
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

describe("reopenClosedView", () => {
  it.each([
    { relativePath: "src/app.ts", line: 18, folderTrail: undefined },
    { relativePath: "apps", line: null, folderTrail: "apps/web/src" },
    { relativePath: "", line: null, folderTrail: "apps/web/src" },
  ])(
    "restores the captured file or folder tab at '$relativePath'",
    async ({ relativePath, line, folderTrail }) => {
      const panels = useRightPanelStore.getState();
      if (folderTrail === undefined) panels.openFile(threadRef, relativePath, line ?? undefined);
      else {
        panels.openFile(threadRef, folderTrail);
        panels.navigateFolder(threadRef, `file:${folderTrail}`, relativePath, folderTrail);
      }
      const expected =
        relativePath === ""
          ? { kind: "files", id: "files", folderTrail }
          : {
              kind: "file",
              id: `file:${relativePath}`,
              relativePath,
              revealLine: line,
              revealRequestId: 1,
              ...(folderTrail === undefined ? {} : { folderTrail }),
            };
      const before = selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        threadRef,
      );
      expect(before.surfaces).toEqual([expected]);
      panels.closeSurface(threadRef, expected.id);
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces,
      ).toEqual([]);
      const entries = useClosedViewStore.getState().entries;
      expect(entries).toEqual([
        { id: expect.any(String), kind: "panel-tab", threadRef, surface: expected },
      ]);
      const openPreview = vi.fn();
      const reopened = await reopenClosedView(entries[0]!, {
        openPreview,
        workspaceAvailable: true,
      });
      expect(reopened).toBe(true);
      const state = selectThreadRightPanelState(
        useRightPanelStore.getState().byThreadKey,
        threadRef,
      );
      expect(state.isOpen).toBe(true);
      expect(state.activeSurfaceId).toBe(expected.id);
      expect(state.surfaces).toEqual([expected]);
      expect(openPreview).not.toHaveBeenCalled();
    },
  );

  it.each([
    { hosted: false, folderTrail: "packages/contracts/src" },
    { hosted: false, folderTrail: undefined },
    { hosted: true, folderTrail: "packages/contracts/src" },
    { hosted: true, folderTrail: undefined },
  ])(
    "preserves a hidden root tab with trail $folderTrail (hosted: $hosted)",
    async ({ hosted, folderTrail }) => {
      const panels = useRightPanelStore.getState();
      panels.openFile(threadRef, "apps/web/src");
      panels.navigateFolder(threadRef, "file:apps/web/src", "", "apps/web/src");
      panels.closeSurface(threadRef, "files");
      const entry = useClosedViewStore.getState().entries[0]!;
      const hostRef = hosted
        ? { ...threadRef, threadId: "host" as ScopedThreadRef["threadId"] }
        : threadRef;
      const unhost = hosted ? hostRightPanel(threadRef, hostRef) : undefined;
      try {
        if (folderTrail === undefined) panels.open(threadRef, "files");
        else {
          panels.openFile(threadRef, folderTrail);
          panels.navigateFolder(threadRef, `file:${folderTrail}`, "", folderTrail);
        }
        panels.close(threadRef);
        const before = selectThreadRightPanelState(
          useRightPanelStore.getState().byThreadKey,
          hostRef,
        );
        expect(before.isOpen).toBe(false);
        const plan = planNextReopen([entry], () => ({
          environmentKnown: true,
          catalogReady: true,
          ownerExists: true,
          sideChatExists: true,
          shellLive: true,
          panel: before,
          chatOpen: false,
          terminalOpen: false,
          terminalSessions: false,
        }));
        expect(plan.restore).toBe(entry);
        const openPreview = vi.fn();
        expect(
          await reopenClosedView(plan.restore!, { openPreview, workspaceAvailable: true }),
        ).toBe(true);
        const after = selectThreadRightPanelState(
          useRightPanelStore.getState().byThreadKey,
          hostRef,
        );
        expect(after.isOpen).toBe(true);
        expect(after.activeSurfaceId).toBe("files");
        expect(after.surfaces).toEqual([
          { kind: "files", id: "files", ...(folderTrail === undefined ? {} : { folderTrail }) },
        ]);
        expect(openPreview).not.toHaveBeenCalled();
      } finally {
        unhost?.();
      }
    },
  );

  it("remembers a closed graph tab and reopens it without a workspace", async () => {
    const panels = useRightPanelStore.getState();
    panels.open(threadRef, "diff");
    panels.open(threadRef, "graph");
    panels.closeSurface(threadRef, "graph");
    const [entry] = useClosedViewStore.getState().entries;
    expect(entry).toMatchObject({ kind: "panel-tab", surface: { id: "graph", kind: "graph" } });

    expect(
      await reopenClosedView(entry!, { openPreview: vi.fn(), workspaceAvailable: false }),
    ).toBe(true);
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
    expect(state.activeSurfaceId).toBe("graph");
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["diff", "graph"]);
  });

  it("puts a closed chat back in its pane and place while that pane is open", async () => {
    const chat = (id: string) => chatTabKey({ ...threadRef, threadId: id as never });
    const [one, two, three, four] = ["one", "two", "three", "four"].map(chat) as [
      string,
      string,
      string,
      string,
    ];
    const pane = (id: string, tabs: string[]) => ({
      type: "leaf" as const,
      id,
      tabs,
      active: tabs[0]!,
    });
    workspace.update(() => ({
      root: {
        type: "branch",
        id: "row",
        direction: "row",
        children: [pane("p1", [one, two, three]), pane("p2", [four])],
        weights: [1, 1],
      },
      focused: "p2",
      seq: 10,
    }));
    const close = (key: string) => {
      workspace.update((arrangement) => closeTab(arrangement, key));
      useClosedViewStore
        .getState()
        .remember({ kind: "chat-tab", threadRef: parseChatTabKey(key)! });
      return useClosedViewStore.getState().entries[0]!;
    };
    const tabsOf = () => leaves(workspace.arrangement().root).map((leaf) => leaf.tabs);

    const closed = close(two);
    expect(closed.place).toEqual({ paneId: "p1", index: 1, beside: one });
    await reopenClosedView(closed, { openPreview: vi.fn(), workspaceAvailable: true });
    expect(tabsOf()).toEqual([[one, two, three], [four]]);

    // A pane holding none of the tabs that stood beside it is a later one given the id.
    const elsewhere = close(two);
    await reopenClosedView(
      { ...elsewhere, place: { paneId: "p2", index: 0, beside: three } },
      { openPreview: vi.fn(), workspaceAvailable: true },
    );
    expect(leaves(workspace.arrangement().root)[1]?.tabs).toEqual([four]);

    // Its pane gone, it opens as any chat would, never into a pane that isn't there.
    const again = close(two);
    workspace.update((arrangement) => closeTab(closeTab(arrangement, one), three));
    await reopenClosedView(again, { openPreview: vi.fn(), workspaceAvailable: true });
    expect(leaves(workspace.arrangement().root).some((leaf) => leaf.id === "p1")).toBe(false);
    expect(tabsOf().flat()).toContain(two);
  });

  it("does not reopen workspace tabs without an available project", async () => {
    const options = {
      openPreview: vi.fn(),
      workspaceAvailable: false,
    };
    for (const surface of [
      { kind: "files", id: "files", folderTrail: "apps/web/src" },
      {
        kind: "file",
        id: "file:src/app.ts",
        relativePath: "src/app.ts",
        revealLine: null,
        revealRequestId: 0,
      },
      {
        kind: "file",
        id: "file:apps",
        relativePath: "apps",
        revealLine: null,
        revealRequestId: 1,
        folderTrail: "apps/web/src",
      },
    ] as const) {
      expect(await reopenClosedView({ kind: "panel-tab", threadRef, surface }, options)).toBe(
        false,
      );
    }
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces,
    ).toEqual([]);
  });

  it("recreates a browser tab with saved URL, viewport and profile, then selects its new ID", async () => {
    const openPreview = vi.fn(async () => AsyncResult.success({ ...snapshot, tabId: "new-tab" }));
    const result = await reopenClosedView(
      { kind: "browser", threadRef, snapshot },
      { openPreview, workspaceAvailable: false },
    );
    expect(result).toBe(true);
    expect(openPreview).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        url: "https://example.com",
        viewport: snapshot.viewport,
        profileId: "work",
      },
    });
    expect(readThreadPreviewState(threadRef).snapshot?.tabId).toBe("new-tab");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef)
        .activeSurfaceId,
    ).toBe("browser:new-tab");
  });

  it("leaves the panel unchanged when a browser resource fails to reopen", async () => {
    const result = await reopenClosedView(
      { kind: "browser", threadRef, snapshot },
      {
        openPreview: async () => AsyncResult.failure(Cause.fail(new Error("offline"))),
        workspaceAvailable: false,
      },
    );
    expect(result).toBe(false);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces,
    ).toEqual([]);
  });
});

describe("planNextReopen", () => {
  const entries: ClosedViewEntry[] = [
    { id: "a", kind: "panel-tab", threadRef, surface: { kind: "diff", id: "diff" } },
    { id: "b", kind: "panel-tab", threadRef, surface: { kind: "files", id: "files" } },
  ];
  const known: ReopenOwnerState = {
    environmentKnown: true,
    catalogReady: true,
    ownerExists: true,
    sideChatExists: true,
    shellLive: true,
    panel: { isOpen: false, activeSurfaceId: null, surfaces: [] },
    chatOpen: false,
    terminalOpen: false,
    terminalSessions: true,
  };
  const openDiff: ThreadRightPanelState = {
    isOpen: true,
    activeSurfaceId: "diff",
    surfaces: [{ kind: "diff", id: "diff" }],
  };

  it.each([
    ["restores the newest entry", [known, known], [], "a"],
    [
      "drops a removed environment once the catalog is ready",
      [{ ...known, environmentKnown: false }, known],
      ["a"],
      "b",
    ],
    [
      "waits for the catalog before dropping",
      [{ ...known, environmentKnown: false, catalogReady: false }, known],
      [],
      null,
    ],
    [
      "skips but keeps a thread deleted from a live shell",
      [{ ...known, ownerExists: false }, known],
      [],
      "b",
    ],
    [
      "skips but keeps a side chat deleted from a live shell",
      [{ ...known, sideChatExists: false }, known],
      [],
      "b",
    ],
    [
      "waits when a cached shell lacks the side chat",
      [{ ...known, sideChatExists: false, shellLive: false }, known],
      [],
      null,
    ],
    [
      "waits when a cached shell lacks the thread",
      [{ ...known, ownerExists: false, shellLive: false }, known],
      [],
      null,
    ],
    ["drops a tab that is already open", [{ ...known, panel: openDiff }, known], ["a"], "b"],
    [
      "restores a tab whose panel is hidden",
      [{ ...known, panel: { ...openDiff, isOpen: false } }],
      [],
      "a",
    ],
  ] as const)("%s", (_name, owners, dropped, restored) => {
    const plan = planNextReopen(
      entries.slice(0, owners.length),
      (e) => owners[entries.indexOf(e)]!,
    );
    expect(plan.drop.map((e) => e.id)).toEqual(dropped);
    expect(plan.restore?.id ?? null).toBe(restored);
  });

  it("restores a closed chat tab, or drops it while the panes hold it", () => {
    const chats: ClosedViewEntry[] = [
      { id: "a", kind: "chat-tab", threadRef },
      {
        id: "b",
        kind: "chat-tab",
        threadRef: { ...threadRef, threadId: "thread-2" as ScopedThreadRef["threadId"] },
      },
    ];
    expect(planNextReopen(chats, () => known).restore?.id).toBe("a");
    const plan = planNextReopen(chats, (entry) => ({ ...known, chatOpen: entry.id === "a" }));
    expect(plan.drop.map((entry) => entry.id)).toEqual(["a"]);
    expect(plan.restore?.id).toBe("b");
  });

  it("drops a closed terminal whose sessions all ended, rather than start a new one", () => {
    const terminals: ClosedViewEntry[] = [{ id: "t", kind: "terminal-tab", threadRef }];
    expect(planNextReopen(terminals, () => known).restore?.id).toBe("t");
    const ended = planNextReopen(terminals, () => ({ ...known, terminalSessions: false }));
    expect(ended.drop.map((entry) => entry.id)).toEqual(["t"]);
    expect(ended.restore).toBeNull();
  });
});

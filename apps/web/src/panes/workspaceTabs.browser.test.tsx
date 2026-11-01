import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  type ContextMenuItem,
  type EnvironmentId,
  type PreviewSessionSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render, stubGlobal } from "../../test/render";

const setAudioMuted = vi.hoisted(() => vi.fn(async () => undefined));
// Picks the item the test names from the next right-click menu.
const contextMenu = vi.hoisted(() => ({
  pick: null as string | null,
  shown: [] as string[],
}));

vi.mock(import("~/hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () => ({ theme: "light", resolvedTheme: "light", themeHalves: null }) as never,
}));
vi.mock(import("~/browser/browserDefaults"), async (original) => ({
  ...(await original()),
  useBrowserDefaults: () => ({ profiles: [] }) as never,
}));
vi.mock(import("~/components/preview/previewBridge"), () => ({
  previewBridge: { setAudioMuted } as never,
}));
vi.mock(import("~/localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: () =>
    ({
      contextMenu: {
        show: async (items: readonly ContextMenuItem[]) => {
          contextMenu.shown = items.map((item) => item.label);
          return items.find((item) => item.label === contextMenu.pick)?.id ?? null;
        },
      },
    }) as never,
}));

import { useRightPanelStore } from "../rightPanelStore";
import { chatSurfaceKey, chatTabKey } from "../sectionTabs/sectionTabs";
import { openTab, splitTab, startingArrangement } from "./arrangement";
import type { PanelProps } from "./panesController";
import { PanesHostContext, PanesLayoutKeyContext } from "./panesHost";
import { WorkspaceHostContext } from "./PaneSurfaceHost";
import { PaneTree } from "./PaneTree";
import { useWorkspaceSnapshot, workspace, WORKSPACE_LAYOUT_KEY } from "./workspace";
import { createWorkspaceHost } from "./workspaceTabs";

const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-1"));
const threadKey = scopedThreadKey(ref);
const chat = chatTabKey(ref);
const device = { hostId: "mac", deviceId: "pixel", platform: "android" as const, name: "Pixel 9" };
const deviceSurfaceId = "device:mac:pixel";
const session: PreviewSessionSnapshot = {
  threadId: "thread-1",
  tabId: "tab-1",
  navStatus: { _tag: "Success", url: "http://localhost:5173/", title: "Local site" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-22T00:00:00.000Z",
};

function audibleOverlay(audioMuted: boolean) {
  return {
    hasWebContents: true,
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomFactor: 1,
    pictureInPicture: false,
    colorScheme: "system" as const,
    audioMuted,
    audible: true,
    controller: "none" as const,
    favicon: null,
  };
}

const noop = () => undefined;

function panelProps(overrides: Partial<PanelProps>): PanelProps {
  return {
    mode: "inline",
    open: true,
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    getShortcutContext: () => ({
      terminalFocus: false,
      terminalOpen: false,
      previewFocus: false,
      previewOpen: false,
      isWeb: true,
      isDesktop: false,
    }),
    surfaces: [],
    environmentId: ref.environmentId,
    activeSurfaceId: null,
    pendingSurfaceIds: new Set(),
    previewSessions: {},
    desktopByTabId: {},
    previewRuntimeTabId: (tabId) => `runtime:${tabId}`,
    terminalLabelsById: new Map(),
    onActivate: (surface) => useRightPanelStore.getState().activateSurface(ref, surface.id),
    onRenameDevice: (surfaceId, title) =>
      useRightPanelStore.getState().renameDevice(ref, surfaceId, title),
    onCloseSurface: noop,
    onCloseOtherSurfaces: noop,
    onCloseSurfacesToRight: noop,
    onCloseAllSurfaces: noop,
    onCopyFilePath: noop,
    onAddBrowser: noop,
    onAddBrowserInProfile: noop,
    onAddTerminal: noop,
    onAddDiff: noop,
    onAddFiles: noop,
    onAddPullRequest: noop,
    onAddPullRequests: noop,
    onAddDevice: noop,
    onAddGraph: noop,
    onAddLineage: noop,
    browserAvailable: false,
    terminalAvailable: true,
    diffAvailable: true,
    filesAvailable: true,
    pullRequestAvailable: false,
    pullRequestsAvailable: false,
    deviceAvailable: true,
    graphAvailable: false,
    lineageAvailable: false,
    children: null,
    ...overrides,
  };
}

async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(0));
  await act(() => vi.advanceTimersToNextFrame());
}

/**
 * The shared panes holding the thread's chat alone, its surfaces linked beside it as the record
 * stands, with the panel props its ChatView hands them.
 */
async function renderPanes(overrides: Partial<PanelProps> = {}) {
  await using stack = new AsyncDisposableStack();
  stack.use(fakeTimers());
  stack.use(
    stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    ),
  );
  // Menus wait for exit animations to finish, which never happens under fake timers.
  stack.use(vi.spyOn(Element.prototype, "getAnimations").mockReturnValue([]));
  stack.use(vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel"));
  const host = createWorkspaceHost();
  // Anything an earlier test left goes with its chat.
  workspace.update(() => openTab(startingArrangement(), chat));
  stack.defer(workspace.follow());
  workspace.setPanel(panelProps(overrides));
  function Panes() {
    const snapshot = useWorkspaceSnapshot();
    return snapshot ? <PaneTree snapshot={snapshot} panelMaximized={false} /> : null;
  }
  const screen = stack.use(
    await render(
      <WorkspaceHostContext.Provider value={host}>
        <PanesHostContext.Provider value={host}>
          <PanesLayoutKeyContext.Provider value={WORKSPACE_LAYOUT_KEY}>
            <Panes />
          </PanesLayoutKeyContext.Provider>
        </PanesHostContext.Provider>
      </WorkspaceHostContext.Provider>,
    ),
  );
  await settle();
  const environment = stack.move();
  return {
    container: screen.container,
    [Symbol.asyncDispose]: () => environment.disposeAsync(),
  };
}

const tab = (container: HTMLElement, name: string) => {
  const found = [...container.querySelectorAll<HTMLElement>("[data-pane-tab]")].find(
    (element) => element.ariaLabel === name,
  );
  if (!found) throw new Error(`No tab named ${name}`);
  return found;
};
const button = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.ariaLabel === name,
  );

async function dispatch(target: Element, event: Event) {
  await act(() => target.dispatchEvent(event));
  await settle();
  return event;
}

const mouse = (target: Element, type: string, button: number) =>
  dispatch(target, new MouseEvent(type, { button, bubbles: true, cancelable: true }));

const press = (key: string, options: KeyboardEventInit = {}) =>
  dispatch(
    document.activeElement ?? document.body,
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
  );

async function rightClick(target: Element, pick: string | null = null) {
  contextMenu.pick = pick;
  await dispatch(target, new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
}

/** The thread's right panel as it starts, holding nothing, and put back so when the test ends. */
function emptyPanel(): Disposable {
  const reset = () =>
    useRightPanelStore.setState({
      byThreadKey: {},
      threadPanelVisibilityByThreadKey: {},
      userActionRevisionByThreadKey: {},
    });
  reset();
  setAudioMuted.mockClear();
  contextMenu.pick = null;
  contextMenu.shown = [];
  return { [Symbol.dispose]: reset };
}

describe("Mod+T in the shared panes", () => {
  it("opens the focused pane's New tab menu and adds the surface picked", async () => {
    using _panel = emptyPanel();
    const store = useRightPanelStore.getState();
    store.open(ref, "diff");
    store.open(ref, "files");
    const onAddTerminal = vi.fn();
    await using screen = await renderPanes({ onAddTerminal });
    await act(() =>
      workspace.update((arrangement) =>
        splitTab(arrangement, chatSurfaceKey(chat, "files"), "right"),
      ),
    );
    const panes = [...screen.container.querySelectorAll<HTMLElement>("[data-pane-id]")];
    // The chat, then its Diff and Files split apart.
    expect(panes).toHaveLength(3);
    const focused = panes.find((pane) => pane.dataset.focused !== undefined)!;
    const other = panes.find((pane) => pane !== focused)!;

    const event = await press("t", { metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(button(focused, "New tab")?.hasAttribute("data-popup-open")).toBe(true);
    expect(button(other, "New tab")?.hasAttribute("data-popup-open")).toBe(false);
    expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull();

    await press("t");
    expect(onAddTerminal).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]:not([data-closed])')).toBeNull();
  });

  it("opens the menu while the chat's panel is closed too, adding the surface beside the chat", async () => {
    using _panel = emptyPanel();
    const onAddDiff = vi.fn();
    await using _screen = await renderPanes({ open: false, onAddDiff });
    expect((await press("t", { metaKey: true })).defaultPrevented).toBe(true);
    await press("d");
    expect(onAddDiff).toHaveBeenCalledOnce();
  });
});

describe("a thread's surface as a tab of the shared panes", () => {
  it("cancels the middle button's defaults and closes once on middle-click", async () => {
    using _panel = emptyPanel();
    useRightPanelStore.getState().open(ref, "diff");
    const onCloseSurface = vi.fn();
    await using screen = await renderPanes({ onCloseSurface });
    const diff = tab(screen.container, "Diff");

    expect((await mouse(diff, "mousedown", 0)).defaultPrevented).toBe(false);
    expect((await mouse(diff, "mouseup", 0)).defaultPrevented).toBe(false);
    expect((await mouse(diff, "mousedown", 1)).defaultPrevented).toBe(true);
    // Chromium on Linux pastes the primary selection unless the release is cancelled too.
    expect((await mouse(diff, "mouseup", 1)).defaultPrevented).toBe(true);
    expect(onCloseSurface).not.toHaveBeenCalled();
    await mouse(diff, "auxclick", 1);
    expect(onCloseSurface).toHaveBeenCalledExactlyOnceWith({ id: "diff", kind: "diff" });
  });

  it("offers a workspace file's path to copy", async () => {
    using _panel = emptyPanel();
    useRightPanelStore.getState().openFile(ref, "src/app.ts");
    const onCopyFilePath = vi.fn();
    await using screen = await renderPanes({ onCopyFilePath });
    await rightClick(tab(screen.container, "app.ts"), "Copy path");
    expect(contextMenu.shown.slice(0, 3)).toEqual(["Open in Repositories", "Copy path", "Close"]);
    expect(onCopyFilePath).toHaveBeenCalledExactlyOnceWith("src/app.ts");
  });

  it("renames a device tab from its menu or a double-click, and Escape keeps the name", async () => {
    using _panel = emptyPanel();
    useRightPanelStore.getState().openDevice(ref, device);
    await using screen = await renderPanes();
    await rightClick(tab(screen.container, "Pixel 9"), "Rename");
    const input = screen.container.querySelector<HTMLInputElement>(
      'input[aria-label="Rename Pixel 9"]',
    )!;
    expect(document.activeElement).toBe(input);
    input.value = "Lab phone";
    await dispatch(input, new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(tab(screen.container, "Lab phone")).toBeDefined();

    const title = tab(screen.container, "Lab phone").querySelector("[data-slot=tooltip-trigger]")!;
    await dispatch(title, new MouseEvent("dblclick", { bubbles: true }));
    const again = screen.container.querySelector<HTMLInputElement>(
      'input[aria-label="Rename Lab phone"]',
    )!;
    again.value = "Something else";
    await dispatch(again, new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(screen.container.querySelector("input")).toBeNull();
    expect(tab(screen.container, "Lab phone")).toBeDefined();
    const surface = useRightPanelStore
      .getState()
      .byThreadKey[threadKey]?.surfaces.find((entry) => entry.id === deviceSurfaceId);
    expect(surface).toMatchObject({ title: "Lab phone" });
  });

  it.each([
    { audioMuted: false, label: "Mute Local site", item: "Mute tab", nextMuted: true },
    { audioMuted: true, label: "Unmute Local site", item: "Unmute tab", nextMuted: false },
  ])(
    "$label from its speaker or its menu, by runtime tab id",
    async ({ audioMuted, label, item, nextMuted }) => {
      using _panel = emptyPanel();
      useRightPanelStore.getState().openBrowser(ref, "tab-1");
      await using screen = await renderPanes({
        previewSessions: { "tab-1": session },
        desktopByTabId: { "tab-1": audibleOverlay(audioMuted) },
      });
      const preview = tab(screen.container, "Local site");
      await act(() => button(preview, label)!.click());
      expect(setAudioMuted).toHaveBeenCalledExactlyOnceWith("runtime:tab-1", nextMuted);

      setAudioMuted.mockClear();
      await rightClick(preview, item);
      expect(setAudioMuted).toHaveBeenCalledExactlyOnceWith("runtime:tab-1", nextMuted);
    },
  );

  it("shows no speaker for a silent browser tab", async () => {
    using _panel = emptyPanel();
    useRightPanelStore.getState().openBrowser(ref, "tab-1");
    await using screen = await renderPanes({
      previewSessions: { "tab-1": session },
      desktopByTabId: { "tab-1": { ...audibleOverlay(false), audible: false } },
    });
    const preview = tab(screen.container, "Local site");
    expect(button(preview, "Mute Local site")).toBeUndefined();
  });
});

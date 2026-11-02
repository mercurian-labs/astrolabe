import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  Profiler,
  startTransition,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";

// What the stubbed chats did: renders and instances by thread, keys heard, and the route set.
const probe = vi.hoisted(() => ({
  renders: new Map<string, number>(),
  instances: new Map<string, Set<string>>(),
  heard: [] as string[],
  surfaces: [] as string[],
  navigations: [] as (string | null)[],
  /** Whether the stubbed chats run ChatView's real shortcut handler, and the drawers it toggled. */
  shortcuts: false,
  terminalToggles: [] as string[],
  panelToggles: [] as string[],
  setRoute: null as null | ((threadId: string | null) => void),
  leaveAgents: null as null | (() => void),
}));

/** Fresh stubs, panes with no tabs and no thread's panel open. */
function setup() {
  workspace.update(() => startingArrangement());
  useRightPanelStore.setState({ byThreadKey: {} });
  probe.renders.clear();
  probe.instances.clear();
  probe.heard = [];
  probe.surfaces = [];
  probe.navigations = [];
  probe.shortcuts = false;
  probe.terminalToggles = [];
  probe.panelToggles = [];
}

vi.mock(import("~/hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: () => ({ theme: "light", resolvedTheme: "light", themeHalves: null }) as never,
}));

// As the router does: the route arrives later, in a transition.
vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => (options: { params?: { threadId?: string } }) => {
    probe.navigations.push(options.params?.threadId ?? null);
    return Promise.resolve().then(() =>
      startTransition(() => probe.setRoute?.(options.params?.threadId ?? null)),
    );
  }) as never,
}));

vi.mock(import("~/chatTabs/chatTabLabel"), async (original) => ({
  ...(await original()),
  ChatTabWatch: (() => null) as never,
}));

vi.mock(import("~/components/ChatView"), async () => {
  const { LinkedPanel } = await import("./LinkedPanel");
  const { useChatShortcuts } = await import("~/components/chat/useChatShortcuts");
  const { useChatComposerRef } = await import("~/composerHandleContext");
  type ComposerRef = ReturnType<typeof useChatComposerRef>;
  function Composer({ composerRef }: { composerRef: ComposerRef }) {
    const node = useRef<HTMLDivElement>(null);
    useImperativeHandle(
      composerRef,
      () =>
        ({
          focusAtEnd: () => node.current?.focus(),
          // As the composer's type-to-focus does: the key lands at its end, with focus.
          insertTextAtEnd: (text: string) => {
            node.current!.append(text);
            node.current!.focus();
            return true;
          },
        }) as never,
      [],
    );
    return <div ref={node} contentEditable data-testid="composer-editor" />;
  }
  // As ChatView's drawer does: opening focuses its terminal, closing gives focus to the composer.
  function TerminalDrawer({ composerRef }: { composerRef: ComposerRef }) {
    const [open, setOpen] = useState(false);
    const toggle = () => {
      setOpen(!open);
      if (open) composerRef.current?.focusAtEnd();
    };
    return (
      <>
        <button type="button" aria-label="Toggle terminal drawer" onClick={toggle}>
          drawer
        </button>
        {open ? <textarea aria-label="Terminal" autoFocus /> : null}
      </>
    );
  }
  function Surface({ thread }: { thread: string }) {
    const [id] = useState(() => Math.random().toString(36).slice(2));
    useState(() => probe.surfaces.push(`${thread}#${id}`));
    return <div data-fake-surface={thread}>surface {thread}</div>;
  }
  function FakeChatView({ threadId }: { threadId: string; environmentId: string }) {
    const [id] = useState(() => Math.random().toString(36).slice(2));
    probe.renders.set(threadId, (probe.renders.get(threadId) ?? 0) + 1);
    const instances = probe.instances.get(threadId) ?? new Set<string>();
    instances.add(id);
    probe.instances.set(threadId, instances);
    const composerRef = useChatComposerRef();
    useChatShortcuts({
      enabled: probe.shortcuts,
      keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
      scriptKeybindings: [],
      getShortcutContext: () => ({
        terminalFocus: false,
        terminalOpen: false,
        previewFocus: false,
        previewOpen: false,
        modelPickerOpen: false,
        isWeb: true,
        isDesktop: false,
      }),
      threadFindActive: false,
      composerRef,
      branchToolbarRef: { current: null },
      closeThreadFind: () => {},
      commands: {
        "terminal.toggle": () => void probe.terminalToggles.push(threadId),
        // As T3 Code's toggle does: closes the thread's panel, or opens it as it stood.
        "rightPanel.toggle": () => {
          probe.panelToggles.push(threadId);
          const ref = scopeThreadRef(env, ThreadId.make(threadId));
          const store = useRightPanelStore.getState();
          if (store.byThreadKey[scopedThreadKey(ref)]?.isOpen) store.close(ref);
          else store.toggleVisibility(ref);
        },
      },
      fallback: () => undefined,
    });
    // As ChatView's shortcuts and paste-to-composer do.
    useEffect(() => {
      const hear = (event: KeyboardEvent) => probe.heard.push(`${threadId}:${event.key}`);
      window.addEventListener("keydown", hear, true);
      return () => window.removeEventListener("keydown", hear, true);
    }, [threadId]);
    return (
      <div data-fake-chat={threadId} className="flex min-h-0 flex-1 flex-col">
        <div data-scroller={threadId} style={{ height: 300, overflowY: "auto" }}>
          <div style={{ height: 4000 }}>timeline {threadId}</div>
        </div>
        <LinkedPanel {...(panelProps(threadId) as unknown as Omit<PanelProps, "children">)}>
          <Surface thread={threadId} />
        </LinkedPanel>
        <TerminalDrawer composerRef={composerRef} />
        <Composer composerRef={composerRef} />
      </div>
    );
  }
  const panelProps = (threadId: string) => ({
    mode: "inline",
    open: true,
    keybindings: DEFAULT_RESOLVED_KEYBINDINGS,
    getShortcutContext: () => ({}),
    surfaces: [],
    environmentId: "env-1",
    activeSurfaceId: null,
    pendingSurfaceIds: new Set(),
    previewSessions: {},
    desktopByTabId: {},
    previewRuntimeTabId: (tabId: string) => tabId,
    terminalLabelsById: new Map(),
    onActivate: () => {},
    threadId,
  });
  return { default: FakeChatView as never };
});

import { chatRouteOf } from "../chatTabs/chatTabLabel";
import { ComposerHandleContext, focusedChatComposerRef } from "../composerHandleContext";
import { repositoryTabKey } from "../components/repositories/repositoryTabs";
import { useRightPanelStore } from "../rightPanelStore";
import { chatSurfaceKey, chatTabKey } from "../sectionTabs/sectionTabs";
import { Route as ChatLayoutRoute } from "../routes/_chat";
import { agentsRoute } from "./agentsRoute";
import { activateTab, focusPane, openTab, splitTab, startingArrangement } from "./arrangement";
import type { PanelProps } from "./panesController";
import { KEPT_CHATS } from "./recentChats";
import { leaves } from "./tree";
import { workspace } from "./workspace";
import { WorkspaceView } from "./WorkspaceView";

const focusedKey = () => {
  const arrangement = workspace.arrangement();
  return leaves(arrangement.root).find((leaf) => leaf.id === arrangement.focused)?.active;
};

const env = "env-1" as EnvironmentId;
const refOf = (thread: string) => scopeThreadRef(env, ThreadId.make(thread));
const chatOf = (thread: string) => chatTabKey(refOf(thread));

/**
 * The workspace on a thread's route, which follows the chat the panes bring to the front; with
 * `initial` null, in Repositories until a route arrives, which is Agents'.
 */
function Harness({ initial, onCommit }: { initial: string | null; onCommit: () => void }) {
  const [threadId, setThreadId] = useState<string | null>(initial);
  const [agents, setAgents] = useState(initial !== null);
  useLayoutEffect(() => {
    probe.setRoute = (next) => {
      setThreadId(next);
      setAgents(true);
    };
    probe.leaveAgents = () => {
      setThreadId(null);
      setAgents(false);
    };
  }, []);
  return (
    // As the Command Palette does, around every chat.
    <ComposerHandleContext value={focusedChatComposerRef}>
      <Profiler id="workspace" onRender={onCommit}>
        <WorkspaceView
          routeTarget={threadId === null ? null : { kind: "server", threadRef: refOf(threadId) }}
          agents={agents}
        />
        <output data-route-thread>{threadId ?? ""}</output>
      </Profiler>
    </ComposerHandleContext>
  );
}

const chatNode = (thread: string) =>
  document.querySelector<HTMLElement>(`[data-fake-chat="${thread}"]`);
const shows = (thread: string) => chatNode(thread)?.checkVisibility() === true;

async function mount(initial: string | null, onCommit: () => void = () => {}) {
  const screen = await render(<Harness initial={initial} onCommit={onCommit} />);
  await act(() => Promise.resolve());
  return screen;
}

async function change(run: () => void) {
  await act(run);
  // The route's navigation settles on a microtask, then in a transition.
  await act(() => Promise.resolve());
}

function totals() {
  return {
    renders: Object.fromEntries(probe.renders),
    instances: Object.fromEntries([...probe.instances].map(([key, ids]) => [key, ids.size])),
  };
}

describe("WorkspaceView chat tabs", () => {
  it("switches between two chats in one pane without mounting, unmounting or rendering either", async () => {
    setup();
    useRightPanelStore.getState().openTerminal(refOf("A"), "t1");
    useRightPanelStore.getState().openTerminal(refOf("B"), "t1");
    workspace.update(() => openTab(openTab(startingArrangement(), chatOf("B")), chatOf("A")));
    await using _screen = await mount("A");
    await change(() => workspace.update((a) => activateTab(a, chatOf("B"))));
    expect(shows("B")).toBe(true);
    expect(shows("A")).toBe(false);
    const [nodeA, nodeB] = [chatNode("A"), chatNode("B")];
    const before = totals();
    const surfacesBefore = probe.surfaces.length;

    for (const thread of ["A", "B", "A"]) {
      await change(() => workspace.update((a) => activateTab(a, chatOf(thread))));
      expect(shows(thread)).toBe(true);
      expect(shows(thread === "A" ? "B" : "A")).toBe(false);
    }

    expect(totals()).toEqual(before);
    expect(chatNode("A")).toBe(nodeA);
    expect(chatNode("B")).toBe(nodeB);
    // The front chat's surface mounts as it comes to the front, as it did before.
    expect(probe.surfaces.length - surfacesBefore).toBe(3);
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-fake-surface]")]
        .filter((node) => node.checkVisibility())
        .map((node) => node.dataset.fakeSurface),
    ).toEqual(["A"]);
  });

  it("focuses between chats in two splits without mounting, unmounting or rendering either", async () => {
    setup();
    workspace.update(() => {
      const two = openTab(openTab(startingArrangement(), chatOf("B")), chatOf("A"));
      return activateTab(splitTab(two, chatOf("B"), "right"), chatOf("A"));
    });
    await using _screen = await mount("A");
    expect(shows("A") && shows("B")).toBe(true);
    const [nodeA, nodeB] = [chatNode("A"), chatNode("B")];
    const before = totals();
    for (const thread of ["B", "A"]) {
      const pane = leaves(workspace.arrangement().root).find(
        (leaf) => leaf.active === chatOf(thread),
      );
      await change(() => workspace.update((a) => focusPane(a, pane!.id)));
      expect(workspace.linked().front).toBe(chatOf(thread));
    }

    expect(totals()).toEqual(before);
    expect(chatNode("A")).toBe(nodeA);
    expect(chatNode("B")).toBe(nodeB);
  });

  it("brings a chat back where its timeline was scrolled", async () => {
    setup();
    workspace.update(() => openTab(openTab(startingArrangement(), chatOf("B")), chatOf("A")));
    await using _screen = await mount("A");
    const scroller = document.querySelector<HTMLElement>('[data-scroller="A"]')!;
    scroller.scrollTop = 1234;

    await change(() => workspace.update((a) => activateTab(a, chatOf("B"))));
    await change(() => workspace.update((a) => activateTab(a, chatOf("A"))));

    expect(document.querySelector('[data-scroller="A"]')).toBe(scroller);
    expect(scroller.scrollTop).toBe(1234);
  });

  it("shows the chat brought to the front in the same commit as its tab, and never blank", async () => {
    setup();
    workspace.update(() => openTab(openTab(startingArrangement(), chatOf("B")), chatOf("A")));
    const seen: string[] = [];
    let watching = false;
    await using _screen = await mount("A", () => {
      if (!watching) return;
      seen.push(`${shows("A") ? "A" : "-"}${shows("B") ? "B" : "-"}`);
    });

    watching = true;
    await change(() => workspace.update((a) => activateTab(a, chatOf("B"))));
    await change(() => workspace.update((a) => activateTab(a, chatOf("A"))));

    // Every commit, the tab's change and the route's catching up after it, shows one chat.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toBe("-B");
    expect(seen.every((shown) => shown === "-B" || shown === "A-")).toBe(true);
    expect(seen.at(-1)).toBe("A-");
    // B rendered once, as it first came to the front; A not again.
    expect(probe.renders.get("B")).toBe(1);
    expect(probe.renders.get("A")).toBe(1);
  });

  it("keeps window keys for the chat on screen", async () => {
    setup();
    workspace.update(() => openTab(openTab(startingArrangement(), chatOf("B")), chatOf("A")));
    await using _screen = await mount("A");
    await change(() => workspace.update((a) => activateTab(a, chatOf("B"))));
    probe.heard = [];

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));

    expect(probe.heard).toEqual(["B:x"]);
  });

  it("toggles a chat's terminal drawer from mod+j only while that chat's tab has focus", async () => {
    setup();
    const file = repositoryTabKey({
      kind: "file",
      environmentId: env,
      projectId: ProjectId.make("project-1"),
      cwd: "/repo",
      path: "README.md",
    });
    workspace.update(() => openTab(openTab(startingArrangement(), chatOf("B")), chatOf("A")));
    workspace.open(file, "beside");
    probe.shortcuts = true;
    await using _screen = await mount("A");
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const pressModJ = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "j", metaKey: mac, ctrlKey: !mac, cancelable: true }),
      );
    const paneOf = (key: string) =>
      leaves(workspace.arrangement().root).find((leaf) => leaf.tabs.includes(key))!.id;

    pressModJ();
    expect(probe.terminalToggles).toEqual(["A"]);

    // The file in focus: chat A still shows beside it, and neither it nor hidden B answers.
    await change(() => workspace.update((a) => focusPane(a, paneOf(file))));
    expect(focusedKey()).toBe(file);
    expect(shows("A")).toBe(true);
    pressModJ();
    expect(probe.terminalToggles).toEqual(["A"]);

    await change(() => workspace.update((a) => focusPane(a, paneOf(chatOf("A")))));
    pressModJ();
    expect(probe.terminalToggles).toEqual(["A", "A"]);
  });

  it("gives focus back to its own composer as a chat's drawer closes, with another chat beside it", async () => {
    setup();
    workspace.update(() => openTab(startingArrangement(), chatOf("A")));
    await using _screen = await mount("A");
    // B opens beside A after it, so its composer is the last to mount.
    await change(() =>
      workspace.update((a) => splitTab(openTab(a, chatOf("B")), chatOf("B"), "right")),
    );
    expect(shows("A") && shows("B")).toBe(true);
    const paneOf = (key: string) =>
      leaves(workspace.arrangement().root).find((leaf) => leaf.tabs.includes(key))!.id;
    const inChat = (thread: string, selector: string) =>
      chatNode(thread)!.querySelector<HTMLElement>(selector)!;
    const toggleA = inChat("A", "[aria-label='Toggle terminal drawer']");

    await userEvent.click(toggleA);
    await vi.waitFor(() => expect(document.activeElement).toBe(inChat("A", "textarea")));
    await userEvent.click(toggleA);

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(inChat("A", "[data-testid='composer-editor']")),
    );
    expect(workspace.arrangement().focused).toBe(paneOf(chatOf("A")));
    expect(workspace.linked().front).toBe(chatOf("A"));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-route-thread]")?.textContent).toBe("A"),
    );
  });

  it("types into the focused chat's composer, not the one beside it", async () => {
    setup();
    probe.shortcuts = true;
    workspace.update(() => openTab(startingArrangement(), chatOf("B")));
    await using _screen = await mount("B");
    // A opens beside B after it, so B hears the window's keys first.
    await change(() =>
      workspace.update((a) => splitTab(openTab(a, chatOf("A")), chatOf("A"), "right")),
    );
    const paneA = leaves(workspace.arrangement().root).find(
      (leaf) => leaf.active === chatOf("A"),
    )!.id;
    await change(() => workspace.update((a) => focusPane(a, paneA)));
    const composerOf = (thread: string) =>
      chatNode(thread)!.querySelector<HTMLElement>("[data-testid='composer-editor']")!;

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x", cancelable: true }));

    expect(composerOf("A").textContent).toBe("x");
    expect(composerOf("B").textContent).toBe("");
    expect(document.activeElement).toBe(composerOf("A"));
    expect(workspace.arrangement().focused).toBe(paneA);
  });

  it("hides and brings back the focused chat's linked tabs from mod+alt+b, and no other chat's", async () => {
    setup();
    useRightPanelStore.getState().openTerminal(refOf("A"), "t1");
    useRightPanelStore.getState().openTerminal(refOf("B"), "t1");
    workspace.update(() => {
      const two = openTab(openTab(startingArrangement(), chatOf("A")), chatOf("B"));
      return activateTab(splitTab(two, chatOf("A"), "right"), chatOf("B"));
    });
    probe.shortcuts = true;
    // B mounts first, so its listener hears the key before A's.
    await using _screen = await mount("B");
    const paneOf = (key: string) =>
      leaves(workspace.arrangement().root).find((leaf) => leaf.tabs.includes(key))?.id;
    await change(() => workspace.update((a) => focusPane(a, paneOf(chatOf("A"))!)));
    await change(() => useRightPanelStore.getState().close(refOf("A")));
    const terminalA = chatSurfaceKey(chatOf("A"), "terminal:t1");
    expect(workspace.toggleOf(chatOf("A"))).toEqual({ kind: "hidden", tabs: [terminalA] });
    expect(shows("B")).toBe(true);
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const pressModAltB = () =>
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "b",
            code: "KeyB",
            metaKey: mac,
            ctrlKey: !mac,
            altKey: true,
            cancelable: true,
          }),
        );
      });

    await pressModAltB();
    expect(probe.panelToggles).toEqual(["A"]);
    expect(workspace.toggleOf(chatOf("A")).kind).toBe("showing");
    expect(paneOf(terminalA)).toBeDefined();

    await pressModAltB();
    expect(probe.panelToggles).toEqual(["A", "A"]);
    expect(workspace.toggleOf(chatOf("A")).kind).toBe("hidden");
    expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(refOf("B"))]?.isOpen).toBe(
      true,
    );
  });

  it(`keeps the ${KEPT_CHATS} chats shown most recently mounted and lets go of the rest`, async () => {
    setup();
    const threads = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];
    workspace.update(() =>
      threads.reduce((arrangement, thread) => openTab(arrangement, chatOf(thread)), {
        ...startingArrangement(),
      }),
    );
    workspace.update((a) => activateTab(a, chatOf("c1")));
    await using _screen = await mount("c1");
    for (const thread of threads.slice(1)) {
      await change(() => workspace.update((a) => activateTab(a, chatOf(thread))));
    }

    expect(threads.filter((thread) => chatNode(thread) !== null)).toEqual([
      "c3",
      "c4",
      "c5",
      "c6",
      "c7",
    ]);

    await change(() => workspace.update((a) => activateTab(a, chatOf("c1"))));

    expect(shows("c1")).toBe(true);
    expect(probe.instances.get("c1")?.size).toBe(2);
    expect(threads.filter((thread) => chatNode(thread) !== null)).toEqual([
      "c1",
      "c4",
      "c5",
      "c6",
      "c7",
    ]);
  });
});

describe("WorkspaceView under the chat routes", () => {
  /** The app's `_chat` layout, with the routes it lays the workspace out for. */
  function chatRoutes(path: string) {
    const root = createRootRoute({ component: Outlet });
    const layout = createRoute({
      getParentRoute: () => root,
      id: "_chat",
      component: ChatLayoutRoute.options.component!,
    });
    const blank = () => null;
    const routeTree = root.addChildren([
      layout.addChildren([
        createRoute({ getParentRoute: () => layout, path: "/", component: blank }),
        createRoute({ getParentRoute: () => layout, path: "wikis", component: blank }),
        createRoute({
          getParentRoute: () => layout,
          path: "$environmentId/$threadId",
          component: blank,
        }),
      ]),
    ]);
    return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  }

  it("keeps the panes and every chat mounted as the route enters and leaves a thread", async () => {
    setup();
    probe.setRoute = null;
    const file = repositoryTabKey({
      kind: "file",
      environmentId: env,
      projectId: ProjectId.make("project-1"),
      cwd: "/repo",
      path: "README.md",
    });
    workspace.update(() => openTab(openTab(startingArrangement(), chatOf("B")), chatOf("A")));
    workspace.open(file, "beside");
    const router = chatRoutes("/");
    await router.load();
    // The app's own router, as main.tsx renders it, so the layout reads real matches.
    await using _screen = await render(<RouterProvider router={router} />, { router: false });
    const panes = () => [...document.querySelectorAll("[data-pane-id]")];
    const [panesBefore, nodeA] = [panes(), chatNode("A")];
    const mounted = totals().instances;
    expect(nodeA).not.toBeNull();

    const toThread = () =>
      router.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: env, threadId: "A" },
      });
    for (const go of [toThread, () => router.navigate({ to: "/wikis" }), toThread]) {
      await act(go);
      expect(panes().filter((pane, index) => pane !== panesBefore[index])).toEqual([]);
      expect(chatNode("A")).toBe(nodeA);
      expect(totals().instances).toEqual(mounted);
    }
  });
});

describe("WorkspaceView switching to Agents", () => {
  const file = repositoryTabKey({
    kind: "file",
    environmentId: env,
    projectId: ProjectId.make("project-1"),
    cwd: "/repo",
    path: "README.md",
  });
  const terminal = chatSurfaceKey(chatOf("A"), "terminal:t1");
  const routeThread = () =>
    document.querySelector<HTMLElement>("[data-route-thread]")?.textContent || null;
  /** As the rail's Agents does (`useNavigateToAgents`). */
  const switchToAgents = () => {
    const route = agentsRoute(workspace.linked(), chatRouteOf);
    probe.setRoute?.(
      "params" in route && "threadId" in route.params ? route.params.threadId : null,
    );
  };

  /** Chats B and A (in front) in one pane, A's terminal beside them, and a file focused. */
  function chatTerminalAndFile() {
    setup();
    useRightPanelStore.getState().openTerminal(refOf("A"), "t1");
    workspace.update(() => openTab(openTab(startingArrangement(), chatOf("B")), chatOf("A")));
    workspace.open(file, "beside");
    expect(leaves(workspace.arrangement().root).map((leaf) => leaf.tabs)).toEqual([
      [chatOf("B"), chatOf("A")],
      [file],
      [terminal],
    ]);
  }
  const paneOf = (key: string) =>
    leaves(workspace.arrangement().root).find((leaf) => leaf.tabs.includes(key))!.id;

  it("leaves the panes as they stand, mounts no chat and selects no thread with a file in focus", async () => {
    chatTerminalAndFile();
    await using _screen = await mount(null);
    const before = workspace.linked();
    const mounted = totals();

    await change(switchToAgents);

    expect(workspace.linked()).toBe(before);
    expect(totals()).toEqual(mounted);
    expect(routeThread()).toBeNull();
    expect(probe.navigations).toEqual([]);

    // Focusing the chat's terminal, then the chat, selects its thread; the file, none again.
    await change(() => workspace.update((a) => focusPane(a, paneOf(terminal))));
    expect(routeThread()).toBe("A");
    await change(() => workspace.update((a) => focusPane(a, paneOf(chatOf("A")))));
    expect(routeThread()).toBe("A");
    await change(() => workspace.update((a) => focusPane(a, paneOf(file))));
    expect(routeThread()).toBeNull();
    expect(probe.navigations).toEqual(["A", null]);
    expect(totals().instances).toEqual(mounted.instances);
    expect(workspace.linked().front).toBe(chatOf("A"));
  });

  it("goes to the thread of a chat's linked tab in focus, leaving it in front", async () => {
    chatTerminalAndFile();
    workspace.update((a) => focusPane(a, paneOf(terminal)));
    await using _screen = await mount(null);
    const before = workspace.linked();
    const mounted = totals();

    await change(switchToAgents);

    expect(routeThread()).toBe("A");
    expect(workspace.linked()).toBe(before);
    expect(totals()).toEqual(mounted);
    expect(probe.navigations).toEqual([]);

    // Leaving for another section and coming back moves nothing either.
    await change(() => probe.leaveAgents?.());
    await change(switchToAgents);
    expect(workspace.linked()).toBe(before);
    expect(totals()).toEqual(mounted);
  });
});

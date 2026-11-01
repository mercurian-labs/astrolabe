import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { Profiler, startTransition, useEffect, useLayoutEffect, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";

// What the stubbed chats did: renders and instances by thread, keys heard, and the route set.
const probe = vi.hoisted(() => ({
  renders: new Map<string, number>(),
  instances: new Map<string, Set<string>>(),
  heard: [] as string[],
  surfaces: [] as string[],
  navigations: [] as (string | null)[],
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
import { repositoryTabKey } from "../components/repositories/repositoryTabs";
import { useRightPanelStore } from "../rightPanelStore";
import { chatSurfaceKey, chatTabKey } from "../sectionTabs/sectionTabs";
import { agentsRoute } from "./agentsRoute";
import { activateTab, focusPane, openTab, splitTab, startingArrangement } from "./arrangement";
import type { PanelProps } from "./panesController";
import { KEPT_CHATS } from "./recentChats";
import { leaves } from "./tree";
import { workspace } from "./workspace";
import { WorkspaceView } from "./WorkspaceView";

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
    <Profiler id="workspace" onRender={onCommit}>
      <WorkspaceView
        routeTarget={threadId === null ? null : { kind: "server", threadRef: refOf(threadId) }}
        agents={agents}
      />
      <output data-route-thread>{threadId ?? ""}</output>
    </Profiler>
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

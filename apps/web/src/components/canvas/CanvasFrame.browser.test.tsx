import { canvasData, canvasDocument, placeCanvas } from "@mercurian/wiki/canvas";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { ComposerHandleContext } from "~/composerHandleContext";
import { useRightPanelStore } from "~/rightPanelStore";
import { render } from "../../../test/render";
import { canvasViewsKey } from "~/state/canvasViews";

import "~/index.css";

import type { ChatComposerHandle } from "../chat/ChatComposer";
import { workspace } from "~/panes/workspace";
import { repositoryTabKey } from "../repositories/repositoryTabs";
import { CanvasFrame, LazyCanvasBoard } from "./CanvasFrame";

const folders = vi.hoisted(() => ({ shell: null as unknown, roots: [] as unknown[] }));

vi.mock(import("~/state/entities"), async (original) => {
  const real = await original();
  return {
    ...real,
    useThreadShell: ((ref: Parameters<typeof real.useThreadShell>[0]) => {
      const shell = real.useThreadShell(ref);
      return folders.shell ?? shell;
    }) as never,
  };
});
vi.mock(import("~/state/projectRoots"), async (original) => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const listed = Atom.make(AsyncResult.success({ roots: folders.roots }));
  const real = await original();
  return {
    ...real,
    projectRootsEnvironment: { ...real.projectRootsEnvironment, list: () => listed } as never,
  };
});
import { useThreadCanvasStore } from "./threadCanvasStore";

const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));
const source = { threadId: threadRef.threadId, itemId: TurnItemId.make("item-1") };

const view = {
  title: "How a wiki save lands",
  data: placeCanvas({
    groups: [{ id: "server", label: "Server", color: "cyan" }],
    cards: [
      { id: "client", text: "**Client** sends `wiki.amend`" },
      { id: "service", text: "WikiService.amend", group: "server" },
      {
        id: "land",
        path: "apps/server/src/wiki/WikiService.ts",
        line: 1160,
        endLine: 1200,
        text: "Plans the amendment on the head",
        group: "server",
      },
      { id: "git", text: "## Git\n\n- commit\n- move the branch", color: "green" },
      { id: "spec", url: "https://jsoncanvas.org", text: "The format" },
      { id: "loose", text: "A note beside the flow, long enough to wrap onto a second line." },
    ],
    arrows: [
      { from: "client", to: "service", label: "RPC" },
      { from: "service", to: "land" },
      { from: "land", to: "git", label: "commit", color: "green" },
      { from: "git", to: "client", label: "event", ends: "both" },
    ],
  }),
};

describe("CanvasFrame", () => {
  it("draws the board at once, in a frame shaped like the board", async () => {
    await using screen = await render(
      <div style={{ width: 720 }}>
        <CanvasFrame id="item-1" view={view} threadRef={threadRef} source={source} />
      </div>,
      { router: false }, // The frame reads no route.
    );
    await expect.element(screen.getByText("Client")).toBeVisible();
    await expect.element(screen.getByText("WikiService.ts:1160–1200")).toBeVisible();
    await expect.element(screen.getByText("RPC")).toBeVisible();
    await expect.element(screen.getByText("Server")).toBeVisible();
  });

  it("opens the canvas in the thread's right panel, unlocked from its Edit", async () => {
    using open = vi
      .spyOn(useRightPanelStore.getState(), "open")
      .mockImplementation(() => undefined);
    const board = canvasDocument(view.data);
    const recorded = {
      ...view,
      data: canvasData(board),
      recorded: { document: board, revision: "1" },
    };
    await using screen = await render(
      <CanvasFrame id="item-1" view={recorded} threadRef={threadRef} source={source} />,
      { router: false }, // The frame reads no route.
    );
    const key = canvasViewsKey(threadRef);
    await userEvent.click(
      screen.getByRole("button", { name: `Open ${view.title} in a linked tab` }),
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(threadRef, "canvas");
    expect(useThreadCanvasStore.getState().shownByThread[key]).toBe("item-1");
    expect(useThreadCanvasStore.getState().editingByThread[key]).toBeUndefined();

    // The chat card stays read-only: its Edit unlocks the board in the tab instead.
    await userEvent.click(screen.getByRole("button", { name: "Canvas menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit board" }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(useThreadCanvasStore.getState().editingByThread[key]).toBe("item-1");
    await userEvent.click(screen.getByRole("button", { name: "Canvas menu" }));
    await expect.element(screen.getByRole("menuitem", { name: "Edit board" })).toBeVisible();
    await userEvent.keyboard("{Escape}");

    // E does the same from the board.
    useThreadCanvasStore.getState().setEditing(key, null);
    await userEvent.keyboard("e");
    expect(useThreadCanvasStore.getState().editingByThread[key]).toBe("item-1");
    useThreadCanvasStore.getState().setEditing(key, null);
  });

  it("asks about the board in the composer, from its menu", async () => {
    const addCanvas = vi.fn(() => true);
    await using screen = await render(
      <ComposerHandleContext value={{ current: { addCanvas } as unknown as ChatComposerHandle }}>
        <CanvasFrame id="item-1" view={view} threadRef={threadRef} source={source} />
      </ComposerHandleContext>,
      { router: false }, // The frame reads no route.
    );
    await userEvent.click(screen.getByRole("button", { name: "Canvas menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Ask about this canvas" }));
    expect(addCanvas).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "canvas", itemId: source.itemId, title: view.title }),
    );
    // No story to present: P does nothing, and the menu offers none.
    await userEvent.keyboard("p");
    await userEvent.click(screen.getByRole("button", { name: "Canvas menu" }));
    expect(screen.getByRole("menuitem", { name: "Present" }).query()).toBeNull();
    await userEvent.keyboard("{Escape}");
  });

  it("opens a code card's file at its line, and a guest page leaves the card inert", async () => {
    using openFile = vi
      .spyOn(useRightPanelStore.getState(), "openFile")
      .mockImplementation(() => undefined);
    await using screen = await render(
      <CanvasFrame id="item-1" view={view} threadRef={threadRef} source={source} />,
      { router: false }, // The frame reads no route.
    );
    await userEvent.click(screen.getByText("WikiService.ts:1160–1200"));
    expect(openFile).toHaveBeenCalledExactlyOnceWith(
      threadRef,
      "apps/server/src/wiki/WikiService.ts",
      1160,
    );

    await using guest = await render(
      <CanvasFrame id="item-1" view={view} threadRef={null} source={source} />,
      {
        router: false, // The frame reads no route.
      },
    );
    await expect.element(guest.getByText("Client")).toBeVisible();
    expect(
      guest.getByRole("button", { name: `Open ${view.title} in a linked tab` }).query(),
    ).toBeNull();
  });
});

describe("a code card of another folder", () => {
  it("opens that folder's file in its own tab, never the thread's folder's same path", async () => {
    using openFile = vi
      .spyOn(useRightPanelStore.getState(), "openFile")
      .mockImplementation(() => undefined);
    using show = vi.spyOn(workspace, "show").mockImplementation(() => undefined);
    folders.shell = { projectId: "proj", worktreePath: null };
    const folder = (key: string, path: string, kind: string) => ({
      key,
      name: key,
      path,
      kind,
      state: "git",
      hostBacked: false,
      checkout: path,
      writable: true,
    });
    folders.roots.splice(
      0,
      folders.roots.length,
      folder("app", "/dev/app", "workspace"),
      folder("api", "/dev/api", "tracked"),
    );
    using _reset = { [Symbol.dispose]: () => void (folders.shell = null) };
    const data = {
      ...view.data,
      nodes: view.data.nodes.map((node) =>
        node.type === "link" && node.astrolabe?.code
          ? {
              ...node,
              astrolabe: { ...node.astrolabe, code: { ...node.astrolabe.code, root: "api" } },
            }
          : node,
      ),
    };
    await using screen = await render(
      <CanvasFrame id="item-1" view={{ ...view, data }} threadRef={threadRef} source={source} />,
      { router: false }, // The frame reads no route.
    );
    await userEvent.click(screen.getByText("WikiService.ts:1160–1200"));
    expect(openFile).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledExactlyOnceWith(
      repositoryTabKey({
        kind: "file",
        environmentId: threadRef.environmentId,
        wikiId: "proj:api" as never,
        checkout: { cwd: "/dev/api" },
        path: "apps/server/src/wiki/WikiService.ts",
      }),
    );
  });
});

describe("the free board", () => {
  const transformOf = (container: Element) =>
    container.querySelector<HTMLElement>(".cv-world")?.style.transform;

  it("zooms from its controls and keyboard, and Fit brings the whole board back", async () => {
    await using screen = await render(
      <div style={{ width: 800, height: 600 }}>
        <LazyCanvasBoard data={view.data} mode="free" label={view.title} />
      </div>,
      { router: false }, // The board reads no route.
    );
    await expect.element(screen.getByText("Client")).toBeVisible();
    const fitted = transformOf(screen.container);
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await vi.waitFor(() => expect(transformOf(screen.container)).not.toBe(fitted));
    await userEvent.click(screen.getByRole("button", { name: "Fit the board in view" }));
    expect(transformOf(screen.container)).toBe(fitted);

    const board = screen.getByRole("group", { name: view.title });
    await userEvent.click(board);
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(transformOf(screen.container)).not.toBe(fitted));
  });

  it("focuses on the requested named group on initial mount under StrictMode", async () => {
    const { StrictMode } = await import("react");
    await using whole = await render(
      <div style={{ width: 800, height: 600 }}>
        <LazyCanvasBoard data={view.data} mode="free" label={view.title} />
      </div>,
      { router: false },
    );
    await expect.element(whole.getByText("Server")).toBeVisible();
    const wholeTransform = transformOf(whole.container);

    await using focused = await render(
      <StrictMode>
        <div style={{ width: 800, height: 600 }}>
          <LazyCanvasBoard
            data={view.data}
            mode="free"
            label={view.title}
            focus={{ group: "Server", request: 1 }}
          />
        </div>
      </StrictMode>,
      { router: false },
    );
    await expect.element(focused.getByText("Server")).toBeVisible();
    await vi.waitFor(() => expect(transformOf(focused.container)).not.toBe(wholeTransform));
  });
});

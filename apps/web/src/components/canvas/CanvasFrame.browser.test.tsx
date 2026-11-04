import { placeCanvas } from "@mercurian/wiki/canvas";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { useRightPanelStore } from "~/rightPanelStore";
import { render } from "../../../test/render";
import { canvasViewsKey } from "~/state/canvasViews";

import "~/index.css";

import { CanvasFrame, LazyCanvasBoard } from "./CanvasFrame";
import { useThreadCanvasStore } from "./threadCanvasStore";

const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));

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
        <CanvasFrame id="item-1" view={view} threadRef={threadRef} />
      </div>,
      { router: false }, // The frame reads no route.
    );
    await expect.element(screen.getByText("Client")).toBeVisible();
    await expect.element(screen.getByText("WikiService.ts:1160–1200")).toBeVisible();
    await expect.element(screen.getByText("RPC")).toBeVisible();
    await expect.element(screen.getByText("Server")).toBeVisible();
  });

  it("opens the canvas in the thread's right panel", async () => {
    using open = vi
      .spyOn(useRightPanelStore.getState(), "open")
      .mockImplementation(() => undefined);
    await using screen = await render(
      <CanvasFrame id="item-1" view={view} threadRef={threadRef} />,
      { router: false }, // The frame reads no route.
    );
    await userEvent.click(screen.getByRole("button", { name: `Open ${view.title} in a panel` }));
    expect(open).toHaveBeenCalledExactlyOnceWith(threadRef, "canvas");
    expect(useThreadCanvasStore.getState().shownByThread[canvasViewsKey(threadRef)]).toBe("item-1");
  });

  it("opens a code card's file at its line, and a guest page leaves the card inert", async () => {
    using openFile = vi
      .spyOn(useRightPanelStore.getState(), "openFile")
      .mockImplementation(() => undefined);
    await using screen = await render(
      <CanvasFrame id="item-1" view={view} threadRef={threadRef} />,
      { router: false }, // The frame reads no route.
    );
    await userEvent.click(screen.getByText("WikiService.ts:1160–1200"));
    expect(openFile).toHaveBeenCalledExactlyOnceWith(
      threadRef,
      "apps/server/src/wiki/WikiService.ts",
      1160,
    );

    await using guest = await render(<CanvasFrame id="item-1" view={view} threadRef={null} />, {
      router: false, // The frame reads no route.
    });
    await expect.element(guest.getByText("Client")).toBeVisible();
    expect(guest.getByRole("button", { name: `Open ${view.title} in a panel` }).query()).toBeNull();
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
});

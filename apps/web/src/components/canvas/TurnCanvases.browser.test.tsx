import { placeCanvas } from "@mercurian/wiki/canvas";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { useRightPanelStore } from "~/rightPanelStore";
import { canvasViewsKey } from "~/state/canvasViews";
import { render } from "../../../test/render";

import "~/index.css";

import { useThreadCanvasStore } from "./threadCanvasStore";
import { TurnCanvases, type TurnCanvasEntry } from "./TurnCanvases";

const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));

const entry = (id: string, title: string, text: string, embedded: boolean): TurnCanvasEntry => ({
  id,
  canvas: {
    title,
    data: placeCanvas({
      cards: [
        { id: "a", text },
        { id: "b", text: `${text}, after` },
      ],
      arrows: [{ from: "a", to: "b" }],
    }),
  },
  sourceThreadId: threadRef.threadId,
  itemId: TurnItemId.make(id),
  embedded,
});

describe("TurnCanvases", () => {
  it("lists a turn's canvases, drawing the ones its reply never showed, and opens each live", async () => {
    using open = vi.spyOn(useRightPanelStore.getState(), "open").mockImplementation(() => {});
    await using screen = await render(
      <div style={{ width: 720 }}>
        <TurnCanvases
          canvases={[
            entry("item-1", "Checkout Flow", "Cart", true),
            entry("item-2", "Aside", "Left out", false),
          ]}
          threadRef={threadRef}
        />
      </div>,
      { router: false }, // The section reads no route.
    );
    await expect.element(screen.getByRole("heading", { name: "2 canvases" })).toBeVisible();
    // The board the reply never embedded is a picture here; the embedded one is a row.
    await expect.element(screen.getByRole("button", { name: "Open Aside" })).toBeVisible();
    await expect.element(screen.getByText("Left out, after")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Checkout Flow" }).query()).toBeNull();
    expect(screen.getByText("Cart", { exact: true }).query()).toBeNull();

    // Shown in place, it's the live board.
    await userEvent.click(screen.getByRole("button", { name: "Show Checkout Flow" }));
    await expect.element(screen.getByRole("group", { name: "Checkout Flow" })).toBeVisible();
    await expect.element(screen.getByText("Cart", { exact: true })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Open Aside in a linked tab" }));
    expect(open).toHaveBeenCalledExactlyOnceWith(threadRef, "canvas");
    expect(useThreadCanvasStore.getState().shownByThread[canvasViewsKey(threadRef)]).toBe("item-2");
  });
});

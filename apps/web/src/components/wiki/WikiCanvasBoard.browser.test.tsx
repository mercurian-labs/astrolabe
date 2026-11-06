import { CanvasBoard, type CanvasBoardHost } from "@mercurian/wiki-editor/canvas-board";
import { canvasData, type CanvasData } from "@mercurian/wiki/canvas";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

const CARD = { width: 240, height: 120 };

/** A grid of cards, with an arrow from each to the next. */
function grid(count: number): CanvasData {
  const columns = Math.ceil(Math.sqrt(count));
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `n${index}`,
    type: "text",
    text: `card ${index}`,
    x: (index % columns) * 600,
    y: Math.floor(index / columns) * 360,
    ...CARD,
  }));
  const edges = nodes.slice(1).map((node, index) => ({
    id: `e${index}`,
    fromNode: `n${index}`,
    toNode: node.id,
  }));
  return canvasData({ nodes, edges });
}

const mountedCards = () => document.querySelectorAll("[data-card-id]").length;
const mountedEdges = () => document.querySelectorAll(".cv-edge").length;

function Frame({
  data,
  host,
  revision,
}: {
  readonly data: CanvasData;
  readonly host?: CanvasBoardHost;
  readonly revision?: string;
}) {
  return (
    <div style={{ width: 1000, height: 700 }}>
      <CanvasBoard
        data={data}
        mode="free"
        label="Board"
        {...(host === undefined ? {} : { host })}
        {...(revision === undefined ? {} : { revision })}
      />
    </div>
  );
}

const board = () => document.querySelector<HTMLElement>(".cv-board")!;
const world = () => document.querySelector<HTMLElement>(".cv-world")!;

const wheel = (init: WheelEventInit) =>
  board().dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 500,
      clientY: 350,
      ...init,
    }),
  );

describe("a board of 5,000 cards", () => {
  it("mounts what's in view, follows it, and draws nothing at rest", async () => {
    const frames = vi.spyOn(window, "requestAnimationFrame");
    // Router off: the board asks nothing of the app around it.
    await using _screen = await render(<Frame data={grid(5000)} />, { router: false });
    await vi.waitFor(() => expect(mountedCards()).toBeGreaterThan(0));

    // Fit caps at the minimum zoom, so the opening view shows part of the board, in simple form.
    const opening = mountedCards();
    expect(opening).toBeLessThan(5000);
    expect(mountedEdges()).toBeLessThan(5000);
    expect(document.querySelectorAll(".cv-simple-text").length).toBe(opening);
    expect(document.querySelectorAll(".cv-card-body").length).toBe(0);
    expect(frames).not.toHaveBeenCalled();

    await userEvent.click(document.querySelector("[aria-label='Reset zoom']")!);
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".cv-card-body").length).toBeGreaterThan(0),
    );
    const close = mountedCards();
    expect(close).toBeLessThan(opening);
    expect(close).toBeLessThan(20);
    const firstInView = document.querySelector("[data-card-id]")?.getAttribute("data-card-id");

    wheel({ deltaX: 6000, deltaY: 4000 });
    await vi.waitFor(() =>
      expect(document.querySelector("[data-card-id]")?.getAttribute("data-card-id")).not.toBe(
        firstInView,
      ),
    );
    expect(mountedCards()).toBeLessThan(20);
    expect(mountedEdges()).toBeLessThan(40);

    const painted = world().style.transform;
    frames.mockClear();
    await expect.element(document.querySelector<HTMLElement>(".cv-controls")).toBeVisible();
    expect(world().style.transform).toBe(painted);
    expect(frames).not.toHaveBeenCalled();
  });
});

describe("cards", () => {
  const data = canvasData({
    nodes: [
      { id: "big", type: "group", label: "Big", x: 0, y: 0, width: 900, height: 500 },
      { id: "small", type: "group", label: "Small", x: 20, y: 20, width: 300, height: 300 },
      {
        id: "a",
        type: "text",
        text: "[Site](https://example.test)",
        x: 40,
        y: 60,
        width: 200,
        height: 80,
      },
      { id: "missing", type: "file", file: "Gone.md", x: 400, y: 60, width: 200, height: 120 },
      {
        id: "note",
        type: "file",
        file: "Note.md",
        subpath: "#Two",
        x: 640,
        y: 60,
        width: 200,
        height: 160,
      },
    ],
  });
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;

  it("selects on a first click, and only then is a card's content live", async () => {
    const opened = vi.fn();
    await using _screen = await render(<Frame data={data} host={{ onOpenUrl: opened }} />, {
      router: false,
    });
    await vi.waitFor(() => expect(card("a")).not.toBeNull());
    const link = card("a").querySelector("a")!;
    await userEvent.click(link, { force: true });
    expect(opened).not.toHaveBeenCalled();
    expect(card("a").hasAttribute("data-selected")).toBe(true);
    await userEvent.click(link);
    expect(opened).toHaveBeenCalledWith("https://example.test");
  });

  it("draws groups beneath cards, smaller above larger, and clicks through a group's body", async () => {
    await using _screen = await render(<Frame data={data} />, { router: false });
    await vi.waitFor(() => expect(card("big")).not.toBeNull());
    const order = [...document.querySelectorAll("[data-card-id]")].map((node) =>
      node.getAttribute("data-card-id"),
    );
    expect(order).toEqual(["big", "small", "a", "missing", "note"]);
    await userEvent.click(card("small"), { position: { x: 200, y: 250 } });
    expect(card("small").hasAttribute("data-selected")).toBe(false);
    await userEvent.click(card("small").querySelector(".cv-group-label")!);
    expect(card("small").hasAttribute("data-selected")).toBe(true);
  });

  it("batches its reads, narrows a note, says when a file is missing, and keeps the camera on a new commit", async () => {
    const readFiles = vi.fn(async (paths: ReadonlyArray<string>) =>
      paths.map((path) =>
        path === "Gone.md"
          ? { exists: false, text: null }
          : { exists: true, text: "# One\nfirst\n## Two\nsecond" },
      ),
    );
    const host = { readFiles };
    await using screen = await render(<Frame data={data} host={host} revision="a" />, {
      router: false,
    });
    await vi.waitFor(() => expect(card("note").textContent).toContain("second"));
    expect(readFiles).toHaveBeenCalledTimes(1);
    expect(readFiles.mock.calls[0]?.[0]).toEqual(["Gone.md", "Note.md"]);
    expect(card("note").textContent).not.toContain("first");
    expect(card("note").querySelector(".cv-card-label")?.textContent).toBe("Note › Two");
    expect(card("missing").textContent).toContain('"Gone.md" could not be found.');

    wheel({ deltaX: 120, deltaY: 40 });
    await vi.waitFor(() => expect(world().style.transform).toContain("-"));
    const camera = world().style.transform;
    await screen.rerender(<Frame data={data} host={host} revision="b" />);
    await vi.waitFor(() => expect(readFiles).toHaveBeenCalledTimes(2));
    expect(world().style.transform).toBe(camera);
    expect(card("note").textContent).toContain("second");
  });
});

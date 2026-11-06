import {
  CanvasBoard,
  type CanvasBoardHandle,
  type CanvasBoardHost,
} from "@mercurian/wiki-editor/canvas-board";
import type { CanvasCamera } from "@mercurian/wiki-editor/canvas-geometry";
import {
  canvasData,
  reviewCanvas,
  type CanvasData,
  type CanvasMarks,
} from "@mercurian/wiki/canvas";
import { createRef } from "react";
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
  camera,
  onCamera,
  marks,
  boardRef,
}: {
  readonly data: CanvasData;
  readonly host?: CanvasBoardHost;
  readonly revision?: string;
  readonly camera?: CanvasCamera;
  readonly onCamera?: (camera: CanvasCamera | null) => void;
  readonly marks?: CanvasMarks;
  readonly boardRef?: Parameters<typeof CanvasBoard>[0]["ref"];
}) {
  return (
    <div style={{ width: 1000, height: 700 }}>
      <CanvasBoard
        data={data}
        mode="free"
        label="Board"
        {...(host === undefined ? {} : { host })}
        {...(revision === undefined ? {} : { revision })}
        {...(camera === undefined ? {} : { camera })}
        {...(onCamera === undefined ? {} : { onCamera })}
        {...(marks === undefined ? {} : { marks })}
        {...(boardRef === undefined ? {} : { ref: boardRef })}
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
    const overview = () => document.querySelector<HTMLCanvasElement>(".cv-overview");
    await vi.waitFor(() => expect(overview()?.hidden).toBe(false));

    // Fit caps at the minimum zoom, and that many cards draw on one canvas, not in the DOM.
    expect(overview()!.width).toBeGreaterThan(0);
    expect(mountedCards()).toBe(0);
    expect(mountedEdges()).toBe(0);
    expect(frames).not.toHaveBeenCalled();

    await userEvent.click(document.querySelector("[aria-label='Reset zoom']")!);
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".cv-card-body").length).toBeGreaterThan(0),
    );
    expect(overview()!.hidden).toBe(true);
    const close = mountedCards();
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

  const tap = (target: Element) => {
    const { left, top, width, height } = target.getBoundingClientRect();
    const at = {
      bubbles: true,
      pointerId: 7,
      pointerType: "touch",
      clientX: left + width / 2,
      clientY: top + height / 2,
    };
    target.dispatchEvent(new PointerEvent("pointerdown", at));
    target.dispatchEvent(new PointerEvent("pointerup", at));
  };

  it("takes a finger's first tap only to select, whatever iOS clicks after it", async () => {
    // A synthetic pointer has nothing to capture.
    using _capture = vi.spyOn(Element.prototype, "setPointerCapture").mockReturnValue();
    const opened = vi.fn();
    await using _screen = await render(<Frame data={data} host={{ onOpenUrl: opened }} />, {
      router: false,
    });
    await vi.waitFor(() => expect(card("a")).not.toBeNull());
    tap(card("a").querySelector(".cv-card-content")!);
    await vi.waitFor(() => expect(card("a").hasAttribute("data-selected")).toBe(true));
    const link = card("a").querySelector("a")!;
    link.click();
    expect(opened).not.toHaveBeenCalled();
    link.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
    link.click();
    expect(opened).toHaveBeenCalledWith("https://example.test");
  });

  it("opens a file card from its label on a second tap", async () => {
    using _capture = vi.spyOn(Element.prototype, "setPointerCapture").mockReturnValue();
    const onOpenLink = vi.fn();
    const host = { onOpenLink, readFiles: async () => [] };
    await using _screen = await render(<Frame data={data} host={host} />, { router: false });
    await vi.waitFor(() => expect(card("note")).not.toBeNull());
    const label = card("note").querySelector(".cv-card-label")!;
    tap(label);
    await vi.waitFor(() => expect(card("note").hasAttribute("data-selected")).toBe(true));
    expect(onOpenLink).not.toHaveBeenCalled();
    tap(label);
    expect(onOpenLink).toHaveBeenCalledWith("Note.md");
  });

  it("opens where a reader left it, and says where the camera goes next", async () => {
    const onCamera = vi.fn();
    const camera = { x: -40, y: -20, zoom: 0.75 };
    await using _screen = await render(<Frame data={data} camera={camera} onCamera={onCamera} />, {
      router: false,
    });
    await vi.waitFor(() =>
      expect(world().style.transform).toBe("translate(-40px, -20px) scale(0.75)"),
    );
    expect(onCamera).toHaveBeenLastCalledWith(camera);
    wheel({ deltaX: 10, deltaY: 0 });
    await vi.waitFor(() =>
      expect(onCamera).toHaveBeenLastCalledWith({ x: -50, y: -20, zoom: 0.75 }),
    );
    await userEvent.click(document.querySelector("[aria-label='Fit the board in view']")!);
    await vi.waitFor(() => expect(onCamera).toHaveBeenLastCalledWith(null));
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

describe("a commit landing on a board", () => {
  const flashes = () =>
    [...document.querySelectorAll("[data-card-id]:has(.cv-flash)")].map((card) =>
      card.getAttribute("data-card-id"),
    );

  it("catches the eye on the cards it changed, once, and leaves the camera", async () => {
    const before = grid(4);
    const changed = (text: string) => ({
      ...before,
      nodes: before.nodes.map((node) =>
        node.id === "n2" && node.type === "text" ? { ...node, text } : node,
      ),
    });
    await using screen = await render(<Frame data={before} revision="one" />, {
      router: false,
    });
    await vi.waitFor(() => expect(mountedCards()).toBe(4));
    expect(flashes()).toEqual([]);

    await screen.rerender(<Frame data={changed("New")} revision="two" />);
    await vi.waitFor(() => expect(flashes()).toEqual(["n2"]));
    const first = document.querySelector(".cv-flash");
    const camera = world().style.transform;

    await screen.rerender(<Frame data={changed("Newer")} revision="three" />);
    await vi.waitFor(() => expect(document.querySelector(".cv-flash")).not.toBe(first));
    expect(flashes()).toEqual(["n2"]);
    expect(world().style.transform).toBe(camera);
  });

  it("stays still when a commit doesn't touch it, and on a board with no commits", async () => {
    const data = grid(4);
    await using screen = await render(<Frame data={data} revision="one" />, { router: false });
    await vi.waitFor(() => expect(mountedCards()).toBe(4));
    await screen.rerender(<Frame data={data} revision="two" />);
    expect(flashes()).toEqual([]);
  });
});

describe("a board under review", () => {
  const near = { y: 60, width: 200, height: 80 };
  const before = {
    nodes: [
      { id: "kept", type: "text", text: "Kept", x: 40, ...near },
      { id: "gone", type: "text", text: "Gone", x: 300, ...near },
      { id: "file", type: "file", file: "Deleted too.md", x: 560, ...near },
    ],
    edges: [{ id: "arrow", fromNode: "kept", toNode: "gone" }],
  };
  const after = {
    nodes: [
      { id: "kept", type: "text", text: "Kept, edited", x: 40, ...near },
      { id: "new", type: "text", text: "New", x: 40, y: 240, width: 200, height: 80 },
    ],
    edges: [],
  };
  const card = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`);

  it("marks what changed, and still draws what went without reading its file", async () => {
    const { data, marks } = reviewCanvas(before, after);
    const readFiles = vi.fn(async () => []);
    await using _screen = await render(<Frame data={data} marks={marks} host={{ readFiles }} />, {
      router: false,
    });
    await vi.waitFor(() => expect(card("gone")).not.toBeNull());
    expect(card("kept")?.dataset.mark).toBe("text");
    expect(card("new")?.dataset.mark).toBe("added");
    expect(card("gone")?.dataset.mark).toBe("removed");
    expect(card("gone")?.textContent).toContain("Gone");
    expect(card("file")?.textContent).not.toContain("could not be found");
    expect(document.querySelector<SVGElement>('[data-edge-id="arrow"]')?.dataset.mark).toBe(
      "removed",
    );
    expect(readFiles).not.toHaveBeenCalled();
  });

  it("selects a card or an arrow it's asked to, and brings it into view", async () => {
    const { data, marks } = reviewCanvas(before, after);
    const boardRef = createRef<CanvasBoardHandle>();
    await using _screen = await render(<Frame data={data} marks={marks} boardRef={boardRef} />, {
      router: false,
    });
    await vi.waitFor(() => expect(card("gone")).not.toBeNull());
    boardRef.current?.selectCard("gone");
    await vi.waitFor(() => expect(card("gone")?.hasAttribute("data-selected")).toBe(true));
    boardRef.current?.selectCard("arrow");
    await vi.waitFor(() =>
      expect(document.querySelector('[data-edge-id="arrow"]')?.hasAttribute("data-selected")).toBe(
        true,
      ),
    );
  });

  it("leaves the wheel to the page until the board is clicked", async () => {
    const { data } = reviewCanvas(before, after);
    await using _screen = await render(
      <div style={{ width: 1000, height: 700 }}>
        <CanvasBoard data={data} mode="free" label="Board" wheelOnceFocused />
      </div>,
      { router: false },
    );
    await vi.waitFor(() => expect(card("kept")).not.toBeNull());
    const spin = () => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 });
      board().dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(spin()).toBe(false);
    board().focus();
    expect(spin()).toBe(true);
  });
});

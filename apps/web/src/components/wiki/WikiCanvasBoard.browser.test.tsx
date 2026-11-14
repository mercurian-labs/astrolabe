import {
  CanvasBoard,
  type CanvasBoardHandle,
  type CanvasBoardHost,
} from "@mercurian/wiki-editor/canvas-board";
import { overlaps, type CanvasCamera } from "@mercurian/wiki-editor/canvas-geometry";
import {
  canvasData,
  reviewCanvas,
  type CanvasData,
  type CanvasMarks,
} from "@mercurian/wiki/canvas";
import { CanvasDocument } from "@mercurian/wiki-editor/canvas-document";
import { CanvasExportDialog } from "@mercurian/wiki-editor/canvas-export";
import { useCanvasCardSession } from "@mercurian/wiki-editor/canvas-card-session";
import { createRef, Profiler, StrictMode, useState } from "react";
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

function CardSessionProbe({ onChange }: { readonly onChange: (text: string) => void }) {
  const [editor] = useState(() => ({ initialText: "Start", onChange }));
  const session = useCanvasCardSession(editor);
  return <button onClick={() => session?.text.insert(5, ", typed")}>Type</button>;
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

    board().dispatchEvent(
      new KeyboardEvent("keydown", { key: ")", code: "Digit0", shiftKey: true, bubbles: true }),
    );
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
    await expect.element(document.querySelector<HTMLElement>(".cv-zoom")).toBeVisible();
    expect(world().style.transform).toBe(painted);
    expect(frames).not.toHaveBeenCalled();
  });
});

describe("a card's editor", () => {
  it("still reports what's typed after React runs its effect twice", async () => {
    const onChange = vi.fn();
    await using screen = await render(
      <StrictMode>
        <CardSessionProbe onChange={onChange} />
      </StrictMode>,
      // A hook probe, with nothing routed.
      { router: false },
    );
    await screen.getByRole("button", { name: "Type" }).click();
    expect(onChange).toHaveBeenLastCalledWith("Start, typed");
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

describe("editing a board", () => {
  const Editing = ({
    canvas,
    readOnly = false,
    host,
    boardRef,
    width = 1000,
  }: {
    readonly canvas: CanvasDocument;
    readonly readOnly?: boolean;
    readonly host?: CanvasBoardHost;
    readonly boardRef?: Parameters<typeof CanvasBoard>[0]["ref"];
    readonly width?: number;
  }) => (
    <div style={{ width, height: 700 }}>
      <CanvasBoard
        data={canvas.getState().data}
        mode="free"
        label="Board"
        document={canvas}
        readOnly={readOnly}
        camera={{ x: 0, y: 0, zoom: 1 }}
        {...(host === undefined ? {} : { host })}
        {...(boardRef === undefined ? {} : { ref: boardRef })}
      />
    </div>
  );

  const text = (id: string, x: number, y: number, more: object = {}) => ({
    id,
    type: "text",
    text: id,
    x,
    y,
    width: 200,
    height: 100,
    ...more,
  });
  const newCanvas = (nodes: ReadonlyArray<object>, edges: ReadonlyArray<object> = []) =>
    new CanvasDocument({ document: { nodes, edges }, revision: "r0" });
  const nodeIn = (canvas: CanvasDocument, id: string) =>
    canvas.getState().data.nodes.find((node) => node.id === id);
  const element = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;

  type PointerAt = PointerEventInit & { readonly x: number; readonly y: number };
  const fire = (type: string, target: Element, { x, y, ...init }: PointerAt) => {
    const { left, top } = board().getBoundingClientRect();
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: left + x,
        clientY: top + y,
        ...init,
      }),
    );
  };
  /** A press on `target`, moved through each point, and released at the last. */
  const drag = (target: Element, from: PointerAt, ...path: ReadonlyArray<PointerAt>) => {
    fire("pointerdown", target, from);
    for (const point of path) fire("pointermove", board(), point);
    fire("pointerup", board(), path.at(-1) ?? from);
  };
  const click = (target: Element, at: PointerAt) => drag(target, at);

  /** Marked on each test, since a pointer that isn't real has nothing to capture. */
  const setup = () => vi.spyOn(Element.prototype, "setPointerCapture").mockReturnValue();

  it("moves a card on the grid, leaving it where it stacks, and undoes it", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0), text("b", 500, 400)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    drag(element("a"), { x: 50, y: 50 }, { x: 57, y: 58 }, { x: 137, y: 123 });
    await vi.waitFor(() => expect(nodeIn(canvas, "a")).toMatchObject({ x: 80, y: 80 }));
    expect(element("a").style.left).toBe("80px");
    expect(element("a").style.transform).toBe("");
    expect(canvas.getState().data.nodes.map((node) => node.id)).toEqual(["a", "b"]);
    await userEvent.click(document.querySelector("[aria-label='Undo']")!);
    await vi.waitFor(() => expect(nodeIn(canvas, "a")).toMatchObject({ x: 0, y: 0 }));
    expect(canvas.getState().data.nodes.map((node) => node.id)).toEqual(["a", "b"]);
  });

  it("drops the snap with ⌃, holds an axis with Shift, and lets an object beat the grid", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0), text("b", 500, 53)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    drag(element("a"), { x: 50, y: 50 }, { x: 87, y: 73, ctrlKey: true });
    await vi.waitFor(() => expect(nodeIn(canvas, "a")).toMatchObject({ x: 37, y: 23 }));
    drag(element("a"), { x: 50, y: 50 }, { x: 90, y: 60, shiftKey: true });
    await vi.waitFor(() => expect(nodeIn(canvas, "a")).toMatchObject({ x: 80, y: 23 }));
    drag(element("a"), { x: 50, y: 50 }, { x: 50, y: 83 });
    await vi.waitFor(() => expect(nodeIn(canvas, "a")?.y).toBe(53));
  });

  it("carries what's fully inside a group, and duplicates it all with Alt", async () => {
    using _capture = setup();
    const canvas = newCanvas(
      [
        { id: "g", type: "group", label: "G", x: 100, y: 100, width: 500, height: 300 },
        text("in", 120, 120),
        text("in2", 340, 120),
        text("half", 500, 120),
      ],
      [{ id: "e", fromNode: "in", toNode: "in2", label: "joins" }],
    );
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("g")).not.toBeNull());
    const label = element("g").querySelector(".cv-group-label")!;
    drag(label, { x: 110, y: 90 }, { x: 150, y: 90 }, { x: 150, y: 170 });
    await vi.waitFor(() => expect(nodeIn(canvas, "g")).toMatchObject({ x: 140, y: 180 }));
    expect(nodeIn(canvas, "in")).toMatchObject({ x: 160, y: 200 });
    expect(nodeIn(canvas, "half")).toMatchObject({ x: 500, y: 120 });

    drag(
      label,
      { x: 150, y: 170 },
      { x: 200, y: 170, altKey: true },
      { x: 150, y: 570, altKey: true },
    );
    await vi.waitFor(() => expect(canvas.getState().data.nodes).toHaveLength(7));
    expect(nodeIn(canvas, "g")).toMatchObject({ x: 140, y: 180 });
    const copies = canvas.getState().data.edges;
    expect(copies).toHaveLength(2);
    expect(copies[1]).toMatchObject({ label: "joins" });
    expect(copies[1]?.id).not.toBe("e");
    expect(copies[1]?.fromNode).not.toBe("in");
  });

  it("selects by touching a marquee, in either direction, with Shift to add", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0), text("b", 300, 0), text("c", 600, 0)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const selected = () =>
      [...document.querySelectorAll("[data-selected]")].map((node) =>
        node.getAttribute("data-card-id"),
      );
    drag(board(), { x: 400, y: 300 }, { x: 390, y: 290 }, { x: 150, y: 50 });
    await vi.waitFor(() => expect(selected()).toEqual(["a", "b"]));
    drag(board(), { x: 700, y: 300, shiftKey: true }, { x: 690, y: 290 }, { x: 650, y: 50 });
    await vi.waitFor(() => expect(selected()).toEqual(["a", "b", "c"]));
    board().focus();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(selected()).toEqual([]));
  });

  it("makes a 250x60 card centred on a double-click, and keeps it empty", async () => {
    using _capture = setup();
    const canvas = newCanvas([]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(document.querySelector(".cv-hint")).not.toBeNull());
    click(board(), { x: 400, y: 300 });
    click(board(), { x: 400, y: 300 });
    await vi.waitFor(() =>
      expect(canvas.getState().data.nodes[0]).toMatchObject({
        type: "text",
        text: "",
        x: 275,
        y: 270,
        width: 250,
        height: 60,
      }),
    );
    const typing = await vi.waitFor(() => {
      const editor = document.querySelector<HTMLTextAreaElement>(".cv-plain-editor");
      expect(editor).not.toBeNull();
      return editor!;
    });
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(typing.isConnected).toBe(false));
    expect(canvas.getState().data.nodes).toHaveLength(1);
    expect(document.activeElement).toBe(board());
  });

  it("edits a text card on its second click, with no resize while it's typed in", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    click(element("a"), { x: 50, y: 50 });
    await vi.waitFor(() => expect(element("a").hasAttribute("data-selected")).toBe(true));
    click(element("a"), { x: 50, y: 50 });
    const editor = await vi.waitFor(() => {
      const found = document.querySelector<HTMLTextAreaElement>(".cv-plain-editor");
      expect(found).not.toBeNull();
      return found!;
    });
    await userEvent.fill(editor, "line one\nline two\nline three\nline four");
    expect(nodeIn(canvas, "a")?.height).toBe(100);
    expect(canvas.take()?.edits.at(-1)).toMatchObject({ keys: { text: expect.any(String) } });
    click(board(), { x: 800, y: 600 });
    await vi.waitFor(() =>
      expect(nodeIn(canvas, "a")).toMatchObject({
        text: "line one\nline two\nline three\nline four",
      }),
    );
  });

  it("resizes from a handle outside the edge, snapped, down to 50x50", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 100, 100)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    click(element("a"), { x: 150, y: 150 });
    const handleOf = () => document.querySelector("[data-frame-for='a'] [data-handle='se']");
    const handle = await vi.waitFor(() => {
      const found = handleOf();
      expect(found).not.toBeNull();
      return found!;
    });
    drag(handle, { x: 304, y: 204 }, { x: 320, y: 220 }, { x: 353, y: 247 });
    await vi.waitFor(() => expect(nodeIn(canvas, "a")).toMatchObject({ width: 240, height: 140 }));
    const again = handleOf()!;
    drag(again, { x: 344, y: 244 }, { x: 300, y: 200 }, { x: 0, y: 0 });
    await vi.waitFor(() => expect(nodeIn(canvas, "a")).toMatchObject({ width: 50, height: 50 }));
  });

  it("connects from a dot to the side nearest the drop, and not to itself", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0), text("b", 500, 0)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const dot = (id: string, side: string) => element(id).querySelector(`[data-side='${side}']`)!;
    drag(dot("a", "right"), { x: 200, y: 50 }, { x: 300, y: 50 }, { x: 600, y: 95 });
    await vi.waitFor(() => expect(canvas.getState().data.edges).toHaveLength(1));
    expect(canvas.getState().data.edges[0]).toMatchObject({
      fromNode: "a",
      fromSide: "right",
      toNode: "b",
      toSide: "bottom",
    });
    drag(dot("a", "top"), { x: 100, y: 0 }, { x: 110, y: 40 }, { x: 100, y: 50 });
    expect(canvas.getState().data.edges).toHaveLength(1);
  });

  it("draws a card with the Card tool, and joins two cards with the Arrow tool", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0), text("b", 500, 0)]);
    await using screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const select = screen.getByLabelText("Select (V)");
    await userEvent.click(screen.getByLabelText("Card (C)"));
    drag(board(), { x: 100, y: 300 }, { x: 150, y: 330 }, { x: 400, y: 420 });
    await vi.waitFor(() =>
      expect(canvas.getState().data.nodes[2]).toMatchObject({
        type: "text",
        x: 100,
        y: 300,
        width: 300,
        height: 120,
      }),
    );
    await vi.waitFor(() => expect(document.querySelector(".cv-plain-editor")).not.toBeNull());
    await expect.element(select).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(board()));

    await userEvent.keyboard("a");
    await expect
      .element(screen.getByLabelText("Arrow (A)"))
      .toHaveAttribute("aria-pressed", "true");
    drag(element("a"), { x: 100, y: 50 }, { x: 200, y: 60 }, { x: 600, y: 50 });
    await vi.waitFor(() => expect(canvas.getState().data.edges).toHaveLength(1));
    expect(canvas.getState().data.edges[0]).toMatchObject({
      fromNode: "a",
      fromSide: "right",
      toNode: "b",
      toSide: "left",
    });
    await expect.element(select).toHaveAttribute("aria-pressed", "true");
  });

  it("draws with the Pen and draws an arrow from empty board, then removes the stroke", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0)]);
    await using screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const drawings = () => canvas.getState().data.drawings ?? [];
    const pen = screen.getByLabelText("Pen (D)");
    await userEvent.click(pen);
    drag(board(), { x: 300, y: 300 }, { x: 320, y: 310 }, { x: 360, y: 330 }, { x: 400, y: 300 });
    await vi.waitFor(() => expect(drawings()).toHaveLength(1));
    const [stroke] = drawings();
    expect(stroke).toMatchObject({ type: "stroke", x: 300, y: 300 });
    // The Pen stays in hand for the next stroke.
    await expect.element(pen).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("a");
    drag(board(), { x: 300, y: 500 }, { x: 250, y: 400 }, { x: 100, y: 60 });
    await vi.waitFor(() => expect(drawings()).toHaveLength(2));
    expect(drawings()[1]).toMatchObject({
      type: "arrow",
      from: { x: 300, y: 500 },
      to: { node: "a", side: "bottom" },
    });
    await expect
      .element(screen.getByLabelText("Select (V)"))
      .toHaveAttribute("aria-pressed", "true");

    const line = document.querySelector(`[data-drawing-id="${stroke!.id}"] .cv-ink-hit`)!;
    click(line, { x: 320, y: 310 });
    await vi.waitFor(() => expect(line.parentElement?.hasAttribute("data-selected")).toBe(true));
    await userEvent.keyboard("{Backspace}");
    await vi.waitFor(() => expect(drawings().map((ink) => ink.type)).toEqual(["arrow"]));
  });

  it("keeps the Pen in More on a narrow board, and draws with it from there", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0)]);
    await using screen = await render(<Editing canvas={canvas} width={280} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const bar = document.querySelector(".cv-tools[role='toolbar']")!;
    expect(bar.querySelector("[data-tool='pen']")).toBeNull();
    expect(bar.querySelector("[data-tool='select']")).not.toBeNull();
    const more = screen.getByRole("button", { name: "More tools" });
    await userEvent.click(more);
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Pen" }));
    expect(board().dataset.tool).toBe("pen");
    // The tool in hand has left the bar, so More says so.
    await expect.element(more).toHaveAttribute("data-active");
    drag(board(), { x: 60, y: 300 }, { x: 80, y: 310 }, { x: 120, y: 330 }, { x: 160, y: 300 });
    await vi.waitFor(() => expect(canvas.getState().data.drawings).toHaveLength(1));
    expect(canvas.getState().data.drawings?.[0]).toMatchObject({ type: "stroke" });
  });

  it("styles a card and a stroke together from the panel, one undo a change", async () => {
    using _capture = setup();
    const stroke = { id: "s", type: "stroke", x: 600, y: 300, points: [0, 0, 80, 40] };
    const canvas = new CanvasDocument({
      document: { nodes: [text("a", 300, 200)], edges: [], astrolabe: { drawings: [stroke] } },
      revision: "r0",
    });
    await using screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const styles = () => [
      nodeIn(canvas, "a")?.astrolabe?.style,
      canvas.getState().data.drawings?.[0]?.astrolabe?.style,
    ];
    click(element("a"), { x: 350, y: 250 });
    const line = document.querySelector('[data-drawing-id="s"] .cv-ink-hit')!;
    click(line, { x: 640, y: 320, shiftKey: true });
    await vi.waitFor(() => expect(line.parentElement?.hasAttribute("data-selected")).toBe(true));

    await userEvent.click(screen.getByLabelText("Bold"));
    await vi.waitFor(() => expect(styles()).toEqual([{ width: 4 }, { width: 5 }]));
    await expect.element(screen.getByLabelText("Bold")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByLabelText("Green background"));
    await vi.waitFor(() => expect(styles()).toEqual([{ width: 4, fill: "4" }, { width: 5 }]));
    expect(element("a").style.getPropertyValue("--cv-w")).toBe("4");

    await userEvent.click(screen.getByLabelText("Undo"));
    await vi.waitFor(() => expect(styles()).toEqual([{ width: 4 }, { width: 5 }]));
    await userEvent.click(screen.getByLabelText("Undo"));
    await vi.waitFor(() => expect(styles()).toEqual([undefined, undefined]));
  });

  it("stacks what it draws in the file's order, and reorders it from the keys and the Layers row", async () => {
    using _capture = setup();
    // The stroke shares the card's id: kinds are told apart, never mixed up.
    const stroke = { id: "a", type: "stroke", x: 0, y: 0, points: [0, 0, 300, 150] };
    const canvas = new CanvasDocument({
      document: {
        nodes: [text("a", 0, 0), text("b", 100, 50)],
        edges: [],
        astrolabe: { drawings: [stroke] },
      },
      revision: "r0",
    });
    await using screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const stack = () =>
      [...document.querySelector(".cv-world")!.children].flatMap((child) => {
        if (child.classList.contains("cv-card"))
          return [`card:${child.getAttribute("data-card-id")}`];
        const drawn = child.querySelector("[data-drawing-id]")?.getAttribute("data-drawing-id");
        return drawn === null || drawn === undefined ? [] : [`drawing:${drawn}`];
      });
    expect(stack()).toEqual(["card:a", "card:b", "drawing:a"]);
    click(element("a"), { x: 20, y: 20 });
    board().focus();
    await userEvent.keyboard("{Control>}]{/Control}");
    await vi.waitFor(() => expect(stack()).toEqual(["card:b", "card:a", "drawing:a"]));
    await userEvent.keyboard("{Control>}{Shift>}]{/Shift}{/Control}");
    await vi.waitFor(() => expect(stack()).toEqual(["card:b", "drawing:a", "card:a"]));
    expect(canvas.getState().data.nodes.map((node) => node.id)).toEqual(["b", "a"]);
    await userEvent.click(screen.getByLabelText("Send to back"));
    await vi.waitFor(() => expect(stack()).toEqual(["card:a", "card:b", "drawing:a"]));
    await userEvent.click(screen.getByLabelText("Undo"));
    await vi.waitFor(() => expect(stack()).toEqual(["card:b", "drawing:a", "card:a"]));
  });

  it("finds room for a card added without a point", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", -1000, -1000, { width: 2000, height: 2000 })]);
    const handle = createRef<CanvasBoardHandle>();
    await using _screen = await render(<Editing canvas={canvas} boardRef={handle} />, {
      router: false,
    });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    handle.current?.run("add-card");
    await vi.waitFor(() => expect(canvas.getState().data.nodes).toHaveLength(2));
    const [first, added] = canvas.getState().data.nodes;
    expect(overlaps(first!, added!)).toBe(false);
  });

  it("asks what a line dropped in space ends on, and Escape leaves nothing", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const dot = element("a").querySelector("[data-side='right']")!;
    drag(dot, { x: 200, y: 50 }, { x: 300, y: 50 }, { x: 500, y: 200 });
    const add = await vi.waitFor(() => {
      const item = [...document.querySelectorAll("[role='menuitem']")].find((each) =>
        each.textContent?.includes("Add card"),
      );
      expect(item).toBeDefined();
      return item as HTMLElement;
    });
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(add.isConnected).toBe(false));
    expect(canvas.getState().data.edges).toEqual([]);
    expect(document.querySelector(".cv-edge-draft")).toBeNull();

    drag(dot, { x: 200, y: 50 }, { x: 300, y: 50 }, { x: 500, y: 200 });
    await vi.waitFor(() => expect(document.querySelector("[role='menuitem']")).not.toBeNull());
    await userEvent.click(document.querySelector("[role='menuitem']")!);
    await vi.waitFor(() => expect(canvas.getState().data.nodes).toHaveLength(2));
    const added = canvas.getState().data.nodes[1]!;
    expect(added).toMatchObject({ x: 500, y: 170 });
    expect(canvas.getState().data.edges[0]).toMatchObject({
      fromNode: "a",
      toNode: added.id,
      toSide: "left",
    });
  });

  it("moves the nearer end of an arrow to another card, keeping its id", async () => {
    using _capture = setup();
    const canvas = newCanvas(
      [text("a", 0, 0), text("b", 500, 0), text("c", 500, 400)],
      [{ id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" }],
    );
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const hit = await vi.waitFor(() => {
      const found = document.querySelector(".cv-edge-hit");
      expect(found).not.toBeNull();
      return found!;
    });
    drag(hit, { x: 450, y: 50 }, { x: 470, y: 200 }, { x: 510, y: 450 });
    await vi.waitFor(() =>
      expect(canvas.getState().data.edges[0]).toMatchObject({
        id: "e",
        fromNode: "a",
        toNode: "c",
        toSide: "left",
      }),
    );
  });

  it("nudges 20, and undoes three nudges as one", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    click(element("a"), { x: 50, y: 50 });
    board().focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{Shift>}{ArrowDown}{/Shift}");
    await vi.waitFor(() => expect(nodeIn(canvas, "a")).toMatchObject({ x: 40, y: 100 }));
    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(nodeIn(canvas, "a")).toMatchObject({ x: 0, y: 0 }));
  });

  it("makes a group 20 around the selection with its label ready to edit", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 100, 100), text("b", 400, 300)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    board().focus();
    await userEvent.keyboard("{Control>}a{/Control}");
    await userEvent.click(document.querySelector("[aria-label='Create section']")!);
    await vi.waitFor(() =>
      expect(canvas.getState().data.nodes[2]).toMatchObject({
        type: "group",
        label: "Untitled section",
        x: 80,
        y: 80,
        width: 540,
        height: 340,
      }),
    );
    const input = await vi.waitFor(() => {
      const found = document.querySelector<HTMLInputElement>(".cv-label-editor");
      expect(found).not.toBeNull();
      return found!;
    });
    await userEvent.fill(input, "Named");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(canvas.getState().data.nodes[2]).toMatchObject({ label: "Named" }),
    );
  });

  it("shows what each selection can do, and only Zoom when read only", async () => {
    using _capture = setup();
    const canvas = newCanvas(
      [
        text("a", 0, 0),
        { id: "f", type: "file", file: "A.png", x: 400, y: 0, width: 200, height: 100 },
      ],
      [{ id: "e", fromNode: "a", toNode: "f" }],
    );
    const buttons = () =>
      [...document.querySelectorAll(".cv-toolbar > button")].map((each) =>
        each.getAttribute("aria-label"),
      );
    await using screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    click(element("a"), { x: 50, y: 50 });
    await vi.waitFor(() => expect(buttons()).toEqual(["Remove", "Zoom to selection", "Edit"]));
    click(element("f"), { x: 450, y: 50 });
    await vi.waitFor(() => expect(buttons()).toEqual(["Remove", "Zoom to selection"]));
    await screen.rerender(<Editing canvas={canvas} readOnly />);
    await vi.waitFor(() => expect(buttons()).toEqual(["Zoom to selection"]));
    expect(document.querySelector(".cv-tools")).toBeNull();
    drag(element("a"), { x: 50, y: 50 }, { x: 150, y: 150 });
    expect(nodeIn(canvas, "a")).toMatchObject({ x: 0, y: 0 });
  });

  it("opens a card's menu and converts it to a note, keeping its arrows", async () => {
    using _capture = setup();
    const canvas = newCanvas(
      [text("a", 0, 0, { text: "Words" }), text("b", 400, 0)],
      [{ id: "e", fromNode: "a", toNode: "b" }],
    );
    const writeNote = vi.fn(async () => null);
    const listFiles = async () => ["Taken.md"];
    await using _screen = await render(
      <Editing canvas={canvas} host={{ writeNote, listFiles }} />,
      { router: false },
    );
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    await userEvent.click(element("a"), { button: "right" });
    await userEvent.click(
      await vi.waitFor(() => {
        const item = [...document.querySelectorAll("[role='menuitem']")].find((each) =>
          each.textContent?.includes("Convert to file"),
        );
        expect(item).toBeDefined();
        return item as HTMLElement;
      }),
    );
    const input = await vi.waitFor(() => {
      const found = document.querySelector<HTMLInputElement>(".cv-dialog input");
      expect(found?.value).toBe("Untitled");
      return found!;
    });
    await userEvent.fill(input, "Taken");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(writeNote).toHaveBeenCalledWith("Taken 1.md", "Words"));
    await vi.waitFor(() => expect(nodeIn(canvas, "a")).toBeUndefined());
    const card = canvas.getState().data.nodes.find((node) => node.type === "file")!;
    expect(card).toMatchObject({ file: "Taken 1.md", x: 0, y: 0, width: 200, height: 100 });
    expect(canvas.getState().data.edges[0]).toMatchObject({ id: "e", fromNode: card.id });
  });

  it("commits a label when the board is clicked, and a line left in space when a menu goes", async () => {
    using _capture = setup();
    const canvas = newCanvas(
      [text("a", 0, 0), text("b", 500, 0)],
      [{ id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" }],
    );
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    const hit = await vi.waitFor(() => {
      const found = document.querySelector(".cv-edge-hit");
      expect(found).not.toBeNull();
      return found!;
    });
    click(hit, { x: 350, y: 50 });
    click(hit, { x: 350, y: 50 });
    const label = await vi.waitFor(() => {
      const found = document.querySelector<HTMLTextAreaElement>("textarea.cv-label-editor");
      expect(found).not.toBeNull();
      return found!;
    });
    await userEvent.fill(label, "one\ntwo");
    click(board(), { x: 400, y: 500 });
    await vi.waitFor(() =>
      expect(canvas.getState().data.edges[0]).toMatchObject({ label: "one\ntwo" }),
    );

    const dot = element("a").querySelector("[data-side='bottom']")!;
    drag(dot, { x: 100, y: 100 }, { x: 100, y: 150 }, { x: 100, y: 400 });
    await vi.waitFor(() => expect(document.querySelector(".cv-edge-draft")).not.toBeNull());
    await vi.waitFor(() => expect(document.querySelector(".cv-menu")).not.toBeNull());
    click(board(), { x: 800, y: 600 });
    await vi.waitFor(() => expect(document.querySelector(".cv-menu")).toBeNull());
    expect(document.querySelector(".cv-edge-draft")).toBeNull();
    expect(canvas.getState().data.edges).toHaveLength(1);
  });

  it("saves a PNG drawn from the data, with text obscured in privacy mode", async () => {
    using _capture = setup();
    using _click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockReturnValue();
    // Encoding runs on the browser's own schedule, which a busy machine stretches.
    using _encode = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((done) => done(new Blob([], { type: "image/png" })));
    const saved = vi.spyOn(URL, "createObjectURL");
    const canvas = newCanvas([text("a", 0, 0, { color: "3" }), text("b", 400, 0)], []);
    const host: CanvasBoardHost = {
      renderExportDialog: (dialog) => <CanvasExportDialog {...dialog} assetUrl={undefined} />,
    };
    const handle = createRef<CanvasBoardHandle>();
    await using _screen = await render(
      <div style={{ width: 1000, height: 700 }}>
        <CanvasBoard
          ref={handle}
          data={canvas.getState().data}
          mode="free"
          label="Board"
          document={canvas}
          host={host}
        />
      </div>,
      { router: false },
    );
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    handle.current?.run("export-image");
    const dialog = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>(".cv-export");
      expect(found?.textContent).toContain("680 × 180");
      return found!;
    });
    await userEvent.click(dialog.querySelectorAll("input[type='checkbox']")[1]!);
    await userEvent.click(dialog.querySelector("button[type='submit']")!);
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(saved.mock.calls[0]?.[0]).toMatchObject({ type: "image/png" });
    await vi.waitFor(() => expect(document.querySelector(".cv-export")).toBeNull());
  });

  it("pans sideways with Shift, and zooms by default when the setting says so", async () => {
    const canvas = newCanvas([text("a", 0, 0)]);
    const settings = {
      wheel: "zoom",
      cardNames: "always",
      snapToGrid: true,
      snapToObjects: true,
      simpleZoom: 0.3,
    } as const;
    await using screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    wheel({ deltaY: 30, shiftKey: true });
    await vi.waitFor(() => expect(world().style.transform).toBe("translate(-30px, 0px) scale(1)"));
    await screen.rerender(
      <div style={{ width: 1000, height: 700 }}>
        <CanvasBoard
          data={canvas.getState().data}
          mode="free"
          label="Board"
          document={canvas}
          settings={settings}
        />
      </div>,
    );
    wheel({ deltaY: -100 });
    await vi.waitFor(() => expect(world().style.transform).not.toContain("scale(1)"));
    const zoomed = world().style.transform;
    wheel({ deltaY: 40, metaKey: true });
    await vi.waitFor(() => expect(world().style.transform).not.toBe(zoomed));
    expect(world().style.transform).toContain(zoomed.slice(zoomed.indexOf("scale")));
  });

  it("takes a selected card away with a commit that removed it", async () => {
    using _capture = setup();
    const canvas = newCanvas([text("a", 0, 0), text("b", 400, 0)]);
    await using _screen = await render(<Editing canvas={canvas} />, { router: false });
    await vi.waitFor(() => expect(element("a")).not.toBeNull());
    click(element("a"), { x: 50, y: 50 });
    await vi.waitFor(() => expect(document.querySelector(".cv-toolbar")).not.toBeNull());
    canvas.receive({ nodes: [text("b", 400, 0)], edges: [] }, "r1");
    await vi.waitFor(() => expect(document.querySelector(".cv-toolbar")).toBeNull());
    expect(document.querySelector("[data-selected]")).toBeNull();
  });

  it("drags on 5,000 cards without rendering or mounting anything", async () => {
    using _capture = setup();
    const { nodes, edges } = grid(5000);
    const canvas = newCanvas(nodes, edges);
    const commits = vi.fn();
    await using _screen = await render(
      <Profiler id="board" onRender={commits}>
        <Editing canvas={canvas} />
      </Profiler>,
      { router: false },
    );
    await vi.waitFor(() => expect(mountedCards()).toBeGreaterThan(0));
    const mounted = mountedCards();
    const arrows = mountedEdges();
    const card = element("n1");
    fire("pointerdown", card, { x: 620, y: 50 });
    await vi.waitFor(() => expect(card.hasAttribute("data-selected")).toBe(true));
    commits.mockClear();
    const others = [...document.querySelectorAll<HTMLElement>("[data-card-id]")].filter(
      (each) => each !== card,
    );
    const frames = vi.spyOn(window, "requestAnimationFrame");
    for (let step = 1; step <= 40; step++) {
      fire("pointermove", board(), { x: 620 + step * 5, y: 50 + step * 3 });
    }
    await vi.waitFor(() => expect(card.style.transform).not.toBe(""));
    expect(frames.mock.calls.length).toBeLessThanOrEqual(40);
    expect(commits).not.toHaveBeenCalled();
    expect(mountedCards()).toBe(mounted);
    expect(mountedEdges()).toBe(arrows);
    expect(others.every((each) => each.isConnected && each.style.transform === "")).toBe(true);

    fire("pointerup", board(), { x: 820, y: 170 });
    await vi.waitFor(() => expect(nodeIn(canvas, "n1")).toMatchObject({ x: 800, y: 120 }));
    await vi.waitFor(() => expect(card.style.transform).toBe(""));
    expect(mountedCards()).toBeLessThan(40);
  });
});

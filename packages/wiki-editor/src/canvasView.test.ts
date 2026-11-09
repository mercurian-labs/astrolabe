import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CanvasView } from "./canvasView";

const bounds = { x: 0, y: 0, width: 400, height: 300 };

function attached() {
  const classes = new Set<string>();
  const board = {
    clientWidth: 400,
    clientHeight: 300,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLElement;
  const world = {
    style: { transform: "", setProperty: () => undefined },
  } as unknown as HTMLElement;
  const view = new CanvasView();
  const detach = view.attach(board, world, bounds, 0);
  return { view, world, classes, detach };
}

describe("CanvasView", () => {
  let frames: Array<() => void> = [];
  const flush = () => {
    const pending = frames;
    frames = [];
    for (const frame of pending) frame();
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => (frames = []));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a camera as the reader's own, so a resize no longer refits it", () => {
    const { view, world } = attached();
    expect(view.fitted).toBe(true);
    view.restore({ x: 12, y: 34, zoom: 0.5 });
    expect(view.fitted).toBe(false);
    expect(world.style.transform).toBe("translate(12px, 34px) scale(0.5)");
  });

  it("pans with one pointer, and marks the board moving only while pressed", () => {
    const { view, world, classes } = attached();
    view.press(1, 10, 10);
    expect(classes.has("cv-moving")).toBe(true);
    view.drag(1, 40, 30);
    flush();
    expect(world.style.transform).toBe("translate(30px, 20px) scale(1)");
    view.release(1);
    expect(classes.has("cv-moving")).toBe(false);
  });

  it("zooms around the middle of a pinch", () => {
    const { view, world } = attached();
    view.press(1, 100, 100);
    view.press(2, 200, 100);
    view.drag(2, 300, 100);
    flush();
    expect(world.style.transform).toBe("translate(-200px, -100px) scale(2)");
  });

  it("ignores a pointer it never saw pressed, such as a back swipe", () => {
    const { view, world } = attached();
    const fitted = world.style.transform;
    view.drag(9, 50, 50);
    flush();
    expect(world.style.transform).toBe(fitted);
  });

  it("draws at most once a frame, however many moves land in it", () => {
    const { view } = attached();
    view.pan(1, 1);
    view.pan(1, 1);
    view.pan(1, 1);
    expect(frames).toHaveLength(1);
  });

  it("doesn't draw after it is detached", () => {
    const { view, world, detach } = attached();
    const fitted = world.style.transform;
    view.pan(5, 5);
    detach();
    flush();
    expect(world.style.transform).toBe(fitted);
  });
});

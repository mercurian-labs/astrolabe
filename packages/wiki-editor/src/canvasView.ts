import type { CanvasBounds } from "@mercurian/wiki/canvas";

import { fitCamera, zoomAt, ZOOM_STEP, type CanvasCamera } from "./canvasGeometry";

const WHEEL_ZOOM_SPEED = 0.01;

/** Told where the camera ended up, each time it draws. */
export type CanvasPaint = (camera: CanvasCamera, width: number, height: number) => void;

/**
 * A board's camera and gestures, on the element and not in React. It draws at most once a frame
 * while something moves, and not at all at rest.
 */
export class CanvasView {
  #board: HTMLElement | null = null;
  #world: HTMLElement | null = null;
  #bounds: CanvasBounds = { x: 0, y: 0, width: 0, height: 0 };
  #padding = 0;
  #camera: CanvasCamera = { x: 0, y: 0, zoom: 1 };
  /** Until the reader moves it, the board keeps fitting as its frame resizes. */
  #fitted = true;
  #frame: number | null = null;
  #onPaint: CanvasPaint | undefined;
  readonly #pointers = new Map<number, { readonly x: number; readonly y: number }>();

  /** Starts showing `bounds` in `board`. Returns the way to stop. */
  attach(
    board: HTMLElement,
    world: HTMLElement,
    bounds: CanvasBounds,
    padding: number,
    onPaint?: CanvasPaint,
  ) {
    this.#board = board;
    this.#world = world;
    this.#bounds = bounds;
    this.#padding = padding;
    this.#onPaint = onPaint;
    this.fit();
    const observer = new ResizeObserver(() => {
      if (this.#fitted) this.fit();
      else this.#paint();
    });
    observer.observe(board);
    return () => {
      observer.disconnect();
      if (this.#frame !== null) cancelAnimationFrame(this.#frame);
      this.#frame = null;
      this.#board = null;
      this.#world = null;
      this.#onPaint = undefined;
    };
  }

  /** Whether the board is fitted: the reader hasn't moved it, so it follows its frame. */
  get fitted() {
    return this.#fitted;
  }

  /** Back where the reader left it, on a page that had to load again. */
  restore(camera: CanvasCamera) {
    this.#camera = camera;
    this.#fitted = false;
    this.#paint();
  }

  /** New contents. The camera stays where the reader left it: only `refit` moves it. */
  setBounds(bounds: CanvasBounds, refit: boolean) {
    this.#bounds = bounds;
    if (refit) this.fit();
    else this.#paint();
  }

  fit() {
    if (this.#board === null) return;
    this.#camera = fitCamera(
      this.#bounds,
      this.#board.clientWidth,
      this.#board.clientHeight,
      this.#padding,
    );
    this.#fitted = true;
    this.#paint();
  }

  /** Shows `rect` whole, never closer than actual size. */
  focus(rect: CanvasBounds) {
    if (this.#board === null) return;
    this.#move(fitCamera(rect, this.#board.clientWidth, this.#board.clientHeight, this.#padding));
  }

  pan(dx: number, dy: number) {
    this.#move({ ...this.#camera, x: this.#camera.x + dx, y: this.#camera.y + dy });
  }

  zoomBy(factor: number) {
    if (this.#board === null) return;
    const { clientWidth, clientHeight } = this.#board;
    this.#move(zoomAt(this.#camera, clientWidth / 2, clientHeight / 2, factor));
  }

  zoomIn() {
    this.zoomBy(ZOOM_STEP);
  }

  zoomOut() {
    this.zoomBy(1 / ZOOM_STEP);
  }

  /** Back to actual size, about the frame's centre. */
  resetZoom() {
    this.zoomBy(1 / this.#camera.zoom);
  }

  wheel(event: WheelEvent) {
    if (this.#board === null) return;
    if (!event.ctrlKey && !event.metaKey) {
      this.pan(-event.deltaX, -event.deltaY);
      return;
    }
    const rect = this.#board.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED);
    this.#move(zoomAt(this.#camera, event.clientX - rect.left, event.clientY - rect.top, factor));
  }

  press(id: number, x: number, y: number) {
    this.#pointers.set(id, { x, y });
    this.#board?.classList.add("cv-moving");
  }

  drag(id: number, x: number, y: number) {
    const previous = this.#pointers.get(id);
    if (previous === undefined || this.#board === null) return;
    const other = [...this.#pointers].find(([each]) => each !== id)?.[1];
    this.#pointers.set(id, { x, y });
    if (other === undefined) {
      this.pan(x - previous.x, y - previous.y);
      return;
    }
    const before = Math.hypot(previous.x - other.x, previous.y - other.y);
    if (before === 0) return;
    const rect = this.#board.getBoundingClientRect();
    this.#move(
      zoomAt(
        this.#camera,
        (x + other.x) / 2 - rect.left,
        (y + other.y) / 2 - rect.top,
        Math.hypot(x - other.x, y - other.y) / before,
      ),
    );
  }

  release(id: number) {
    this.#pointers.delete(id);
    if (this.#pointers.size === 0) this.#board?.classList.remove("cv-moving");
  }

  #move(next: CanvasCamera) {
    this.#camera = next;
    this.#fitted = false;
    this.#frame ??= requestAnimationFrame(() => this.#paint());
  }

  #paint() {
    this.#frame = null;
    if (this.#world === null) return;
    const { x, y, zoom } = this.#camera;
    this.#world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    // Labels, borders and arrows thin out slower than the board, so they stay readable.
    this.#world.style.setProperty("--cv-ui", String(1 / Math.sqrt(zoom)));
    if (this.#board !== null) {
      this.#onPaint?.(this.#camera, this.#board.clientWidth, this.#board.clientHeight);
    }
  }
}

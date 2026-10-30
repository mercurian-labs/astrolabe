/**
 * The file graph's painter on Pixi.js v8: a transparent canvas over the pane, so the pane's own
 * background shows, with links and nodes as two Graphics and a Text per label. Pixi never runs
 * its own loop: the ticker never starts, and a frame is rendered only when one is handed over.
 */
import {
  AccessibilitySystem,
  Application,
  Container,
  Graphics,
  Text,
  TextStyle,
  Ticker,
} from "pixi.js";

import { LABEL_GAP, type FileGraphDrawer, type FileGraphFrame } from "./FileGraphRenderer.ts";

/** Labels are set at this size in world units: 12 CSS pixels at zoom 1. */
const LABEL_PIXELS = 12;
/** An arrowhead's length and half-width, in CSS pixels at link thickness 1. */
const ARROW_LENGTH = 7;
const ARROW_HALF = 2.6;
/** A changed file's ring stands this far outside its node, in world units. */
const RING_GAP = 2.5;

/** Labels are rasterised for the zoom they are drawn at, in steps, so they stay crisp. */
const resolutionStep = (zoom: number) => (zoom > 2 ? 4 : zoom > 1 ? 2 : 1);

class PixiFileDrawer implements FileGraphDrawer {
  readonly #host: HTMLElement;
  readonly #pixelRatio: number;
  #app: Application | null = null;
  #world: Container | null = null;
  #links: Graphics | null = null;
  #nodes: Graphics | null = null;
  #labels: Container | null = null;
  readonly #texts = new Map<string, Text>();
  #style: TextStyle | null = null;
  #resolution = 0;
  #width = 1;
  #height = 1;
  #pending: FileGraphFrame | null = null;
  #last: FileGraphFrame | null = null;
  #disposed = false;

  constructor(host: HTMLElement, pixelRatio: number) {
    this.#host = host;
    this.#pixelRatio = pixelRatio;
    void this.#init();
  }

  async #init(): Promise<void> {
    // Pixi's accessibility overlay would start the shared ticker on a Tab press: a loop at rest.
    AccessibilitySystem.defaultOptions = {
      ...AccessibilitySystem.defaultOptions,
      enabledByDefault: false,
      activateOnTab: false,
    };
    const app = new Application();
    await app.init({
      width: this.#width,
      height: this.#height,
      resolution: this.#pixelRatio,
      autoDensity: true,
      antialias: true,
      backgroundAlpha: 0,
      preference: "webgl",
      autoStart: false,
      sharedTicker: false,
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    if (this.#disposed) {
      app.destroy(true, { children: true });
      return;
    }
    app.renderer.resize(this.#width, this.#height);
    app.ticker.stop();
    Ticker.system.autoStart = false;
    Ticker.system.stop();
    const canvas = app.canvas;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    this.#host.append(canvas);
    const world = new Container();
    const links = new Graphics();
    const nodes = new Graphics();
    const labels = new Container();
    world.addChild(links, nodes, labels);
    app.stage.addChild(world);
    app.stage.eventMode = "none";
    this.#app = app;
    this.#world = world;
    this.#links = links;
    this.#nodes = nodes;
    this.#labels = labels;
    const pending = this.#pending;
    this.#pending = null;
    if (pending !== null) this.draw(pending);
    // The app's font may still be loading: labels set before it lands are set again once it has.
    void document.fonts?.ready.then(() => {
      if (this.#disposed) return;
      this.#style?.update();
      const last = this.#last;
      if (last !== null) this.draw(last);
    });
  }

  resize(width: number, height: number): void {
    this.#width = width;
    this.#height = height;
    this.#app?.renderer.resize(width, height);
  }

  draw(frame: FileGraphFrame): void {
    this.#last = frame;
    const app = this.#app;
    const world = this.#world;
    const links = this.#links;
    const nodes = this.#nodes;
    const labels = this.#labels;
    if (app === null || world === null || links === null || nodes === null || labels === null) {
      this.#pending = frame;
      return;
    }
    const { camera } = frame;
    const zoom = camera.zoom;
    world.scale.set(zoom);
    world.position.set(frame.width / 2 - camera.x * zoom, frame.height / 2 - camera.y * zoom);
    // Lines keep their width on screen whatever the zoom: world widths are divided by it.
    const line = frame.lineWidth / zoom;

    links.clear();
    for (const link of frame.links) {
      let { x2, y2 } = link;
      if (link.arrow) {
        const length = Math.hypot(x2 - link.x1, y2 - link.y1);
        const scale = Math.sqrt(frame.lineWidth) / zoom;
        const head = Math.min(length, ARROW_LENGTH * scale);
        const ux = (x2 - link.x1) / length;
        const uy = (y2 - link.y1) / length;
        const half = ARROW_HALF * scale;
        const baseX = x2 - ux * head;
        const baseY = y2 - uy * head;
        links
          .poly([
            x2,
            y2,
            baseX - uy * half,
            baseY + ux * half,
            baseX + uy * half,
            baseY - ux * half,
          ])
          .fill({ color: link.color, alpha: link.alpha });
        x2 = baseX;
        y2 = baseY;
      }
      links
        .moveTo(link.x1, link.y1)
        .lineTo(x2, y2)
        .stroke({ width: line, color: link.color, alpha: link.alpha });
    }

    nodes.clear();
    for (const node of frame.nodes) {
      if (node.hollow) {
        nodes
          .circle(node.x, node.y, node.radius)
          .fill({ color: frame.paper, alpha: node.alpha })
          .stroke({ width: 1.5 / zoom, color: node.fill, alpha: node.alpha });
      } else {
        nodes.circle(node.x, node.y, node.radius).fill({ color: node.fill, alpha: node.alpha });
      }
      if (node.ring !== null) {
        nodes
          .circle(node.x, node.y, node.radius + RING_GAP)
          .stroke({ width: 1.2 / zoom, color: node.ring, alpha: node.alpha });
      }
    }

    this.#drawLabels(frame, labels);
    app.renderer.render(app.stage);
    // The system ticker only collects unused textures here; it steps when a frame draws.
    Ticker.system.update();
  }

  #drawLabels(frame: FileGraphFrame, labels: Container): void {
    const resolution = this.#pixelRatio * resolutionStep(frame.camera.zoom);
    const restyled = this.#style === null || this.#style.fontFamily !== frame.font;
    if (restyled) {
      this.#style = new TextStyle({
        fontFamily: frame.font,
        fontSize: LABEL_PIXELS,
        fill: 0xffffff,
      });
    }
    const style = this.#style;
    if (style === null) return;
    const seen = new Set<string>();
    for (const node of frame.nodes) {
      seen.add(node.id);
      let text = this.#texts.get(node.id);
      if (text === undefined) {
        text = new Text({ text: node.label, style, resolution });
        text.anchor.set(0.5, 0);
        labels.addChild(text);
        this.#texts.set(node.id, text);
      } else {
        if (text.text !== node.label) text.text = node.label;
        if (restyled) text.style = style;
        if (this.#resolution !== resolution) text.resolution = resolution;
      }
      text.visible = node.labelAlpha > 0.01;
      text.alpha = node.labelAlpha;
      text.tint = node.labelColor;
      text.position.set(node.x, node.y + node.radius + LABEL_GAP);
    }
    for (const [id, text] of this.#texts) {
      if (seen.has(id)) continue;
      text.destroy();
      this.#texts.delete(id);
    }
    // What a hover lights comes last in the frame, so its labels sit over the rest.
    const ordered = frame.nodes.flatMap((node) => this.#texts.get(node.id) ?? []);
    if (ordered.some((text, at) => labels.children[at] !== text)) {
      labels.removeChildren();
      labels.addChild(...ordered);
    }
    this.#resolution = resolution;
  }

  dispose(): void {
    this.#disposed = true;
    for (const text of this.#texts.values()) text.destroy();
    this.#texts.clear();
    this.#app?.destroy(true, { children: true });
    this.#app = null;
  }
}

export const createPixiFileDrawer = (host: HTMLElement): FileGraphDrawer =>
  new PixiFileDrawer(host, window.devicePixelRatio || 1);

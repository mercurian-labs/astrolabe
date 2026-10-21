/**
 * "pixi": the flat reading drawn with Pixi.js v8 on its own canvas. The
 * shared flat controller runs the graph; this drawer turns each frame into
 * Pixi scene objects: nodes as tinted sprites cut from three textures (body,
 * ring, amended mark), edges as one Graphics redrawn per frame, beads as
 * sprites, labels as BitmapText from IBM Plex Mono (a second font, stroked
 * in paper, for the outlined prominent labels, drawn on top).
 *
 * Pixi never runs its own loop: the application's ticker never starts, and
 * the system ticker (texture GC) is stepped only when a frame is drawn, so
 * the graph at rest costs zero frames and no animation-frame callbacks.
 * Draw calls are counted by wrapping the WebGL context's draw functions.
 */
import {
  AccessibilitySystem,
  Application,
  BitmapFont,
  BitmapText,
  Container,
  Graphics,
  Sprite,
  Ticker,
  WebGLRenderer,
} from "pixi.js";
import { Color, Vector3 } from "three";

import { WAVE_SECONDS } from "../../layout/motion.ts";
import { EdgeDirection, EdgeKind, NodeFlag, type GraphView } from "../../model/view.ts";
import { flatToScreen } from "../camera.ts";
import type { EdgeStyle } from "../edgeStyle.ts";
import { FlatRenderer } from "../flat/FlatRenderer.ts";
import type { DrawerHost, FlatDrawer, FlatFrame } from "../flat/drawer.ts";
import { LABEL_PIXELS } from "../labels.ts";
import { type NodeState, StyleChannel } from "../nodeState.ts";
import type { GraphRenderer, RendererCallbacks, RendererOptions } from "../renderer.ts";
import { edgeWidthScale } from "../shaders.ts";
import { shapeReach } from "../shapes.ts";
import type { GraphTheme } from "../theme.ts";
import { StickyPool } from "../pool.ts";
import type { Mark, MarkColor } from "../gestures.ts";
import {
  namedRegions,
  REGION_LIFT_ALPHA,
  REGION_NAME_OPACITY,
  REGION_NAME_PIXELS,
  regionTints,
} from "../regions.ts";
import { timeRender, type GpuMemory, type GpuTimer } from "../probe.ts";
import type { DrawnGraph } from "../workingSet.ts";
import { destroyArt, mixHex, paintArt, waveOffset, type Art } from "./art.ts";
import { documentFaces } from "./fonts.ts";

/** The labels' characters: printable ASCII, Latin-1, and the punctuation notes use. */
// The kinds' shape glyphs ride in the cursor's chip.
const CHARS: Array<string | Array<string>> = [[" ", "~"], ["¡", "ÿ"], "–—‘’“”…→·●■◆⬢▲▪◎"];
/** Glyphs are rasterised this much above the device pixel ratio, so a grown label stays crisp. */
const GLYPH_HEADROOM = 1.3;
const EDGE_ALPHA = 0.85;
const RIBBON_SAMPLES = 12;
let fontSerial = 0;

interface NodeSprites {
  readonly body: Sprite;
  readonly ring: Sprite;
  readonly mark: Sprite;
}

interface Stage {
  /** The open containers' discs and names, under everything else. */
  readonly regions: Graphics;
  readonly regionNames: Container;
  readonly edges: Graphics;
  readonly nodes: Container;
  readonly beads: Container;
  /** The worked notes' quiet marks and the story's marks (gestures, the cursor). */
  readonly marks: Graphics;
  readonly labels: Container;
  readonly prominent: Container;
  /** The cursor's caret and its label's chip, over the labels. */
  readonly agentMarks: Graphics;
  /** The cursor's words. */
  readonly agent: Container;
}

class PixiDrawer implements FlatDrawer {
  readonly #host: DrawerHost;
  #app: Application | null = null;
  readonly #renderCall = () => this.#app?.renderer.render(this.#app.stage);
  #stage: Stage | null = null;
  #art: Art | null = null;
  #disposed = false;
  #graph: { readonly universe: DrawnGraph; readonly state: NodeState } | null = null;
  /** Pooled per note in view: sprites for nodes, BitmapText for plain and outlined labels. */
  #nodeSprites: StickyPool<NodeSprites> | null = null;
  #plainTexts: StickyPool<BitmapText> | null = null;
  #outlinedTexts: StickyPool<BitmapText> | null = null;
  /** Region names, by the container's universe index. */
  #regionTexts: StickyPool<BitmapText> | null = null;
  #beads: Array<Sprite> = [];
  #edgesDrawn = 0;
  #width = 1;
  #height = 1;
  #calls = 0;
  #drawCalls = 0;
  /** The CSS family the glyphs are drawn from, and the installed bitmap fonts' names. */
  #family = "'IBM Plex Mono', monospace";
  #fontUrl: string | undefined = undefined;
  /** The view's uncaught throwers' slots, found once per view rather than per frame. */
  #uncaught: { readonly view: GraphView | null; readonly slots: ReadonlyArray<number> } = {
    view: null,
    slots: [],
  };
  #plainFont: string | null = null;
  #outlineFont: string | null = null;
  /** The ink and paper the outlined font was drawn in. */
  #outlineColours = "";
  #theme: GraphTheme | null = null;
  /** The label font file's face in the document, removed on dispose. */
  readonly #faces = documentFaces();

  constructor(host: DrawerHost) {
    this.#host = host;
    void this.#init();
  }

  get drawCalls(): number {
    return this.#drawCalls;
  }

  get edgesDrawn(): number {
    return this.#edgesDrawn;
  }

  get gl(): WebGL2RenderingContext | null {
    const renderer = this.#app?.renderer;
    return renderer instanceof WebGLRenderer ? renderer.gl : null;
  }

  /** Pixi's managed textures; its buffer count is private, so buffers are not reported. */
  memory(): GpuMemory {
    const renderer = this.#app?.renderer;
    return {
      textures: renderer instanceof WebGLRenderer ? renderer.texture.managedTextures.length : null,
      buffers: null,
    };
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
      resolution: this.#host.pixelRatio,
      autoDensity: true,
      antialias: true,
      preference: "webgl",
      autoStart: false,
      sharedTicker: false,
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    if (this.#disposed) {
      app.destroy(true, { children: true });
      return;
    }
    // The host may have resized while init was pending (it always does on mount):
    // size the backing store from the latest size, not the one init began with.
    app.renderer.resize(this.#width, this.#height);
    app.ticker.stop();
    // The system ticker only runs texture GC here; it is stepped when a frame draws.
    Ticker.system.autoStart = false;
    Ticker.system.stop();
    const renderer = app.renderer;
    if (renderer instanceof WebGLRenderer) this.#countDraws(renderer.gl);
    const canvas = app.canvas;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    this.#host.container.append(canvas);
    const stage: Stage = {
      regions: new Graphics(),
      regionNames: new Container(),
      edges: new Graphics(),
      nodes: new Container(),
      beads: new Container(),
      marks: new Graphics(),
      labels: new Container(),
      prominent: new Container(),
      agentMarks: new Graphics(),
      agent: new Container(),
    };
    app.stage.addChild(
      stage.regions,
      stage.regionNames,
      stage.edges,
      stage.nodes,
      stage.beads,
      stage.marks,
      stage.labels,
      stage.prominent,
      stage.agentMarks,
      stage.agent,
    );
    app.stage.eventMode = "none";
    this.#app = app;
    this.#stage = stage;
    this.#art = paintArt();
    this.#beads = Array.from({ length: 320 }, () => this.#sprite(stage.beads));
    await this.#installFonts();
    const graph = this.#graph;
    if (graph !== null) this.#build();
    this.#host.redraw();
  }

  /** Count every GL draw call the renderer issues (instanced ones too, where the context has them). */
  #countDraws(gl: WebGL2RenderingContext): void {
    const drawElements = gl.drawElements.bind(gl);
    const drawArrays = gl.drawArrays.bind(gl);
    gl.drawElements = (...args: Parameters<typeof drawElements>) => {
      this.#calls += 1;
      drawElements(...args);
    };
    gl.drawArrays = (...args: Parameters<typeof drawArrays>) => {
      this.#calls += 1;
      drawArrays(...args);
    };
    // A WebGL 1 fallback context has no instanced draws of its own.
    if (typeof gl.drawElementsInstanced !== "function") return;
    const drawElementsInstanced = gl.drawElementsInstanced.bind(gl);
    const drawArraysInstanced = gl.drawArraysInstanced.bind(gl);
    gl.drawElementsInstanced = (...args: Parameters<typeof drawElementsInstanced>) => {
      this.#calls += 1;
      drawElementsInstanced(...args);
    };
    gl.drawArraysInstanced = (...args: Parameters<typeof drawArraysInstanced>) => {
      this.#calls += 1;
      drawArraysInstanced(...args);
    };
  }

  #sprite(parent: Container): Sprite {
    const sprite = new Sprite(this.#art?.disc);
    sprite.anchor.set(0.5);
    sprite.visible = false;
    parent.addChild(sprite);
    return sprite;
  }

  setGraph(universe: DrawnGraph, state: NodeState, _edgeStyle: EdgeStyle): void {
    this.#graph = { universe, state };
    if (this.#stage !== null) this.#build();
  }

  /** Set up the pools for the slots; nothing is made per note until it comes into view. */
  #build(): void {
    const stage = this.#stage;
    if (stage === null) return;
    this.#clearPools();
    this.#nodeSprites = new StickyPool(
      () => ({
        body: this.#sprite(stage.nodes),
        ring: this.#sprite(stage.nodes),
        mark: this.#sprite(stage.nodes),
      }),
      (sprites) => {
        sprites.body.visible = sprites.ring.visible = sprites.mark.visible = false;
      },
    );
    const plain = this.#plainFont;
    this.#plainTexts = plain === null ? null : this.#textPool(stage.labels, plain);
    this.#regionTexts = plain === null ? null : this.#textPool(stage.regionNames, plain);
    this.#resetOutlined();
  }

  /** A pool of labels in `layer` drawn with bitmap font `font`. */
  #textPool(layer: Container, font: string): StickyPool<BitmapText> {
    return new StickyPool(
      () => {
        const text = new BitmapText({
          text: "",
          style: { fontFamily: font, fontSize: LABEL_PIXELS },
        });
        text.anchor.set(0, 0.5);
        text.visible = false;
        layer.addChild(text);
        return text;
      },
      (text) => {
        text.visible = false;
      },
    );
  }

  /** The outlined labels follow the outline font: a new font starts a new pool. */
  #resetOutlined(): void {
    for (const text of this.#outlinedTexts?.items ?? []) text.destroy();
    const stage = this.#stage;
    const font = this.#outlineFont;
    this.#outlinedTexts =
      stage === null || font === null ? null : this.#textPool(stage.prominent, font);
  }

  #clearPools(): void {
    for (const sprites of this.#nodeSprites?.items ?? []) {
      sprites.body.destroy();
      sprites.ring.destroy();
      sprites.mark.destroy();
    }
    for (const text of this.#plainTexts?.items ?? []) text.destroy();
    for (const text of this.#outlinedTexts?.items ?? []) text.destroy();
    for (const text of this.#regionTexts?.items ?? []) text.destroy();
    this.#nodeSprites = null;
    this.#regionTexts = null;
    this.#plainTexts = null;
    this.#outlinedTexts = null;
  }

  setLabelFont(font: string | undefined): void {
    if (font === this.#fontUrl) return;
    this.#fontUrl = font;
    if (this.#app !== null) void this.#installFonts().then(() => this.#rebuildLabels());
  }

  #rebuildLabels(): void {
    const graph = this.#graph;
    if (graph !== null) this.#build();
    this.#host.redraw();
  }

  /** Load the label font file, if one is given, and install the plain and outlined bitmap fonts from it. */
  async #installFonts(): Promise<void> {
    const url = this.#fontUrl;
    if (url !== undefined) {
      const loaded = await this.#faces.load("AtlasGraphLabel", url);
      this.#family = loaded ? "AtlasGraphLabel" : "'IBM Plex Mono', monospace";
    }
    if (this.#disposed) return;
    this.#uninstallFonts();
    fontSerial += 1;
    const name = `atlas-graph-label-${fontSerial}`;
    BitmapFont.install({
      name,
      style: { fontFamily: this.#family, fontSize: LABEL_PIXELS, fill: 0xffffff },
      chars: CHARS,
      resolution: this.#host.pixelRatio * GLYPH_HEADROOM,
      dynamicFill: true,
    });
    this.#plainFont = name;
    this.#installOutlineFont();
  }

  /** The prominent labels' font: ink glyphs stroked in paper, so it follows the theme. */
  #installOutlineFont(): void {
    const theme = this.#theme;
    this.#outlineColours = outlineColours(theme);
    if (this.#outlineFont !== null) BitmapFont.uninstall(this.#outlineFont);
    fontSerial += 1;
    const name = `atlas-graph-label-outline-${fontSerial}`;
    BitmapFont.install({
      name,
      style: {
        fontFamily: this.#family,
        fontSize: LABEL_PIXELS,
        fill: theme?.ink.getHex() ?? 0x23211d,
        stroke: { color: theme?.paper.getHex() ?? 0xf8f7f3, width: 3, join: "round" },
      },
      chars: CHARS,
      resolution: this.#host.pixelRatio * GLYPH_HEADROOM,
    });
    this.#outlineFont = name;
    this.#resetOutlined();
  }

  #uninstallFonts(): void {
    if (this.#plainFont !== null) BitmapFont.uninstall(this.#plainFont);
    if (this.#outlineFont !== null) BitmapFont.uninstall(this.#outlineFont);
    this.#plainFont = null;
    this.#outlineFont = null;
  }

  /** Always kept, so a resize while the app is still initialising is applied once it is ready. */
  resize(width: number, height: number): void {
    const unsized = this.#unsized;
    this.#width = width;
    this.#height = height;
    this.#app?.renderer.resize(width, height);
    // A frame skipped for want of a size draws now that there is one.
    if (unsized && !this.#unsized) this.#host.redraw();
  }

  /** The host has not given the canvas a real size yet. */
  get #unsized(): boolean {
    return this.#width <= 1 || this.#height <= 1;
  }

  draw(frame: FlatFrame, gpu: GpuTimer | null): number | null {
    const app = this.#app;
    const stage = this.#stage;
    const art = this.#art;
    // Not ready (the app or the label font is still loading): nothing renders, nothing is timed.
    if (app === null || stage === null || art === null || this.#nodeSprites === null) return null;
    // No real size yet: draw nothing; the resize that brings one asks for a frame.
    if (this.#unsized) return null;
    if (frame.dirty.theme || this.#theme === null) {
      this.#theme = frame.theme;
      app.renderer.background.color = frame.theme.paper.getHex();
      if (outlineColours(frame.theme) !== this.#outlineColours) this.#installOutlineFont();
    }
    const theme = frame.theme;
    this.#drawRegions(frame, stage.regions, theme);
    this.#drawEdges(frame, stage.edges, theme);
    this.#drawNodes(frame, art, theme);
    this.#drawBeads(frame, art, theme);
    this.#drawMarks(frame, stage, theme);
    this.#drawLabels(frame, theme);
    Ticker.system.update(performance.now());
    this.#calls = 0;
    const renderMs = timeRender(this.#renderCall, gpu);
    this.#drawCalls = this.#calls;
    return renderMs;
  }

  #screen(frame: FlatFrame, x: number, y: number): readonly [number, number] {
    return flatToScreen(frame.camera, frame.width, frame.height, x, y);
  }

  #drawNodes(frame: FlatFrame, art: Art, theme: GraphTheme): void {
    const pool = this.#nodeSprites;
    if (pool === null) return;
    const { state, view, inView, camera } = frame;
    const at = new Vector3();
    pool.begin();
    for (let index = 0; index < state.count; index += 1) {
      if (inView[index] !== 1) continue;
      const visibility = state.styleOf(index, StyleChannel.visibility);
      const radius = state.drawnRadius(index) * visibility * camera.scale;
      if (visibility < 0.004 || radius < 0.1) continue;
      const { body, ring, mark } = pool.take(index).item;
      state.current(index, at);
      const [x, y] = this.#screen(frame, at.x, at.y);
      const flags = view.nodeFlags[index] ?? 0;
      const frontier = (flags & NodeFlag.frontier) !== 0;
      const lens = theme.lenses[view.nodeSlot[index] ?? -1] ?? theme.ink;
      const base = !frontier && (flags & NodeFlag.new) !== 0 ? theme.accent : lens;
      const emphasis = Math.max(
        state.styleOf(index, StyleChannel.emphasis),
        state.prominence.values[index] ?? 0,
      );
      const strength = 0.14 + 0.86 * emphasis;
      // A codebase's kinds draw as shapes; a circle (or a vault's note) keeps the disc's textures.
      const shaped = art.shapes[view.nodeShape[index] ?? 0] ?? null;
      const reach = shaped?.reach ?? 1;
      body.visible = true;
      body.texture =
        shaped === null
          ? frontier
            ? art.hollow
            : art.sphere
          : frontier
            ? shaped.hollow
            : shaped.body;
      body.position.set(x, y);
      body.width = body.height = 2 * radius * reach;
      body.tint = mixHex(theme.paper, base, strength);
      // Outside the disc: the picked or hovered note's ink ring. (A worked note's
      // quiet mark, a hairline, is drawn with the story's marks.)
      const hovered = state.styleOf(index, StyleChannel.hover) > 0.5;
      const ringStrength = 0.14 + 0.86 * Math.max(emphasis, 0.9);
      ring.visible = hovered || (flags & NodeFlag.picked) !== 0;
      if (ring.visible) {
        ring.texture = art.ringThin;
        ring.position.set(x, y);
        ring.width = ring.height = 3 * radius * reach;
        ring.alpha = 1;
        ring.tint = mixHex(theme.paper, theme.ink, ringStrength);
      }
      mark.visible = !frontier && (flags & NodeFlag.amended) !== 0;
      if (mark.visible) {
        mark.texture = shaped?.fill ?? art.disc;
        mark.position.set(x, y);
        mark.width = mark.height = 0.72 * radius * reach;
        mark.tint = mixHex(theme.paper, theme.accent, strength);
      }
    }
    pool.end();
  }

  /** The open containers: faint discs, alternating by depth, and the names of those large enough on screen. */
  #drawRegions(frame: FlatFrame, graphics: Graphics, theme: GraphTheme): void {
    graphics.clear();
    const { view, regionCircles: circles, camera } = frame;
    const ink = theme.ink.getHex();
    const paper = theme.paper.getHex();
    // The same lightness step from paper in any appearance, the rim a device pixel wide.
    const tints = regionTints(`#${theme.paper.getHexString()}`, `#${theme.ink.getHexString()}`);
    const hairline = 1 / Math.min(globalThis.devicePixelRatio || 1, 2);
    view.regions.forEach((region, position) => {
      const r = (circles[position * 4 + 3] ?? 0) * camera.scale;
      if (r <= 0 || region.bare === true) return;
      const [x, y] = this.#screen(
        frame,
        circles[position * 4] ?? 0,
        circles[position * 4 + 1] ?? 0,
      );
      const odd = region.depth % 2 === 1;
      graphics
        .circle(x, y, r)
        .fill(odd ? paper : ink, odd ? REGION_LIFT_ALPHA : tints.fill)
        .stroke({ color: ink, alpha: tints.rim, width: hairline });
    });
    const pool = this.#regionTexts;
    if (pool === null) return;
    pool.begin();
    for (const position of namedRegions(view.regions, circles, camera.scale)) {
      const region = view.regions[position];
      if (region === undefined) continue;
      const r = circles[position * 4 + 3] ?? 0;
      const { item: text } = pool.take(region.note);
      if (text.text !== region.name) text.text = region.name;
      // Just inside the disc's upper left: on the edge, out of the notes' way.
      const [x, y] = this.#screen(
        frame,
        (circles[position * 4] ?? 0) - r * 0.62,
        (circles[position * 4 + 1] ?? 0) + r * 0.74,
      );
      text.visible = true;
      text.position.set(x, y);
      text.scale.set(REGION_NAME_PIXELS / LABEL_PIXELS);
      text.alpha = REGION_NAME_OPACITY;
      text.tint = ink;
    }
    pool.end();
  }

  #drawEdges(frame: FlatFrame, graphics: Graphics, theme: GraphTheme): void {
    graphics.clear();
    const { state, edgeStyle, view, camera, scale, universe } = frame;
    const a = new Vector3();
    const b = new Vector3();
    const colour = new Color();
    let drawn = 0;
    // Only the edges that show: none at all when nothing is lit.
    for (const index of edgeStyle.lit) {
      const edge = universe.edges[index];
      if (edge === undefined) continue;
      const visibleA = state.styleOf(edge.a, StyleChannel.visibility);
      const visibleB = state.styleOf(edge.b, StyleChannel.visibility);
      const visibility = (edgeStyle.values[index * 2] ?? 0) * Math.min(visibleA, visibleB);
      const attention = edgeStyle.values[index * 2 + 1] ?? 0;
      const alpha = EDGE_ALPHA * attention * visibility;
      if (visibility < 0.004 || alpha < 0.004) continue;
      state.current(edge.a, a);
      state.current(edge.b, b);
      const [ax, ay] = this.#screen(frame, a.x, a.y);
      const [bx, by] = this.#screen(frame, b.x, b.y);
      const length = Math.hypot(bx - ax, by - ay);
      const ra = state.drawnRadius(edge.a) * visibleA * camera.scale;
      const rb = state.drawnRadius(edge.b) * visibleB * camera.scale;
      if (length <= ra + rb) continue;
      drawn += 1;
      const ux = (bx - ax) / length;
      const uy = (by - ay) / length;
      const sx = ax + ux * ra;
      const sy = ay + uy * ra;
      const ex = bx - ux * rb;
      const ey = by - uy * rb;
      const kind = frame.edgeKinds[index] ?? EdgeKind.plain;
      const direction = view.edgeDirection[index] ?? 0;
      const data = (direction & EdgeDirection.data) !== 0;
      const failure = (direction & EdgeDirection.failure) !== 0;
      const violation = (direction & EdgeDirection.violation) !== 0;
      colour.copy(
        failure || violation
          ? theme.warning
          : kind > 0
            ? theme.accent
            : (theme.lenses[view.edgeSlot[index] ?? -1] ?? theme.ink),
      );
      const width = scale.lineWidth * camera.scale * edgeWidthScale(attention);
      const stroke = { width: data ? width * 0.6 : width, color: colour.getHex(), alpha };
      const run = Math.hypot(ex - sx, ey - sy);
      const wave = frame.waves[index] ?? 0;
      const heuristic = (direction & EdgeDirection.heuristic) !== 0;
      if (kind === EdgeKind.broken || heuristic) {
        // Broken where it stood: dashed, with a gap at the middle. A guessed link: finely dashed.
        const broken = kind === EdgeKind.broken;
        const dash = scale.dash * camera.scale * (broken ? 1 : 0.6);
        for (let from = 0; from < run; from += dash) {
          const to = Math.min(run, from + (broken ? 0.55 : 0.6) * dash);
          const middle = (from + to) / 2 / run;
          if (broken && Math.abs(middle - 0.5) < 0.06) continue;
          graphics
            .moveTo(sx + ux * from, sy + uy * from)
            .lineTo(sx + ux * to, sy + uy * to)
            .stroke(stroke);
        }
      } else if (wave > 0 && frame.pulse < WAVE_SECONDS) {
        // A landing wave travels the link and rings down, pinned at both ends.
        const span = a.distanceTo(b);
        graphics.moveTo(sx, sy);
        for (let sample = 1; sample < RIBBON_SAMPLES; sample += 1) {
          const t = sample / (RIBBON_SAMPLES - 1);
          const offset =
            waveOffset(wave > 1.5 ? 1 - t : t, frame.pulse, edge.a, edge.b, span) * camera.scale;
          graphics.lineTo(sx + (ex - sx) * t - uy * offset, sy + (ey - sy) * t + ux * offset);
        }
        graphics.stroke(stroke);
      } else if (violation) {
        // A crossed boundary: a double hairline either side of where the line would run.
        const apart = width * 0.85;
        for (const side of [-1, 1]) {
          const ox = -uy * apart * side;
          const oy = ux * apart * side;
          graphics
            .moveTo(sx + ox, sy + oy)
            .lineTo(ex + ox, ey + oy)
            .stroke({ ...stroke, width: width * 0.8 });
        }
      } else {
        graphics.moveTo(sx, sy).lineTo(ex, ey).stroke(stroke);
      }
      // A directed edge (inherits, implements, overrides), and data and failure flow,
      // show their heads whether arrows are on or not; a data edge's is hollow.
      const headed =
        (direction & (EdgeDirection.directed | EdgeDirection.data | EdgeDirection.failure)) !== 0;
      if (scale.arrows || headed) {
        this.#drawArrows(frame, graphics, direction, [sx, sy, ex, ey], stroke, data && !failure);
      }
    }
    this.#edgesDrawn = drawn;
  }

  #drawArrows(
    frame: FlatFrame,
    graphics: Graphics,
    direction: number,
    [sx, sy, ex, ey]: readonly [number, number, number, number],
    stroke: { readonly color: number; readonly alpha: number; readonly width: number },
    hollow = false,
  ): void {
    const size = frame.scale.arrowSize * frame.camera.scale;
    const length = Math.hypot(ex - sx, ey - sy);
    const ux = (ex - sx) / length;
    const uy = (ey - sy) / length;
    const head = (tipX: number, tipY: number, backX: number, backY: number) => {
      const baseX = tipX + backX * size;
      const baseY = tipY + backY * size;
      const points = [
        tipX,
        tipY,
        baseX - backY * size * 0.45,
        baseY + backX * size * 0.45,
        baseX + backY * size * 0.45,
        baseY - backX * size * 0.45,
      ];
      if (hollow) graphics.poly(points).stroke({ ...stroke, width: 1 });
      else graphics.poly(points).fill(stroke.color, stroke.alpha);
    };
    if ((direction & 1) !== 0) head(ex, ey, -ux, -uy);
    if ((direction & 2) !== 0) head(sx, sy, ux, uy);
  }

  /** The worked notes' quiet hairlines, the gestures, the cursor's marker, and its label. */
  #drawMarks(frame: FlatFrame, stage: Stage, theme: GraphTheme): void {
    const graphics = stage.marks;
    graphics.clear();
    const { state, inView, camera } = frame;
    const accent = theme.accent.getHex();
    const at = new Vector3();
    for (let index = 0; index < state.count; index += 1) {
      const glow = state.styleOf(index, StyleChannel.glow);
      if (glow <= 0.02 || inView[index] !== 1) continue;
      const visibility = state.styleOf(index, StyleChannel.visibility);
      state.current(index, at);
      const [x, y] = this.#screen(frame, at.x, at.y);
      const reach = shapeReach(frame.view.nodeShape[index]);
      const r = state.drawnRadius(index) * visibility * camera.scale * 1.4 * reach;
      graphics.circle(x, y, r).stroke({ width: 1, color: accent, alpha: glow });
    }
    // Failure flow: a warning tick off the upper right of a function nothing above catches.
    const warning = theme.warning.getHex();
    if (this.#uncaught.view !== frame.view) {
      const flags = frame.view.nodeFlags;
      const slots: Array<number> = [];
      for (let slot = 0; slot < flags.length; slot += 1) {
        if (((flags[slot] ?? 0) & NodeFlag.uncaught) !== 0) slots.push(slot);
      }
      this.#uncaught = { view: frame.view, slots };
    }
    for (const index of this.#uncaught.slots) {
      if (inView[index] !== 1) continue;
      const visibility = state.styleOf(index, StyleChannel.visibility);
      if (visibility < 0.05) continue;
      state.current(index, at);
      const [x, y] = this.#screen(frame, at.x, at.y);
      const r =
        state.drawnRadius(index) *
        visibility *
        camera.scale *
        shapeReach(frame.view.nodeShape[index]);
      const d = Math.SQRT1_2;
      graphics
        .moveTo(x + r * 1.08 * d, y - r * 1.08 * d)
        .lineTo(x + r * 1.45 * d, y - r * 1.45 * d)
        .stroke({ width: Math.max(1, r * 0.26), color: warning, alpha: visibility });
    }
    const tint = { paper: theme.paper.getHex(), ink: theme.ink.getHex(), accent };
    for (const mark of frame.marks) this.#drawMark(frame, graphics, mark, tint);
    // The agent's cursor, over the labels: its chip, its caret, and its words.
    const agent = stage.agentMarks;
    agent.clear();
    this.#drawMark(frame, agent, frame.agent.chip, tint);
    for (const mark of frame.agent.caret) this.#drawMark(frame, agent, mark, tint);
    this.#drawAgentLabel(frame, stage, accent);
  }

  #drawMark(
    frame: FlatFrame,
    graphics: Graphics,
    mark: Mark,
    tint: Readonly<Record<MarkColor, number>>,
  ): void {
    const scale = frame.camera.scale;
    switch (mark.kind) {
      case "rect": {
        const [x0, y0] = this.#screen(frame, mark.x0, mark.y1);
        const [x1, y1] = this.#screen(frame, mark.x1, mark.y0);
        graphics
          .rect(x0, y0, x1 - x0, y1 - y0)
          .fill(tint[mark.color], mark.alpha)
          .stroke({ width: mark.width, color: tint[mark.border], alpha: mark.alpha });
        return;
      }
      case "cursor": {
        // A dart, its tip at the point: two wings and a notch in its back. Screen y runs down.
        const [x, y] = this.#screen(frame, mark.x, mark.y);
        const angle = -mark.angle;
        const point = (u: number, v: number) => [
          x + u * Math.cos(angle) - v * Math.sin(angle),
          y + u * Math.sin(angle) + v * Math.cos(angle),
        ];
        const size = mark.size;
        graphics
          .poly([
            ...point(0, 0),
            ...point(-size, 0.45 * size),
            ...point(-0.72 * size, 0),
            ...point(-size, -0.45 * size),
          ])
          .fill(tint[mark.color], mark.alpha);
        return;
      }
      case "disc": {
        const [x, y] = this.#screen(frame, mark.x, mark.y);
        graphics
          .circle(x, y, mark.r * scale)
          .fill(tint[mark.color], mark.soft ? mark.alpha * 0.5 : mark.alpha);
        return;
      }
      case "arc": {
        const [x, y] = this.#screen(frame, mark.x, mark.y);
        // Pixi's arcs run clockwise on screen from +x; the mark's run counterclockwise in the world.
        const start = -mark.start;
        graphics
          .arc(x, y, mark.r * scale, start - mark.sweep, start)
          .stroke({ width: mark.width, color: tint[mark.color], alpha: mark.alpha });
        return;
      }
    }
  }

  /** The cursor's words, in the story colour, where the frame puts them. */
  #drawAgentLabel(frame: FlatFrame, stage: Stage, tint: number): void {
    const font = this.#plainFont;
    if (font === null) return;
    const existing = stage.agent.children[0];
    const text =
      existing instanceof BitmapText
        ? existing
        : new BitmapText({ text: "", style: { fontFamily: font, fontSize: LABEL_PIXELS } });
    if (text !== existing) {
      text.anchor.set(0, 0.5);
      stage.agent.addChild(text);
    }
    const [x, y] = this.#screen(frame, frame.agent.x, frame.agent.y);
    if (text.text !== frame.agent.text) text.text = frame.agent.text;
    text.position.set(x, y);
    text.tint = tint;
    text.scale.set(frame.agent.pixels / LABEL_PIXELS);
  }

  #drawBeads(frame: FlatFrame, art: Art, theme: GraphTheme): void {
    const { beads, beadPositions, beadBright } = frame;
    const tint = theme.accent.getHex();
    this.#beads.forEach((sprite, i) => {
      const bright = beadBright[i] ?? 0;
      sprite.visible = i < beads.count && bright > 0.001;
      if (!sprite.visible) return;
      const [x, y] = this.#screen(frame, beadPositions[i * 3] ?? 0, beadPositions[i * 3 + 1] ?? 0);
      sprite.texture = art.bead;
      sprite.position.set(x, y);
      sprite.width = sprite.height = (beads.size[i] ?? 0) * frame.scale.beadPixels;
      sprite.alpha = bright;
      sprite.tint = tint;
    });
  }

  #drawLabels(frame: FlatFrame, theme: GraphTheme): void {
    const { labels } = frame;
    const plain = this.#plainTexts;
    const outlined = this.#outlinedTexts;
    const ink = theme.ink.getHex();
    plain?.begin();
    outlined?.begin();
    for (let at = 0; at < labels.count; at += 1) {
      const index = labels.drawn[at] ?? 0;
      const prominent = (labels.outline[index] ?? 0) > 0.01;
      const pool = prominent ? outlined : plain;
      if (pool === null) continue;
      const { item: text } = pool.take(index);
      // A slot can hold another note later: the label reads the slot's name now.
      const name = labels.names[index] ?? "";
      if (text.text !== name) text.text = name;
      const [x, y] = this.#screen(frame, labels.x[index] ?? 0, labels.y[index] ?? 0);
      text.visible = true;
      text.position.set(x, y);
      text.scale.set((labels.size[index] ?? LABEL_PIXELS) / LABEL_PIXELS);
      text.alpha = labels.opacity[index] ?? 0;
      if (!prominent) text.tint = ink;
    }
    plain?.end();
    outlined?.end();
  }

  dispose(): void {
    this.#disposed = true;
    this.#faces.dispose();
    this.#clearPools();
    this.#uninstallFonts();
    if (this.#art !== null) destroyArt(this.#art);
    this.#app?.destroy(true, { children: true });
    this.#app = null;
    this.#stage = null;
  }
}

/** The colours an outlined font is drawn in, as a key: ink on paper. */
function outlineColours(theme: GraphTheme | null): string {
  return theme === null ? "" : `${theme.ink.getHexString()}/${theme.paper.getHexString()}`;
}

/** The "pixi" renderer: the shared flat controller drawing with Pixi.js. */
export function createPixiRenderer(
  container: HTMLElement,
  callbacks: RendererCallbacks,
  options: RendererOptions = {},
): GraphRenderer {
  return new FlatRenderer(container, callbacks, "pixi", (host) => new PixiDrawer(host), options);
}

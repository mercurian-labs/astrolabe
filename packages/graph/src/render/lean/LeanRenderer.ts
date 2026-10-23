/**
 * "lean": the flat reading on a stripped-down Three.js renderer. One
 * orthographic camera set straight from the flat view, no controls, no depth
 * test, no depth fade or cut. Node positions stay GPU-resident in the node
 * state's float textures; nodes are one instanced draw, ribbons one, beads one
 * Points draw, and labels our own glyph-quad layers over troika's SDF atlas
 * (see labelMesh.ts): one draw for ordinary labels, two for the outlined
 * prominent ones on top. A frame's label work is a compare per drawn label.
 */
import { OrthographicCamera, Scene, WebGLRenderer } from "three";

import type { EdgeStyle } from "../edgeStyle.ts";
import { FlatRenderer } from "../flat/FlatRenderer.ts";
import type { DrawerHost, FlatDrawer, FlatFrame } from "../flat/drawer.ts";
import {
  createBeadMesh,
  createEdgeMesh,
  createNodeMesh,
  packEdges,
  type BeadMesh,
  type EdgeMesh,
  type NodeMesh,
} from "../meshes.ts";
import type { NodeState } from "../nodeState.ts";
import { LABEL_BUDGET } from "../pool.ts";
import { timeRender, webgl2, type GpuMemory, type GpuTimer } from "../probe.ts";
import {
  releaseRenderer,
  type GraphRenderer,
  type RendererCallbacks,
  type RendererOptions,
} from "../renderer.ts";
import {
  LABEL_GLYPH_FLOOR,
  LabelLayer,
  MAX_LABEL_GLYPHS,
  troikaTypeset,
  type Glyphs,
  type Typeset,
} from "./labelMesh.ts";
import { LEAN_EDGE_SHADERS, LEAN_NODE_SHADERS } from "./shaders.ts";
import {
  createRegionMesh,
  namedRegions,
  REGION_NAME_BUDGET,
  REGION_NAME_OPACITY,
  REGION_NAME_PIXELS,
  setRegionTheme,
  updateRegionMesh,
  type RegionMesh,
} from "../regions.ts";
import { AGENT_LABEL_MAX } from "../cursor.ts";
import { createMarkMesh, updateMarkMesh, type MarkMesh } from "../marks.ts";
import type { DrawnGraph } from "../workingSet.ts";

interface Scenery {
  readonly nodes: NodeMesh;
  readonly edges: EdgeMesh;
  readonly beads: BeadMesh;
  /** Ordinary labels, and the prominent ones drawn outlined on top. */
  readonly labels: LabelLayer;
  readonly prominent: LabelLayer;
  /** The open containers: faint discs behind everything, and their names. */
  readonly regions: RegionMesh;
  readonly regionNames: LabelLayer;
  /** The story's marks (the gestures), over the nodes and under the labels. */
  readonly marks: MarkMesh;
  /** The cursor's "Agent" label, while it rests on a move. */
  readonly agent: LabelLayer;
  /** The cursor's caret and its label's chip, over the labels and under the label's text. */
  readonly agentMarks: MarkMesh;
}

class LeanDrawer implements FlatDrawer {
  readonly #host: DrawerHost;
  readonly #renderer: WebGLRenderer;
  /**
   * The regions and their names render in a pass of their own first: within
   * one pass Three draws opaque nodes before any transparent disc, whatever
   * the order, so a disc would paint over the notes in it.
   */
  readonly #renderCall = () => {
    const renderer = this.#renderer;
    if (this.#scenery === null || this.#scenery.regions.mesh.geometry.instanceCount === 0) {
      renderer.render(this.#scene, this.#camera);
      return;
    }
    renderer.render(this.#regionScene, this.#camera);
    renderer.autoClear = false;
    renderer.render(this.#scene, this.#camera);
    renderer.autoClear = true;
  };
  readonly #scene = new Scene();
  readonly #regionScene = new Scene();
  readonly #camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  #scenery: Scenery | null = null;
  #font: string | undefined = undefined;
  readonly #typeset: Typeset;
  /** Each name's glyphs in the current font, once typeset; a name in `#asked` is on its way. */
  #glyphs = new Map<string, Glyphs>();
  #asked = new Set<string>();
  #drawCalls = 0;
  #edgesDrawn = 0;

  constructor(host: DrawerHost, typeset: Typeset = troikaTypeset) {
    this.#host = host;
    this.#typeset = typeset;
    this.#renderer = new WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(host.pixelRatio);
    const canvas = this.#renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.container.append(canvas);
    this.#camera.position.set(0, 0, 100);
  }

  get drawCalls(): number {
    return this.#drawCalls;
  }

  get edgesDrawn(): number {
    return this.#edgesDrawn;
  }

  get gl(): WebGL2RenderingContext | null {
    return webgl2(this.#renderer.getContext());
  }

  memory(): GpuMemory {
    const { textures, geometries } = this.#renderer.info.memory;
    return { textures, buffers: geometries };
  }

  setGraph(graph: DrawnGraph, state: NodeState, _edgeStyle: EdgeStyle): void {
    this.#disposeScenery();
    const nodes = createNodeMesh(state, LEAN_NODE_SHADERS);
    const edges = createEdgeMesh(state, graph, LEAN_EDGE_SHADERS);
    const beads = createBeadMesh();
    beads.uniforms.uFlat.value = 1;
    // As many label slots as labels can show, each as long as the longest name
    // seated now, and never under LABEL_GLYPH_FLOOR: a note that arrives later
    // with a longer name is cut there until the next resize.
    const slots = Math.min(LABEL_BUDGET, graph.nodes.length);
    // A label may carry its checkpoint's glyph before the name ("+ name"): two more.
    const longest =
      graph.nodes.reduce((most, node) => Math.max(most, [...node.name].length), 1) + 2;
    const glyphs = Math.min(MAX_LABEL_GLYPHS, Math.max(LABEL_GLYPH_FLOOR, longest));
    const labels = new LabelLayer(slots, glyphs, false);
    const prominent = new LabelLayer(slots, glyphs, true);
    const regions = createRegionMesh();
    const regionNames = new LabelLayer(REGION_NAME_BUDGET, LABEL_GLYPH_FLOOR, false);
    const marks = createMarkMesh();
    const agent = new LabelLayer(1, AGENT_LABEL_MAX, false);
    const agentMarks = createMarkMesh();
    // No depth: draw order alone layers regions and their names (in their own pass), edges,
    // nodes, beads, the story's marks, labels, prominent labels, and the cursor's label.
    [
      regions.mesh,
      ...regionNames.objects,
      edges.mesh,
      nodes.mesh,
      beads.points,
      marks.mesh,
      ...labels.objects,
      ...prominent.objects,
      agentMarks.mesh,
      ...agent.objects,
    ].forEach((object, order) => {
      object.renderOrder = order;
      object.frustumCulled = false;
      object.material.depthTest = false;
      object.material.depthWrite = false;
    });
    this.#regionScene.add(regions.mesh, ...regionNames.objects);
    this.#scene.add(
      edges.mesh,
      nodes.mesh,
      beads.points,
      marks.mesh,
      ...labels.objects,
      ...prominent.objects,
      agentMarks.mesh,
      ...agent.objects,
    );
    this.#scenery = {
      nodes,
      edges,
      beads,
      labels,
      prominent,
      regions,
      regionNames,
      marks,
      agent,
      agentMarks,
    };
  }

  setLabelFont(font: string | undefined): void {
    if (font === this.#font) return;
    this.#font = font;
    // Every name typesets again in the new font; typesets still out for the old one are dropped.
    this.#glyphs = new Map();
    this.#asked = new Set();
    this.#scenery?.labels.forgetGlyphs();
    this.#scenery?.prominent.forgetGlyphs();
    this.#host.invalidate();
  }

  resize(width: number, height: number): void {
    this.#renderer.setSize(width, height, false);
  }

  draw(frame: FlatFrame, gpu: GpuTimer | null): number | null {
    const scenery = this.#scenery;
    if (scenery === null) return null;
    const { nodes, edges, beads } = scenery;
    const { view, dirty, theme, scale, camera } = frame;
    if (dirty.theme) {
      this.#renderer.setClearColor(theme.paper, 1);
      for (const uniforms of [nodes.uniforms, edges.uniforms]) {
        uniforms.uPaper.value.copy(theme.paper);
        uniforms.uInk.value.copy(theme.ink);
        uniforms.uAccent.value.copy(theme.accent);
        uniforms.uWarning.value.copy(theme.warning);
        uniforms.uLens.value.forEach((color, slot) => {
          const tint = theme.lenses[slot];
          if (tint !== undefined) color.copy(tint);
        });
      }
      beads.uniforms.uAccent.value.copy(theme.accent);
      scenery.labels.setColors(theme.ink, theme.paper);
      scenery.prominent.setColors(theme.ink, theme.paper);
      scenery.regionNames.setColors(theme.ink, theme.paper);
      scenery.agent.setColors(theme.accent, theme.paper);
      setRegionTheme(scenery.regions, theme);
    }
    if (dirty.view) {
      nodes.flags.array.set(view.nodeFlags);
      nodes.slots.array.set(view.nodeSlot);
      nodes.shapes.array.set(view.nodeShape);
      nodes.shapes.needsUpdate = true;
      edges.source.slots.set(view.edgeSlot);
      edges.source.directions.set(view.edgeDirection);
      nodes.flags.needsUpdate = true;
      nodes.slots.needsUpdate = true;
    }
    if (dirty.slots) {
      // Edge slots took new edges: their ends are node slots of the frame's graph.
      frame.universe.edges.forEach((edge, slot) => {
        edges.source.ends[slot * 2] = edge.a;
        edges.source.ends[slot * 2 + 1] = edge.b;
      });
    }
    if (dirty.kinds) edges.source.kinds.set(frame.edgeKinds);
    if (dirty.prominence) nodes.prominence.needsUpdate = true;
    if (dirty.wave) edges.source.waves.set(frame.waves);
    // Only the edges that show are drawn: none at all when nothing is lit.
    this.#edgesDrawn = packEdges(edges, frame.edgeStyle.lit, frame.edgeStyle.values);
    if (dirty.scale) {
      edges.uniforms.uLineWidth.value = scale.lineWidth;
      edges.uniforms.uArrows.value = scale.arrows ? 1 : 0;
      edges.uniforms.uArrowSize.value = scale.arrowSize;
      edges.uniforms.uDash.value = scale.dash;
      beads.uniforms.uSizeScale.value = scale.beadPixels;
    }
    edges.uniforms.uPulse.value = frame.pulse;
    this.#drawBeads(frame, beads);
    this.#drawRegions(frame, scenery);
    this.#drawMarks(frame, scenery);
    this.#drawLabels(frame, scenery);
    // The camera is the flat view: its frustum spans the canvas at the view's scale.
    const halfWidth = frame.width / 2 / camera.scale;
    const halfHeight = frame.height / 2 / camera.scale;
    this.#camera.left = camera.x - halfWidth;
    this.#camera.right = camera.x + halfWidth;
    this.#camera.top = camera.y + halfHeight;
    this.#camera.bottom = camera.y - halfHeight;
    this.#camera.updateProjectionMatrix();
    const renderMs = timeRender(this.#renderCall, gpu);
    this.#drawCalls = this.#renderer.info.render.calls;
    return renderMs;
  }

  #drawBeads(frame: FlatFrame, beads: BeadMesh): void {
    const count = frame.beads.count;
    if (frame.dirty.beadsDealt) {
      beads.sizes.array.set(frame.beads.size);
      beads.sizes.needsUpdate = true;
    }
    if (count > 0 || frame.dirty.beadsDealt) {
      beads.positions.array.set(frame.beadPositions);
      beads.bright.array.set(frame.beadBright);
      beads.positions.needsUpdate = true;
      beads.bright.needsUpdate = true;
    }
    beads.points.geometry.setDrawRange(0, count);
    beads.uniforms.uPixelRatio.value = this.#renderer.getPixelRatio();
  }

  /** The open containers: their discs, and the names of those large enough on screen. */
  #drawRegions(frame: FlatFrame, scenery: Scenery): void {
    const { view, regionCircles: circles, camera } = frame;
    updateRegionMesh(scenery.regions, view.regions, circles);
    const names = scenery.regionNames;
    names.begin();
    for (const position of namedRegions(view.regions, circles, camera.scale)) {
      const region = view.regions[position];
      if (region === undefined) continue;
      const r = circles[position * 4 + 3] ?? 0;
      // Just inside the disc's upper left: on the edge, out of the notes' way.
      names.place(
        region.note,
        region.name,
        (circles[position * 4] ?? 0) - r * 0.62,
        (circles[position * 4 + 1] ?? 0) + r * 0.74,
        REGION_NAME_PIXELS,
        REGION_NAME_OPACITY,
        0,
      );
    }
    names.end();
  }

  #drawLabels(frame: FlatFrame, scenery: Scenery): void {
    const { labels, camera } = frame;
    const { labels: ordinary, prominent } = scenery;
    ordinary.begin();
    prominent.begin();
    for (let at = 0; at < labels.count; at += 1) {
      const index = labels.drawn[at] ?? 0;
      const opacity = labels.opacity[index] ?? 0;
      const outline = labels.outline[index] ?? 0;
      const outlined = outline > 0.01;
      (outlined ? prominent : ordinary).place(
        index,
        labels.names[index] ?? "",
        labels.x[index] ?? 0,
        labels.y[index] ?? 0,
        labels.size[index] ?? 0,
        opacity,
        outlined ? opacity * outline : 0,
      );
    }
    ordinary.end();
    prominent.end();
    // CSS pixels to world units: the one thing a zoom changes for the labels.
    const worldPerPixel = 1 / camera.scale;
    for (const layer of [ordinary, prominent, scenery.regionNames, scenery.agent]) {
      layer.setWorldPerPixel(worldPerPixel);
      this.#fillGlyphs(layer);
      layer.syncAtlas();
    }
  }

  /** The story's marks under the labels, and the agent's cursor (caret, chip, and words) over them. */
  #drawMarks(frame: FlatFrame, scenery: Scenery): void {
    const { theme, camera, marks, agent } = frame;
    const colors = { paper: theme.paper, ink: theme.ink, accent: theme.accent };
    updateMarkMesh(scenery.marks, marks, colors, 1 / camera.scale);
    updateMarkMesh(scenery.agentMarks, [agent.chip, ...agent.caret], colors, 1 / camera.scale);
    const words = scenery.agent;
    words.begin();
    // A popover standing in for the chip leaves it no words.
    if (agent.text !== "") words.place(0, agent.text, agent.x, agent.y, agent.pixels, 1, 0);
    words.end();
  }

  /** Write the glyphs each waiting slot needs, typesetting the names not typeset yet. */
  #fillGlyphs(layer: LabelLayer): void {
    if (!layer.waiting) return;
    for (const { slot, name } of layer.pending()) {
      const glyphs = this.#glyphs.get(name);
      if (glyphs !== undefined) {
        // Written now, shown from the next frame on (this one has already placed it).
        if (layer.setGlyphs(slot, name, glyphs)) this.#host.invalidate();
        continue;
      }
      if (this.#asked.has(name)) continue;
      this.#asked.add(name);
      const into = this.#glyphs;
      this.#typeset(name, this.#font, (typeset) => {
        if (into !== this.#glyphs) return;
        into.set(name, typeset);
        this.#host.invalidate();
      });
    }
  }

  dispose(): void {
    this.#disposeScenery();
    releaseRenderer(this.#renderer);
  }

  #disposeScenery(): void {
    const scenery = this.#scenery;
    if (scenery === null) return;
    const {
      nodes,
      edges,
      beads,
      labels,
      prominent,
      regions,
      regionNames,
      marks,
      agent,
      agentMarks,
    } = scenery;
    this.#regionScene.remove(regions.mesh, ...regionNames.objects);
    this.#scene.remove(
      edges.mesh,
      nodes.mesh,
      beads.points,
      marks.mesh,
      ...labels.objects,
      ...prominent.objects,
      agentMarks.mesh,
      ...agent.objects,
    );
    agent.dispose();
    for (const mesh of [nodes.mesh, edges.mesh, regions.mesh, marks.mesh, agentMarks.mesh]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    beads.points.geometry.dispose();
    beads.points.material.dispose();
    labels.dispose();
    prominent.dispose();
    regionNames.dispose();
    this.#scenery = null;
  }
}

/** The "lean" renderer: the shared flat controller drawing with Three.js, stripped to 2D. */
export function createLeanRenderer(
  container: HTMLElement,
  callbacks: RendererCallbacks,
  options: RendererOptions = {},
): GraphRenderer {
  return new FlatRenderer(container, callbacks, "lean", (host) => new LeanDrawer(host), options);
}

/**
 * Lean's labels: glyph quads in one instanced mesh per layer, drawn straight
 * from troika's SDF glyph atlas. Troika typesets each name once (off the main
 * thread, cached by name); a label slot then owns a fixed run of glyph
 * instances, written when the slot takes a name and never again while it
 * holds it. Where each label sits, how big it is, and how opaque it is live in
 * a small per-slot texture, and CSS pixels reach world units through one
 * uniform, so a frame costs a pass over the drawn labels comparing a few
 * floats: a zoom rewrites only anchors that moved, a story only opacities
 * that changed, and an unchanged frame uploads nothing.
 *
 * The ordinary layer draws fills; the prominent layer draws an outline pass
 * in paper and then its fills, on top of the ordinary ones.
 */
import {
  BufferAttribute,
  Color,
  DataTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  type Texture,
} from "three";
import { getTextRenderInfo, type TextRenderInfo } from "troika-three-text";

import { StickyPool } from "../pool.ts";

/** The glyphs a label draws, as troika typeset them at font size 1, anchored left and middle. */
export interface Glyphs {
  /** minX, minY, maxX, maxY per glyph, in font-size units from the label's anchor. */
  readonly bounds: ArrayLike<number>;
  /** Each glyph's place in the SDF atlas. */
  readonly atlas: ArrayLike<number>;
  readonly sdf: SdfAtlas;
}

/** Troika's shared SDF atlas and how its glyphs are encoded. */
export interface SdfAtlas {
  readonly texture: Texture;
  readonly glyphSize: number;
  readonly exponent: number;
}

/** Typeset `name` in `font` and call back with its glyphs (possibly later). */
export type Typeset = (
  name: string,
  font: string | undefined,
  done: (glyphs: Glyphs) => void,
) => void;

/** Troika's typesetter: a worker lays out the name and fills the shared SDF atlas. */
export const troikaTypeset: Typeset = (name, font, done) => {
  getTextRenderInfo(
    { text: name, font, fontSize: 1, anchorX: "left", anchorY: "middle" },
    (info: TextRenderInfo) =>
      done({
        bounds: info.glyphBounds,
        atlas: info.glyphAtlasIndices,
        sdf: { texture: info.sdfTexture, glyphSize: info.sdfGlyphSize, exponent: info.sdfExponent },
      }),
  );
};

/** Longer names are cut to this many glyphs: nobody reads a longer label. */
export const MAX_LABEL_GLYPHS = 96;
/** A label layer's glyph run is at least this long, so most notes seated later fit it too. */
export const LABEL_GLYPH_FLOOR = 48;

/** The outline's width, as troika's "12%": an eighth of the font size, in font-size units. */
export const OUTLINE_EDGE = 0.12;

const vertexShader = /* glsl */ `
uniform sampler2D uSlots;
uniform float uSlotCount;
uniform float uWorldPerPixel;
uniform vec2 uSdfSize;
uniform float uGlyphSize;
uniform float uEdge;
attribute vec4 aBounds;
attribute float aAtlas;
attribute float aSlot;
varying vec2 vGlyphUv;
varying vec4 vUvBounds;
varying float vChannel;
varying vec2 vDims;
varying float vOpacity;

void main() {
  float u = (aSlot + 0.5) / uSlotCount;
  vec4 place = texture2D(uSlots, vec2(u, 0.25));
  vec4 ink = texture2D(uSlots, vec2(u, 0.75));
  vOpacity = uEdge > 0.0 ? ink.y : ink.x;
  if (vOpacity < 0.002 || aBounds.z <= aBounds.x) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 outer = vec4(aBounds.xy - uEdge, aBounds.zw + uEdge);
  vec2 local = mix(outer.xy, outer.zw, position.xy);
  vDims = aBounds.zw - aBounds.xy;
  vGlyphUv = (local - aBounds.xy) / vDims;
  vec2 world = place.xy + local * place.z * uWorldPerPixel;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 0.0, 1.0);
  // Where the glyph's square sits in the atlas: four glyphs per texel, one per channel.
  float columns = uSdfSize.x / uGlyphSize;
  vec2 perSquare = uGlyphSize / uSdfSize;
  float square = floor(aAtlas / 4.0);
  vec2 start = perSquare * vec2(mod(square, columns), floor(square / columns));
  vUvBounds = vec4(start, start + perSquare);
  vChannel = mod(aAtlas, 4.0);
}
`;

// Troika's SDF decoding (TextDerivedMaterial.js), without its clip, curve, and stroke paths.
const fragmentShader = /* glsl */ `
uniform sampler2D uSdf;
uniform float uGlyphSize;
uniform float uExponent;
uniform float uEdge;
uniform vec3 uColor;
varying vec2 vGlyphUv;
varying vec4 vUvBounds;
varying float vChannel;
varying vec2 vDims;
varying float vOpacity;

float sdfValue(vec2 glyphUv) {
  vec4 rgba = texture2D(uSdf, mix(vUvBounds.xy, vUvBounds.zw, glyphUv));
  float channel = floor(vChannel + 0.5);
  return channel == 0.0 ? rgba.r : channel == 1.0 ? rgba.g : channel == 2.0 ? rgba.b : rgba.a;
}

float signedDistance(float alpha) {
  float span = max(vDims.x, vDims.y);
  float away = (1.0 - pow(2.0 * (alpha > 0.5 ? 1.0 - alpha : alpha), 1.0 / uExponent)) * span;
  return alpha > 0.5 ? -away : away;
}

void main() {
  vec2 clamped = clamp(vGlyphUv, 0.5 / uGlyphSize, 1.0 - 0.5 / uGlyphSize);
  float distance = signedDistance(sdfValue(clamped));
  distance += clamped == vGlyphUv ? 0.0 : length((vGlyphUv - clamped) * vDims);
  float aa = length(fwidth(vGlyphUv * vDims)) * 0.5;
  float alpha = smoothstep(uEdge + aa, uEdge - aa, distance) * vOpacity;
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
}
`;

/** Per-slot floats in the slot texture: x, y, size (row 0); fill and outline opacity (row 1). */
const TEXELS_PER_ROW = 4;

/**
 * One layer of labels: `slots` labels at most, each up to `glyphs` glyphs.
 * With `outlined`, a paper outline pass draws under the fills.
 */
export class LabelLayer {
  /** What the scene draws, in order. */
  readonly objects: ReadonlyArray<Mesh<InstancedBufferGeometry, ShaderMaterial>>;
  readonly #geometry = new InstancedBufferGeometry();
  readonly #bounds: InstancedBufferAttribute;
  readonly #atlas: InstancedBufferAttribute;
  readonly #slotData: Float32Array;
  readonly #slotTexture: DataTexture;
  readonly #materials: ReadonlyArray<ShaderMaterial>;
  readonly #slots: number;
  readonly #glyphs: number;
  readonly #pool: StickyPool<number>;
  /** The name whose glyphs each slot holds now, or null while none are written. */
  readonly #written: Array<string | null>;
  /** The name each slot should show. */
  readonly #wanted: Array<string | null>;
  /** Slots whose wanted name has no glyphs written yet. */
  readonly #waiting = new Set<number>();
  #used = 0;
  #sdf: SdfAtlas | null = null;

  constructor(slots: number, glyphs: number, outlined: boolean) {
    this.#slots = Math.max(1, slots);
    this.#glyphs = Math.max(1, Math.min(MAX_LABEL_GLYPHS, glyphs));
    const instances = this.#slots * this.#glyphs;
    const geometry = this.#geometry;
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), 3),
    );
    this.#bounds = new InstancedBufferAttribute(new Float32Array(instances * 4), 4);
    this.#atlas = new InstancedBufferAttribute(new Float32Array(instances), 1);
    const slotOf = new Float32Array(instances);
    for (let at = 0; at < instances; at += 1) slotOf[at] = Math.floor(at / this.#glyphs);
    geometry.setAttribute("aBounds", this.#bounds);
    geometry.setAttribute("aAtlas", this.#atlas);
    geometry.setAttribute("aSlot", new InstancedBufferAttribute(slotOf, 1));
    geometry.instanceCount = 0;
    this.#slotData = new Float32Array(this.#slots * 2 * TEXELS_PER_ROW);
    this.#slotTexture = new DataTexture(this.#slotData, this.#slots, 2, RGBAFormat, FloatType);
    this.#slotTexture.minFilter = NearestFilter;
    this.#slotTexture.magFilter = NearestFilter;
    this.#slotTexture.generateMipmaps = false;
    this.#slotTexture.needsUpdate = true;
    const material = (edge: number) =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uSlots: { value: this.#slotTexture },
          uSlotCount: { value: this.#slots },
          uWorldPerPixel: { value: 1 },
          uSdf: { value: null },
          uSdfSize: { value: new Vector2(1, 1) },
          uGlyphSize: { value: 64 },
          uExponent: { value: 9 },
          uEdge: { value: edge },
          uColor: { value: new Color() },
        },
      });
    this.#materials = outlined ? [material(OUTLINE_EDGE), material(0)] : [material(0)];
    this.objects = this.#materials.map((each) => {
      const mesh = new Mesh(geometry, each);
      mesh.frustumCulled = false;
      return mesh;
    });
    this.#written = Array.from({ length: this.#slots }, () => null);
    this.#wanted = Array.from({ length: this.#slots }, () => null);
    let next = 0;
    this.#pool = new StickyPool(
      () => next++,
      (slot) => {
        this.#write(slot, 1, 0, 0);
        this.#write(slot, 1, 1, 0);
        this.#wanted[slot] = null;
        this.#waiting.delete(slot);
      },
    );
  }

  /** Slots in use at most so far (what the draw covers). */
  get used(): number {
    return this.#used;
  }

  /** The slot texture, for tests: its version counts uploads. */
  get slotTexture(): DataTexture {
    return this.#slotTexture;
  }

  /** Ink for the fills; paper for the outline pass. */
  setColors(ink: Color, paper: Color): void {
    const [first, second] = this.#materials;
    if (second === undefined) first?.uniforms["uColor"]?.value.copy(ink);
    else {
      first?.uniforms["uColor"]?.value.copy(paper);
      second.uniforms["uColor"]?.value.copy(ink);
    }
  }

  /** World units per CSS pixel: the camera's zoom, the only thing a zoom changes here. */
  setWorldPerPixel(value: number): void {
    for (const material of this.#materials) {
      const uniform = material.uniforms["uWorldPerPixel"];
      if (uniform !== undefined) uniform.value = value;
    }
  }

  /** Every name must be typeset again (a new font). */
  forgetGlyphs(): void {
    this.#written.fill(null);
    this.#wanted.forEach((name, slot) => {
      if (name !== null) this.#waiting.add(slot);
    });
  }

  begin(): void {
    this.#pool.begin();
  }

  /**
   * Draw note `node`'s label this frame at world (x, y), `size` CSS pixels,
   * with fill and outline opacities. Returns the slot it holds.
   */
  place(
    node: number,
    name: string,
    x: number,
    y: number,
    size: number,
    fill: number,
    outline: number,
  ): number {
    const { item: slot } = this.#pool.take(node);
    if (slot >= this.#used) {
      this.#used = slot + 1;
      this.#geometry.instanceCount = this.#used * this.#glyphs;
    }
    this.#wanted[slot] = name;
    const shown = this.#written[slot] === name;
    if (!shown) this.#waiting.add(slot);
    this.#write(slot, 0, 0, x);
    this.#write(slot, 0, 1, y);
    this.#write(slot, 0, 2, size);
    // Until its glyphs are written, a slot draws nothing.
    this.#write(slot, 1, 0, shown ? fill : 0);
    this.#write(slot, 1, 1, shown ? outline : 0);
    return slot;
  }

  end(): void {
    this.#pool.end();
  }

  /** Slots whose name is wanted but not written yet: the caller typesets them. */
  pending(): Array<{ readonly slot: number; readonly name: string }> {
    const pending: Array<{ readonly slot: number; readonly name: string }> = [];
    for (const slot of this.#waiting) {
      const name = this.#wanted[slot] ?? null;
      if (name !== null && this.#written[slot] !== name) pending.push({ slot, name });
    }
    return pending;
  }

  /** Whether any slot waits for its glyphs: most frames none does. */
  get waiting(): boolean {
    return this.#waiting.size > 0;
  }

  /** Write `glyphs` into `slot` for `name`, if the slot still wants that name. Returns whether it did. */
  setGlyphs(slot: number, name: string, glyphs: Glyphs): boolean {
    if (this.#wanted[slot] !== name || this.#written[slot] === name) return false;
    const count = Math.min(this.#glyphs, glyphs.atlas.length);
    const first = slot * this.#glyphs;
    const bounds = this.#bounds.array;
    const atlas = this.#atlas.array;
    // A run shorter than the slot leaves zero-width glyphs behind it, which draw nothing.
    bounds.fill(0, first * 4, (first + this.#glyphs) * 4);
    atlas.fill(0, first, first + this.#glyphs);
    for (let glyph = 0; glyph < count; glyph += 1) {
      for (let axis = 0; axis < 4; axis += 1) {
        bounds[(first + glyph) * 4 + axis] = glyphs.bounds[glyph * 4 + axis] ?? 0;
      }
      atlas[first + glyph] = glyphs.atlas[glyph] ?? 0;
    }
    this.#bounds.addUpdateRange(first * 4, this.#glyphs * 4);
    this.#bounds.needsUpdate = true;
    this.#atlas.addUpdateRange(first, this.#glyphs);
    this.#atlas.needsUpdate = true;
    this.#written[slot] = name;
    this.#waiting.delete(slot);
    this.#useAtlas(glyphs.sdf);
    return true;
  }

  /** Read the atlas's size each frame: troika grows it in place as glyphs arrive. */
  syncAtlas(): void {
    const sdf = this.#sdf;
    if (sdf === null) return;
    const image: unknown = sdf.texture.image;
    const width = readNumber(image, "width");
    const height = readNumber(image, "height");
    for (const material of this.#materials) {
      material.uniforms["uSdfSize"]?.value.set(width, height);
    }
  }

  #useAtlas(sdf: SdfAtlas): void {
    if (this.#sdf?.texture === sdf.texture) return;
    this.#sdf = sdf;
    for (const material of this.#materials) {
      const { uniforms } = material;
      if (uniforms["uSdf"] !== undefined) uniforms["uSdf"].value = sdf.texture;
      if (uniforms["uGlyphSize"] !== undefined) uniforms["uGlyphSize"].value = sdf.glyphSize;
      if (uniforms["uExponent"] !== undefined) uniforms["uExponent"].value = sdf.exponent;
    }
    this.syncAtlas();
  }

  /** Set one slot float; the texture uploads only when something changed. */
  #write(slot: number, row: number, channel: number, value: number): void {
    const at = (row * this.#slots + slot) * TEXELS_PER_ROW + channel;
    if (this.#slotData[at] === Math.fround(value)) return;
    this.#slotData[at] = value;
    this.#slotTexture.needsUpdate = true;
  }

  dispose(): void {
    this.#geometry.dispose();
    this.#slotTexture.dispose();
    for (const material of this.#materials) material.dispose();
  }
}

function readNumber(image: unknown, key: "width" | "height"): number {
  if (typeof image !== "object" || image === null || !(key in image)) return 1;
  const value: unknown = Reflect.get(image, key);
  return typeof value === "number" && value > 0 ? value : 1;
}

/** The slice of troika-three-text the labels use; the package ships no usable types. */
declare module "troika-three-text" {
  import type { BufferGeometry, Color, Material, Mesh, Object3DEventMap, Texture } from "three";

  /**
   * The material a Text draws with: derived per Text from its own clone of
   * troika's default base material, which it keeps as `baseMaterial`.
   */
  export interface TextDerivedMaterial extends Material {
    readonly baseMaterial?: Material;
  }

  /** A Text announces when its typesetting starts and lands; a BatchedText, when it has repacked. */
  export interface TextEventMap extends Object3DEventMap {
    syncstart: object;
    synccomplete: object;
  }

  export class Text extends Mesh<
    BufferGeometry,
    TextDerivedMaterial | Array<TextDerivedMaterial>,
    TextEventMap
  > {
    text: string;
    font: string | null;
    fontSize: number;
    anchorX: number | "left" | "center" | "right";
    anchorY: number | "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom";
    color: Color | string | number;
    fillOpacity: number;
    /** A number in font units, or a percentage of the font size such as "12%"; 0 for none. */
    outlineWidth: number | string;
    outlineColor: Color | string | number;
    outlineOpacity: number;
    depthOffset: number;
    sdfGlyphSize: number | null;
    sync(callback?: () => void): void;
    /** Releases only the geometry; the materials are the caller's to dispose. */
    dispose(): void;
  }

  /**
   * Draws any number of member `Text`s in one draw call (two with an outline
   * pass), each with its own matrix, colour, opacity, and outline. Its own
   * material replaces the members'.
   */
  export class BatchedText extends Text {
    addText(text: Text): void;
    removeText(text: Text): void;
  }

  /** What troika's typesetter returns for a text: its glyphs and the shared SDF atlas they sit in. */
  export interface TextRenderInfo {
    readonly sdfTexture: Texture;
    readonly sdfGlyphSize: number;
    readonly sdfExponent: number;
    /** minX, minY, maxX, maxY per glyph, in font-size units from the anchor. */
    readonly glyphBounds: Float32Array;
    readonly glyphAtlasIndices: ArrayLike<number>;
  }

  export interface TypesetParams {
    text: string;
    font?: string | undefined;
    fontSize?: number;
    anchorX?: number | "left" | "center" | "right";
    anchorY?: number | "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom";
  }

  /** Typeset `args` off the main thread, filling the shared SDF atlas, then call back. */
  export function getTextRenderInfo(
    args: TypesetParams,
    callback: (info: TextRenderInfo) => void,
  ): void;
}

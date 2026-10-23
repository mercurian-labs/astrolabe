/**
 * The Pixi renderer's label font faces. Pixi rasterises glyphs from a CSS
 * font, so the label font file is loaded as a FontFace and added to the
 * document. The faces are the renderer's: they leave the document when it is
 * disposed, and a load that lands after disposal leaves at once.
 */

/** The slice of `document.fonts` the faces touch. */
export interface FontSet<Face> {
  add(face: Face): unknown;
  delete(face: Face): unknown;
}

/** The slice of a FontFace the faces use. */
export interface Loadable {
  load(): Promise<unknown>;
}

export class LabelFaces<Face extends Loadable> {
  readonly #fonts: FontSet<Face>;
  readonly #create: (family: string, url: string) => Face;
  readonly #faces = new Set<Face>();
  #disposed = false;

  constructor(fonts: FontSet<Face>, create: (family: string, url: string) => Face) {
    this.#fonts = fonts;
    this.#create = create;
  }

  /**
   * Load `url` as `family`, replacing any face loaded before. Resolves true
   * once the face is in the document, false if it failed or the owner was
   * disposed meanwhile.
   */
  async load(family: string, url: string): Promise<boolean> {
    const face = this.#create(family, url);
    try {
      await face.load();
    } catch {
      return false;
    }
    if (this.#disposed) return false;
    this.#clear();
    this.#fonts.add(face);
    this.#faces.add(face);
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    this.#clear();
  }

  #clear(): void {
    for (const face of this.#faces) this.#fonts.delete(face);
    this.#faces.clear();
  }
}

/** The label faces as the browser has them: FontFace objects in `document.fonts`. */
export const documentFaces = () =>
  new LabelFaces<FontFace>(document.fonts, (family, url) => new FontFace(family, `url(${url})`));

/**
 * Small receded tags naming clusters ("hub", "cycle: 3") near their centroid on screen. DOM, not
 * canvas: a few at most, hoverable, the same in every renderer, and placed only on drawn frames so
 * they cost nothing at rest.
 */

/** A tag: its words and the notes it names (universe indices). */
export interface GraphTag {
  readonly text: string;
  readonly members: ReadonlyArray<number>;
  /** A member to sit under instead of the centroid (a hub, the centre of its star). */
  readonly anchor?: number;
}

/** How far below the centroid a tag sits, in CSS pixels: off the notes themselves. */
const TAG_DROP = 14;

export class TagLayer {
  readonly #host: HTMLElement;
  readonly #onHover: (index: number | null) => void;
  #tags: ReadonlyArray<GraphTag> = [];
  #elements: Array<HTMLDivElement> = [];

  constructor(host: HTMLElement, onHover: (index: number | null) => void) {
    this.#host = host;
    this.#onHover = onHover;
  }

  get count(): number {
    return this.#tags.length;
  }

  /** Show `tags` in place of the last ones. */
  set(tags: ReadonlyArray<GraphTag>): void {
    const same =
      tags.length === this.#tags.length &&
      tags.every(
        (tag, at) =>
          tag.text === this.#tags[at]?.text &&
          tag.members.join() === this.#tags[at]?.members.join(),
      );
    if (same) return;
    this.#tags = tags;
    for (const element of this.#elements) element.remove();
    this.#elements = tags.map((tag, index) => {
      const element = document.createElement("div");
      element.className = "atlas-tag";
      element.textContent = tag.text;
      element.style.visibility = "hidden";
      element.addEventListener("pointerenter", () => this.#onHover(index));
      element.addEventListener("pointerleave", () => this.#onHover(null));
      this.#host.append(element);
      return element;
    });
  }

  /** Put each tag below its members' centroid on screen; a tag none of whose members shows hides. */
  place(screenOf: (note: number) => readonly [number, number] | null): void {
    this.#tags.forEach((tag, index) => {
      const element = this.#elements[index];
      if (element === undefined) return;
      let x = 0;
      let y = 0;
      let count = 0;
      const anchored = tag.anchor === undefined ? null : screenOf(tag.anchor);
      for (const member of anchored === null ? tag.members : []) {
        const at = screenOf(member);
        if (at === null) continue;
        x += at[0];
        y += at[1];
        count += 1;
      }
      if (anchored !== null) {
        x = anchored[0];
        y = anchored[1];
        count = 1;
      }
      if (count === 0) {
        element.style.visibility = "hidden";
        return;
      }
      element.style.visibility = "visible";
      element.style.transform = `translate(${(x / count).toFixed(1)}px, ${(y / count + TAG_DROP).toFixed(1)}px) translate(-50%, -50%)`;
    });
  }

  dispose(): void {
    for (const element of this.#elements) element.remove();
    this.#elements = [];
    this.#tags = [];
  }
}

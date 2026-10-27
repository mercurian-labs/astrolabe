/**
 * The story's marks (gestures, caret, chip) over a camera that is not flat-on, drawn in a
 * screen-space overlay after the scene. The overlay's plane is CSS pixels with y up (screen (x, y)
 * sits at (x, height - y)), so a caret is a screen-facing billboard beside its note.
 */
import { OrthographicCamera, Scene, type Color, type WebGLRenderer } from "three";
import { Text } from "troika-three-text";

import type { AgentDraw } from "./flat/drawer.ts";
import type { Mark, MarkColor } from "./gestures.ts";
import { createMarkMesh, updateMarkMesh } from "./marks.ts";

export class StoryOverlay {
  readonly #scene = new Scene();
  readonly #camera = new OrthographicCamera(0, 1, 1, 0, -10, 10);
  readonly #marks = createMarkMesh();
  readonly #agentMarks = createMarkMesh();
  readonly #words = new Text();
  readonly #invalidate: () => void;
  #height = 1;

  constructor(invalidate: () => void) {
    this.#invalidate = invalidate;
    this.#marks.mesh.renderOrder = 1;
    this.#agentMarks.mesh.renderOrder = 2;
    const words = this.#words;
    words.renderOrder = 3;
    words.anchorX = "left";
    words.anchorY = "middle";
    words.outlineWidth = 0;
    words.frustumCulled = false;
    this.#scene.add(this.#marks.mesh, this.#agentMarks.mesh, words);
  }

  /** A screen point (CSS pixels, y down) on the overlay's plane. */
  toPlane(x: number, y: number): { readonly x: number; readonly y: number } {
    return { x, y: this.#height - y };
  }

  resize(width: number, height: number): void {
    this.#height = height;
    this.#camera.right = width;
    this.#camera.top = height;
    this.#camera.updateProjectionMatrix();
  }

  setFont(font: string | undefined): void {
    this.#words.font = font ?? null;
    this.#words.sync(this.#invalidate);
  }

  /** This frame's marks, and the agent's caret, chip, and words over them. */
  draw(
    marks: ReadonlyArray<Mark>,
    agent: AgentDraw,
    colors: Readonly<Record<MarkColor, Color>>,
  ): void {
    updateMarkMesh(this.#marks, marks, colors, 1);
    updateMarkMesh(this.#agentMarks, [agent.chip, ...agent.caret], colors, 1);
    const words = this.#words;
    words.color = colors.accent.getHex();
    words.fontSize = agent.pixels;
    words.position.set(agent.x, agent.y, 0);
    if (words.text !== agent.text) {
      words.text = agent.text;
      // The words show once they have typeset; then the frame is drawn again.
      words.sync(this.#invalidate);
    }
  }

  /** Draw the overlay over what the renderer has drawn this frame. */
  render(renderer: WebGLRenderer): void {
    const clears = renderer.autoClear;
    renderer.autoClear = false;
    // Over everything: the scene's depth never hides a caret or its words.
    renderer.clearDepth();
    renderer.render(this.#scene, this.#camera);
    renderer.autoClear = clears;
  }

  dispose(): void {
    for (const mesh of [this.#marks.mesh, this.#agentMarks.mesh]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.#words.dispose();
  }
}

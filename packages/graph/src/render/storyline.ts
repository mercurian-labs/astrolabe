/**
 * The story as a renderer runs it: the landing turn's `Story`, the selected
 * play, and the beads on the lit links. It wakes its renderer with one timer when the story should fall, so
 * holding a lit story costs no frames. Shared by every renderer.
 */
import type { PlayFocus } from "../model/plays.ts";
import type { GraphView } from "../model/view.ts";
import { assignBeads, beadLanes, BeadSet } from "./beads.ts";
import { Story } from "./story.ts";

const seconds = () => performance.now() / 1000;

/** Whether two plays draw the same: same kind, links, ways, and notes. */
export function samePlay(a: PlayFocus | null, b: PlayFocus | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const links = (play: PlayFocus) =>
    play.links.map((link) => `${link.edge}:${link.kind}:${link.ways}`).join();
  return (
    a.kind === b.kind &&
    a.nodes.join() === b.nodes.join() &&
    links(a) === links(b) &&
    (a.quiet ?? []).join() === (b.quiet ?? []).join()
  );
}

export class Storyline {
  readonly beads = new BeadSet();
  readonly #story = new Story();
  readonly #onFall: () => void;
  #play: PlayFocus | null = null;
  #beadKey = "";
  #timer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;

  /** `onFall` runs when the story's hold ends, so the renderer can let it fall. */
  constructor(onFall: () => void) {
    this.#onFall = onFall;
  }

  get play(): PlayFocus | null {
    return this.#play;
  }

  lit(now = seconds()): boolean {
    return this.#story.lit(now);
  }

  /** The checkpoint landed: its story lights. */
  land(): void {
    this.#story.begin(seconds());
  }

  setRunning(running: boolean): void {
    this.#story.setRunning(running, seconds());
  }

  /** The tour is still telling the story: a lit one holds, and its fall timer moves. */
  hold(): void {
    this.#story.hold(seconds());
    this.schedule();
  }

  /** Select or clear a play; returns whether anything changed. */
  setPlay(play: PlayFocus | null): boolean {
    if (samePlay(play, this.#play)) return false;
    this.#play = play;
    return true;
  }

  /**
   * Deal the beads for `view`: the lit story's new links, or the selected
   * link play's. Returns whether the pool changed; an unchanged set of lanes
   * keeps its beads where they are.
   */
  deal(view: GraphView | null): boolean {
    const lanes = view === null ? [] : beadLanes(view, this.lit(), this.#play);
    const key = lanes.map((lane) => `${lane.edge}:${lane.ways}`).join(",");
    if (key === this.#beadKey) return false;
    this.#beadKey = key;
    assignBeads(this.beads, lanes);
    return true;
  }

  /** Wake the renderer when a lit story should fall; one timer, never frames. */
  schedule(): void {
    this.#clearTimer();
    if (this.#disposed) return;
    const now = seconds();
    const ends = this.#story.endsAt(now);
    if (ends === null) return;
    this.#timer = setTimeout(
      () => {
        this.#timer = null;
        this.#onFall();
      },
      (ends - now) * 1000 + 20,
    );
  }

  reset(): void {
    this.#story.clear();
    this.#play = null;
    this.#beadKey = "";
    this.beads.count = 0;
    this.#clearTimer();
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearTimer();
  }

  #clearTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

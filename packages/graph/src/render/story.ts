/**
 * The links a landing turn made or broke light while it runs, hold through the landing window, then
 * go dark, never staying lit at rest. Times are seconds on any one clock; the renderer asks
 * `lit(now)` and wakes at `endsAt(now)` to let the story fall.
 */
import { LANDING_SECONDS } from "../layout/motion.ts";

export class Story {
  #running = false;
  /** When the story goes dark: Infinity while its turn runs, -Infinity when there is none. */
  #until = -Infinity;
  /** The earliest it may go dark: a step without a running turn still shows its landing. */
  #floor = -Infinity;

  /** A checkpoint landed at `now`. */
  begin(now: number): void {
    this.#floor = now + LANDING_SECONDS;
    this.#until = this.#running ? Infinity : this.#floor;
  }
  /**
   * The agent started or stopped working. A lit story holds while the turn
   * runs and for the landing window after it stops; a dark one stays dark.
   */
  setRunning(running: boolean, now: number): void {
    if (running === this.#running) return;
    this.#running = running;
    if (!running && this.#until === Infinity) {
      this.#until = Math.max(this.#floor, now + LANDING_SECONDS);
    } else if (running && now < this.#until) {
      this.#until = Infinity;
    }
  }

  /** Something is still telling the story (the cursor's tour): a lit story holds the landing window from `now`; a dark one stays dark. */
  hold(now: number): void {
    if (now < this.#until && Number.isFinite(this.#until)) {
      this.#until = Math.max(this.#until, now + LANDING_SECONDS);
    }
  }

  lit(now: number): boolean {
    return now < this.#until;
  }

  /** When a lit story will go dark on its own, or null while its turn runs or it is dark. */
  endsAt(now: number): number | null {
    return now < this.#until && Number.isFinite(this.#until) ? this.#until : null;
  }

  clear(): void {
    this.#until = -Infinity;
    this.#floor = -Infinity;
  }
}

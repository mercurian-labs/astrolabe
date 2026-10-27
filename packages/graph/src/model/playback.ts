/**
 * Playback shows each checkpoint's plays one hold each, then one settle beat with the whole turn's
 * story lit, then moves on; it ends after the last settle beat. Pure: the host holds the shown step
 * for `holdSeconds` and asks for `nextStep`, so resuming after a pause continues from the step
 * after the one shown.
 */
import { isMove, type ThreadRecord } from "./thread.ts";

/** The first play at or after `from` in `checkpoint`'s turn (a re-resolution is no play), or null. */
function playFrom(thread: ThreadRecord, checkpoint: number, from: number): number | null {
  const events = thread.turns[checkpoint]?.events ?? [];
  for (let at = from; at < events.length; at += 1) {
    const event = events[at];
    if (event !== undefined && isMove(event)) return at;
  }
  return null;
}

/** How long a read, amend, write, or unlink play holds. */
export const PLAY_HOLD_SECONDS = 1.6;
/** How long a link play holds: long enough to see its beads run. */
export const LINK_HOLD_SECONDS = 2.4;
/** The beat after a turn's last play, with the whole turn's story lit and nothing selected. */
export const SETTLE_SECONDS = 1;

/** A step of playback: a checkpoint showing one of its plays, or its settle beat (`play` null). */
export interface PlaybackStep {
  readonly checkpoint: number;
  readonly play: number | null;
}

/** Arriving at `checkpoint`: its first play, or its settle beat when its turn has none. */
export function firstStep(thread: ThreadRecord, checkpoint: number): PlaybackStep {
  return { checkpoint, play: playFrom(thread, checkpoint, 0) };
}

/** The step after `step`, or null when playback has reached the end of the thread. */
export function nextStep(thread: ThreadRecord, step: PlaybackStep): PlaybackStep | null {
  if (step.play !== null) {
    return { checkpoint: step.checkpoint, play: playFrom(thread, step.checkpoint, step.play + 1) };
  }
  const next = step.checkpoint + 1;
  return next < thread.turns.length ? firstStep(thread, next) : null;
}

/**
 * Where playback starts when Play is pressed: after the step last shown, or
 * at the current checkpoint's first play when nothing has been shown there;
 * from the start of the thread once it has played to the end.
 */
export function resumeStep(
  thread: ThreadRecord,
  last: PlaybackStep | null,
  checkpoint: number,
): PlaybackStep {
  if (last === null) return firstStep(thread, checkpoint);
  return nextStep(thread, last) ?? firstStep(thread, 0);
}

/** How long `step` holds before playback moves on. */
export function holdSeconds(thread: ThreadRecord, step: PlaybackStep): number {
  if (step.play === null) return SETTLE_SECONDS;
  const event = thread.turns[step.checkpoint]?.events[step.play];
  return event?.kind === "link" ? LINK_HOLD_SECONDS : PLAY_HOLD_SECONDS;
}

import {
  firstStep,
  nextStep,
  pickedPlays,
  resumeStep,
  type PlaybackStep,
  type PlayPick,
  type ThreadRecord,
} from "@mercurian/graph";

/**
 * Which turn the graph shows, whether playback walks the thread, and the chosen move. Live by
 * default (the working turn, else the last, moving on with each run); picking, stepping, playing
 * or choosing a move pins a turn until Live. Checkpoints are the graph's only history, so a pinned
 * turn indexes into them and the host clamps it as the thread changes.
 */
export interface TurnStrip {
  /** The turn the reader pinned, or null: live. */
  readonly pinned: number | null;
  readonly playing: boolean;
  /** The playback step last shown: Pause holds it, Play resumes after it. */
  readonly step: PlaybackStep | null;
  /** The chosen move (or moves) of the shown turn. */
  readonly play: PlayPick | null;
}

export const LIVE_STRIP: TurnStrip = { pinned: null, playing: false, step: null, play: null };

export type TurnStripAction =
  /** A turn picked in the strip, or stepped to: it shows, from its landing. */
  | { readonly type: "pick"; readonly turn: number; readonly live: number }
  /** Back to the working turn, following. */
  | { readonly type: "live" }
  /** Play, or Pause on the move shown. */
  | { readonly type: "toggle-play"; readonly thread: ThreadRecord; readonly live: number }
  /** Playback's hold ran out: the next move, or the end of the thread. */
  | { readonly type: "advance"; readonly thread: ThreadRecord }
  /** A move chosen by hand (or let go of): playback pauses there. */
  | { readonly type: "choose"; readonly play: PlayPick | null; readonly live: number }
  /** The thread now has `turns` turns (a rollback may have taken the pinned one). */
  | { readonly type: "turns"; readonly turns: number };

/** The turn the graph shows: the pinned one, else the live one. */
export const shownCheckpoint = (strip: TurnStrip, live: number) => strip.pinned ?? live;

/** The strip reads as live: nothing pinned or playing, and the camera follows the agent. */
export const stripIsLive = (strip: TurnStrip, following: boolean) =>
  strip.pinned === null && !strip.playing && following;

/**
 * Whether a step shows a move worth holding: writing a folder (or package) is
 * how a file comes to sit there, and has no row and no visit of its own.
 */
function structural(thread: ThreadRecord, step: PlaybackStep): boolean {
  if (step.play === null) return false;
  const event = thread.turns[step.checkpoint]?.events[step.play];
  return event?.kind === "write" && (event.noteKind === "folder" || event.noteKind === "package");
}

/** `step`, or the first step after it that is not structural (see `structural`). */
function readable(thread: ThreadRecord, step: PlaybackStep | null): PlaybackStep | null {
  let at = step;
  while (at !== null && structural(thread, at)) at = nextStep(thread, at);
  return at;
}

/** Where Play starts: after the step last shown, else at the shown turn's first move. */
function playStart(
  thread: ThreadRecord,
  last: PlaybackStep | null,
  checkpoint: number,
): PlaybackStep {
  const start = resumeStep(thread, last, checkpoint);
  return readable(thread, start) ?? firstStep(thread, checkpoint);
}

/** The step after `step`, skipping structural ones, or null at the end of the thread. */
function playNext(thread: ThreadRecord, step: PlaybackStep): PlaybackStep | null {
  return readable(thread, nextStep(thread, step));
}

/** A step as the strip shows it: its turn pinned, its move chosen (none on a settle beat). */
const showing = (step: PlaybackStep, playing: boolean): TurnStrip => ({
  pinned: step.checkpoint,
  playing,
  step,
  play: step.play,
});

export function turnStripReducer(strip: TurnStrip, action: TurnStripAction): TurnStrip {
  switch (action.type) {
    case "pick":
      // Picking the live turn is going live again: the graph moves on with the next run.
      return action.turn === action.live
        ? LIVE_STRIP
        : { pinned: action.turn, playing: false, step: null, play: null };
    case "live":
      return LIVE_STRIP;
    case "toggle-play": {
      if (strip.playing) return { ...strip, playing: false };
      if (action.thread.turns.length === 0) return strip;
      const shown = shownCheckpoint(strip, action.live);
      return showing(playStart(action.thread, strip.step, shown), true);
    }
    case "advance": {
      if (!strip.playing || strip.step === null) return strip;
      const next = playNext(action.thread, strip.step);
      return next === null ? { ...strip, playing: false } : showing(next, true);
    }
    case "choose": {
      const shown = shownCheckpoint(strip, action.live);
      if (action.play === null) return { ...strip, playing: false, play: null };
      // A move chosen pins its turn (the next run would otherwise take the map away from it),
      // and Play resumes after the last move chosen.
      return {
        pinned: shown,
        playing: false,
        step: { checkpoint: shown, play: Math.max(...pickedPlays(action.play)) },
        play: action.play,
      };
    }
    case "turns":
      return clampStrip(strip, action.turns);
  }
}

/**
 * A pin, step, or chosen move on a turn the thread no longer has (a rollback)
 * is discarded: the strip is live again, and a later turn at that index is a
 * new turn, never the old selection come back.
 */
export function clampStrip(strip: TurnStrip, turns: number): TurnStrip {
  const gone =
    (strip.pinned !== null && strip.pinned >= turns) ||
    (strip.step !== null && strip.step.checkpoint >= turns);
  return gone ? LIVE_STRIP : strip;
}

/**
 * Whether the cursor's popover closes as the cursor heads home (`cursor` null): nothing is
 * chosen and nothing plays, so the tour is over and the chip returns. A reader who opens
 * the popover on the parked cursor keeps it: only the cursor leaving a move closes it.
 */
export const popoverClosesOnPark = (strip: TurnStrip, cursor: number | null) =>
  cursor === null && strip.play === null && !strip.playing;

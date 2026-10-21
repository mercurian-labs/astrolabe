import { describe, expect, it } from "vite-plus/test";

import {
  firstStep,
  holdSeconds,
  LINK_HOLD_SECONDS,
  nextStep,
  PLAY_HOLD_SECONDS,
  resumeStep,
  SETTLE_SECONDS,
  type PlaybackStep,
} from "./playback.ts";
import type { ThreadRecord } from "./thread.ts";

const thread: ThreadRecord = {
  id: "walk",
  title: "Walk",
  memoryId: "small",
  turns: [
    {
      id: "t0",
      label: "Three plays",
      events: [
        { kind: "read", note: "A" },
        { kind: "link", from: "A", to: "B" },
        { kind: "amend", note: "B" },
      ],
    },
    { id: "t1", label: "Nothing", events: [] },
    { id: "t2", label: "One play", events: [{ kind: "unlink", from: "A", to: "B" }] },
  ],
};

/** Every step from `start` to the end, each with how long it holds. */
function walk(start: PlaybackStep) {
  const steps: Array<[PlaybackStep, number]> = [];
  let step: PlaybackStep | null = start;
  while (step !== null) {
    steps.push([step, holdSeconds(thread, step)]);
    step = nextStep(thread, step);
  }
  return steps;
}

describe("playback", () => {
  it("walks each play, holds a settle beat, and moves on; an empty turn is one beat", () => {
    expect(walk(firstStep(thread, 0))).toEqual([
      [{ checkpoint: 0, play: 0 }, PLAY_HOLD_SECONDS],
      [{ checkpoint: 0, play: 1 }, LINK_HOLD_SECONDS],
      [{ checkpoint: 0, play: 2 }, PLAY_HOLD_SECONDS],
      [{ checkpoint: 0, play: null }, SETTLE_SECONDS],
      [{ checkpoint: 1, play: null }, SETTLE_SECONDS],
      [{ checkpoint: 2, play: 0 }, PLAY_HOLD_SECONDS],
      [{ checkpoint: 2, play: null }, SETTLE_SECONDS],
    ]);
    expect([PLAY_HOLD_SECONDS, LINK_HOLD_SECONDS, SETTLE_SECONDS]).toEqual([1.6, 2.4, 1]);
  });

  it("resumes after the play it paused on", () => {
    expect(resumeStep(thread, { checkpoint: 0, play: 1 }, 0)).toEqual({ checkpoint: 0, play: 2 });
    // Paused on the settle beat: on to the next checkpoint.
    expect(resumeStep(thread, { checkpoint: 0, play: null }, 0)).toEqual({
      checkpoint: 1,
      play: null,
    });
  });

  it("starts at the current checkpoint's first play when nothing was shown there", () => {
    expect(resumeStep(thread, null, 2)).toEqual({ checkpoint: 2, play: 0 });
    expect(resumeStep(thread, null, 1)).toEqual({ checkpoint: 1, play: null });
  });

  it("ends after the last settle beat, and starts over from there", () => {
    expect(nextStep(thread, { checkpoint: 2, play: null })).toBeNull();
    expect(resumeStep(thread, { checkpoint: 2, play: null }, 2)).toEqual({
      checkpoint: 0,
      play: 0,
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createWikiAutosave, type WikiSaveOutcome } from "./wikiAutosave.ts";

const OK: WikiSaveOutcome = { ok: true };
const OFFLINE: WikiSaveOutcome = { ok: false, message: "Offline.", retry: true };
const REFUSED: WikiSaveOutcome = { ok: false, message: "Refused.", retry: false };

/** A save whose every call waits to be finished by hand, as a slow server would. */
function manualSave() {
  const finishes: Array<(outcome: WikiSaveOutcome) => void> = [];
  const save = vi.fn(() => new Promise<WikiSaveOutcome>((resolve) => finishes.push(resolve)));
  const finish = async (outcome: WikiSaveOutcome) => {
    finishes.shift()?.(outcome);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { save, finish };
}

describe("createWikiAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once typing rests, however many edits came before", async () => {
    const { save, finish } = manualSave();
    const autosave = createWikiAutosave({ save });
    for (let keystroke = 0; keystroke < 50; keystroke += 1) {
      autosave.edited();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(save).not.toHaveBeenCalled();
    expect(autosave.getStatus().kind).toBe("saving");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(1);
    await finish(OK);
    expect(autosave.getStatus()).toEqual({ kind: "idle", saved: true });
  });

  it("saves through unbroken typing at the longest wait", async () => {
    const { save } = manualSave();
    const autosave = createWikiAutosave({ save });
    for (let keystroke = 0; keystroke < 199; keystroke += 1) {
      autosave.edited();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(save).not.toHaveBeenCalled();
    autosave.edited();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("sends one save at a time, and what came during it after", async () => {
    const { save, finish } = manualSave();
    const autosave = createWikiAutosave({ save });
    autosave.edited();
    await vi.advanceTimersByTimeAsync(2_000);
    autosave.edited();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
    await finish(OK);
    expect(autosave.getStatus().kind).toBe("saving");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("keeps a failure showing and retrying with backoff until it lands", async () => {
    const { save, finish } = manualSave();
    const autosave = createWikiAutosave({ save });
    autosave.edited();
    await vi.advanceTimersByTimeAsync(2_000);
    await finish(OFFLINE);
    expect(autosave.getStatus()).toEqual({ kind: "failed", message: "Offline.", retrying: true });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    await finish(OFFLINE);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(3);

    await finish(OK);
    expect(autosave.getStatus()).toEqual({ kind: "idle", saved: true });
  });

  it("stops at a failure a retry can't help, until a new edit or a person tries", async () => {
    const { save, finish } = manualSave();
    const autosave = createWikiAutosave({ save });
    autosave.edited();
    await vi.advanceTimersByTimeAsync(2_000);
    await finish(REFUSED);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.getStatus()).toEqual({ kind: "failed", message: "Refused.", retrying: false });

    autosave.retry();
    expect(save).toHaveBeenCalledTimes(2);
    await finish(REFUSED);
    autosave.edited();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(3);
  });

  it("holds edits while told to, and lands them when released", async () => {
    const { save, finish } = manualSave();
    const autosave = createWikiAutosave({ save });
    autosave.setHeld(true);
    autosave.edited();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.getStatus().kind).toBe("waiting-for-turn");
    expect(await autosave.flush()).toBe(false);

    autosave.setHeld(false);
    expect(save).toHaveBeenCalledTimes(1);
    await finish(OK);
    expect(autosave.getStatus().kind).toBe("idle");
  });

  it("flushes at once, through a save in flight and what came after it", async () => {
    const { save, finish } = manualSave();
    const autosave = createWikiAutosave({ save });
    expect(await autosave.flush()).toBe(true);

    autosave.edited();
    await vi.advanceTimersByTimeAsync(2_000);
    autosave.edited();
    const flushed = autosave.flush();
    await finish(OK);
    expect(save).toHaveBeenCalledTimes(2);
    await finish(OK);
    expect(await flushed).toBe(true);

    autosave.edited();
    const failed = autosave.flush();
    await finish(OFFLINE);
    expect(await failed).toBe(false);
  });

  it("forgets unsaved edits on cancel", async () => {
    const { save } = manualSave();
    const autosave = createWikiAutosave({ save });
    autosave.edited();
    autosave.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).not.toHaveBeenCalled();
    expect(autosave.getStatus()).toEqual({ kind: "idle", saved: false });
  });

  it("keeps a save in flight when its view leaves, and retries what the view last held", async () => {
    const { save: viewSave, finish: finishView } = manualSave();
    const { save: lastSave, finish: finishLast } = manualSave();
    const onOrphanedFailure = vi.fn();
    const autosave = createWikiAutosave({ save: viewSave, onOrphanedFailure });
    autosave.edited();
    await vi.advanceTimersByTimeAsync(2_000);
    autosave.retire(lastSave);
    await finishView(OFFLINE);
    expect(onOrphanedFailure).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(lastSave).toHaveBeenCalledTimes(1);
    await finishLast(OFFLINE);
    expect(onOrphanedFailure).toHaveBeenCalledTimes(1);
  });

  it("outlives its view until the last edits land, and reports a failure after it", async () => {
    const { save: viewSave } = manualSave();
    const { save: lastSave, finish } = manualSave();
    const onOrphanedFailure = vi.fn();
    const autosave = createWikiAutosave({ save: viewSave, onOrphanedFailure });
    autosave.edited();
    autosave.retire(lastSave);
    expect(viewSave).not.toHaveBeenCalled();
    expect(lastSave).toHaveBeenCalledTimes(1);
    await finish(OFFLINE);
    expect(onOrphanedFailure).toHaveBeenCalledWith("Offline.");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(lastSave).toHaveBeenCalledTimes(2);
    await finish(OK);
    expect(autosave.getStatus().kind).toBe("idle");
  });
});

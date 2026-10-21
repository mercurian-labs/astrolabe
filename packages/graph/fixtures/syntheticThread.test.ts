import { describe, expect, it } from "vite-plus/test";

import { readingAt } from "../src/model/reading.ts";
import { SYNTHETIC_SIZES, syntheticMemory } from "./synthetic.ts";
import { SYNTHETIC_CHECKPOINTS, syntheticThread } from "./syntheticThread.ts";

describe("syntheticThread", () => {
  const memory = syntheticMemory({ notes: 3000 });

  it("is the same for the same memory and seed, and has the checkpoints asked for", () => {
    for (const checkpoints of SYNTHETIC_CHECKPOINTS) {
      const thread = syntheticThread(memory, { checkpoints });
      expect(thread.turns).toHaveLength(checkpoints);
      expect(syntheticThread(memory, { checkpoints })).toEqual(thread);
    }
    expect(syntheticThread(memory, { checkpoints: 10, seed: 99 })).not.toEqual(
      syntheticThread(memory, { checkpoints: 10 }),
    );
  });

  it("only reads and amends written notes, writes existing red links, and links or unlinks what exists", () => {
    for (const size of SYNTHETIC_SIZES.slice(0, 3)) {
      const scaled = syntheticMemory({ notes: size });
      const thread = syntheticThread(scaled, { checkpoints: 200 });
      const writtenNotes = new Set(
        scaled.notes.filter((note) => !note.frontier).map((note) => note.id),
      );
      const redLinks = new Set(scaled.notes.filter((note) => note.frontier).map((note) => note.id));
      const links = new Set(scaled.links.map((link) => `${link.from}\u0000${link.to}`));
      let reads = 0;
      let crossLinks = 0;
      const groupOf = new Map(scaled.notes.map((note) => [note.id, note.group]));
      for (const turn of thread.turns) {
        expect(turn.label.endsWith("?")).toBe(true);
        for (const event of turn.events) {
          switch (event.kind) {
            case "read":
            case "amend":
              expect(writtenNotes.has(event.note)).toBe(true);
              reads += event.kind === "read" ? 1 : 0;
              break;
            case "write":
              expect(redLinks.has(event.note)).toBe(true);
              redLinks.delete(event.note);
              writtenNotes.add(event.note);
              break;
            case "link": {
              expect(writtenNotes.has(event.from)).toBe(true);
              const known = writtenNotes.has(event.to) || redLinks.has(event.to);
              const reaching = event.to.includes("Open Question");
              expect(known || reaching).toBe(true);
              if (reaching && !known) redLinks.add(event.to);
              if (groupOf.get(event.from) !== groupOf.get(event.to) && groupOf.has(event.to))
                crossLinks += 1;
              links.add(`${event.from}\u0000${event.to}`);
              break;
            }
            case "unlink":
              expect(links.has(`${event.from}\u0000${event.to}`)).toBe(true);
              links.delete(`${event.from}\u0000${event.to}`);
              break;
          }
        }
      }
      expect(reads).toBeGreaterThan(200);
      expect(crossLinks).toBeGreaterThan(0);
    }
  });

  it("replays into a reading at its last checkpoint", () => {
    const thread = syntheticThread(memory, { checkpoints: 50 });
    const reading = readingAt(memory, thread, 49, { depth: 1, thisTurnOnly: false });
    expect(reading.now.size).toBeGreaterThan(0);
    expect(reading.checkpoint).toBe(49);
  });
});

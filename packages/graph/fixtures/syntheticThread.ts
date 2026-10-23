/**
 * A thread over a synthetic memory, to play its story at scale. Each turn
 * reads one to four notes, mostly within one cluster and now and then from a
 * far one (so the gathering travels), amends some of what it read, sometimes
 * writes a red link (filling it where it stands), adds one to three links
 * (some across clusters), and now and then removes one. Every event names a
 * note the memory has at that turn, or reaches toward a new red link.
 * Deterministic for a memory and seed.
 */
import type { Memory, MemoryNote } from "../src/model/memory.ts";
import type { ThreadEvent, ThreadRecord, ThreadTurn } from "../src/model/thread.ts";
import { seededRandom } from "./synthetic.ts";

export const SYNTHETIC_CHECKPOINTS = [10, 50, 200] as const;
export type SyntheticCheckpoints = (typeof SYNTHETIC_CHECKPOINTS)[number];

export interface SyntheticThreadOptions {
  readonly checkpoints: number;
  readonly seed?: number;
}

const QUESTIONS = [
  "Where does {note} stand?",
  "What did we decide about {note}?",
  "How does {note} tie to the rest?",
  "Is {note} still true?",
  "What is missing from {note}?",
  "Why did {note} change?",
  "Who depends on {note}?",
  "Can {note} be simpler?",
];

export function syntheticThread(memory: Memory, options: SyntheticThreadOptions): ThreadRecord {
  const random = seededRandom((options.seed ?? 7) ^ memory.notes.length);
  const pick = <T>(items: ReadonlyArray<T>): T | undefined =>
    items[Math.floor(random() * items.length)];
  // Written notes and red links per group, kept current as the turns write.
  const written = new Map<string, Array<string>>();
  const frontier = new Map<string, Array<string>>();
  const groupOf = new Map<string, string>();
  const shelve = (shelf: Map<string, Array<string>>, group: string, id: string) => {
    const list = shelf.get(group) ?? [];
    list.push(id);
    shelf.set(group, list);
  };
  memory.notes.forEach((note: MemoryNote) => {
    const group = note.group ?? "all";
    groupOf.set(note.id, group);
    shelve(note.frontier ? frontier : written, group, note.id);
  });
  const groups = [...written.keys()].filter((group) => (written.get(group)?.length ?? 0) > 0);
  // Links standing now, so an unlink removes one that exists.
  const linked = new Set(memory.links.map((link) => `${link.from}\u0000${link.to}`));
  const linkedFrom = (from: string, to: string) => linked.has(`${from}\u0000${to}`);
  let home = pick(groups) ?? "all";
  let reached = 0;

  const turns: Array<ThreadTurn> = [];
  for (let turn = 0; turn < options.checkpoints; turn += 1) {
    const events: Array<ThreadEvent> = [];
    // Mostly the same cluster as last turn; one turn in five travels far.
    if (random() < 0.2) home = pick(groups) ?? home;
    const local = written.get(home) ?? [];
    const readCount = 1 + Math.floor(random() * 4);
    const read = new Set<string>();
    for (let index = 0; index < readCount; index += 1) {
      const far = random() < 0.15 ? (written.get(pick(groups) ?? home) ?? local) : local;
      const note = pick(far);
      if (note !== undefined) read.add(note);
    }
    for (const note of read) events.push({ kind: "read", note });
    for (const note of read) if (random() < 0.3) events.push({ kind: "amend", note });
    const subject = [...read][0] ?? local[0];
    // Now and then a red link of the cluster is written, and stops being red.
    const reds = frontier.get(home) ?? [];
    if (reds.length > 0 && random() < 0.35) {
      const [filled] = reds.splice(Math.floor(random() * reds.length), 1);
      if (filled !== undefined) {
        events.push({ kind: "write", note: filled });
        shelve(written, home, filled);
      }
    }
    const linkCount = subject === undefined ? 0 : 1 + Math.floor(random() * 3);
    for (let index = 0; index < linkCount; index += 1) {
      const roll = random();
      let to: string | undefined;
      if (roll < 0.1) {
        // Reaching toward a note nobody has written: a new red link.
        reached += 1;
        to = `${home} Open Question ${reached}`;
        shelve(frontier, home, to);
        groupOf.set(to, home);
      } else {
        to = pick(
          roll < 0.75 ? (written.get(home) ?? local) : (written.get(pick(groups) ?? home) ?? local),
        );
      }
      if (subject === undefined || to === undefined || to === subject || linkedFrom(subject, to))
        continue;
      events.push({ kind: "link", from: subject, to });
      linked.add(`${subject}\u0000${to}`);
    }
    if (subject !== undefined && random() < 0.15) {
      const target = (written.get(home) ?? []).find((to) => linkedFrom(subject, to));
      if (target !== undefined) {
        events.push({ kind: "unlink", from: subject, to: target });
        linked.delete(`${subject}\u0000${target}`);
      }
    }
    const question = (pick(QUESTIONS) ?? "What about {note}?").replace("{note}", subject ?? home);
    turns.push({ id: `t${turn + 1}`, label: question, events });
  }
  return {
    id: `synthetic-thread-${memory.notes.length}-${options.checkpoints}`,
    title: `A synthetic story over ${memory.notes.length} notes`,
    memoryId: memory.id,
    turns,
  };
}

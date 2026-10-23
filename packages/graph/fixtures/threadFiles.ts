/**
 * What a thread's turns do to the notes' files. The record says which note a
 * play touched; this says what it wrote there, so the playground can put the
 * writes on disk the way an agent does and let the editor show them.
 *
 * Every event counts toward a position, reads included, so a position is the
 * number of the thread's events that have happened: the checkpoint `c` ends at
 * `turnEnd(thread, c)`, and play `p` of it has happened at `turnStart + p + 1`.
 */
import type { ThreadEvent, ThreadRecord } from "../src/model/thread.ts";

/** Prose for the scripted almagest thread, by play id (`turn:index`). */
export const ATLAS_THREAD_PROSE: Readonly<Record<string, string>> = {
  "t3:0":
    "**Still at rest, organic in motion.** A running turn alone moves nothing: only a note whose place changes moves, drifting a little on its way and landing exactly. Hover, pick, and play change ink, size, and labels, never a note's place. *(2026-09-27.)*",
  "t3:1":
    "**Motion is a change of place, never a state.** Nothing on a surface repaints while it is at rest, so a still surface costs no frames. The [[Atlas Graph]] is the first surface held to it. *(2026-09-27.)*",
  "t3:2": "The ruling is tuned in the [[Design Lab]].",
  "t5:0":
    "**A map shown as a lens tints its edges, not its notes.** Each shown map takes one lens colour, and an edge it types keeps that colour at 35% even at rest, so a lens reads without hovering.",
  "t5:1": "Lens colours never reuse a colour the [[Status Vocabulary]] owns.",
  "t6:1":
    "A pull request's review, read as the outcome of the thread that produced it rather than as a surface of its own.",
  "t6:2": "An approved review is what a [[Merges|merge]] waits on,",
  "t6:3": "and its comments return to the [[Threads|thread]] as the next turn's context.",
  "t7:0":
    "*(2026-09-27.)* Whether work is published is a fact of its branch, shown where branches are, not on every checkpoint.",
  "t8:1": "Whether distant notes blur is open: see [[Depth of Field]].",
  "t9:0":
    "**The rendering budget.** At rest the graph costs no frames and no timers. In motion a frame stays under 4 ms of render time at 10,000 notes on the Lean renderer, and only lit edges are drawn at all.",
  "t9:1": "The numbers live on [[Render Budget]].",
  "t9:2": "Every surface that animates names its cost against the [[Render Budget]].",
  "t10:2":
    "*(2026-09-27.)* The memory is read in the [[Atlas Graph]] as a thread's reading: the notes the thread reached, gathered in front of the rest, each turn's amendments marked where they landed.",
};

/** The note whose file `event` writes, or null for a read. */
function writtenNote(event: ThreadEvent): string | null {
  switch (event.kind) {
    case "read":
      return null;
    case "amend":
    case "write":
      return event.note;
    case "link":
    case "unlink":
      return event.from;
    case "resolve":
      return null;
  }
}

/** Every note whose file the thread writes. */
export function writtenNotes(thread: ThreadRecord): ReadonlyArray<string> {
  const notes = new Set<string>();
  for (const turn of thread.turns) {
    for (const event of turn.events) {
      const note = writtenNote(event);
      if (note !== null) notes.add(note);
    }
  }
  return [...notes];
}

/** The position at which checkpoint `checkpoint`'s turn starts: every earlier event has happened. */
export function turnStart(thread: ThreadRecord, checkpoint: number): number {
  let position = 0;
  for (const turn of thread.turns.slice(0, Math.max(0, checkpoint))) position += turn.events.length;
  return position;
}

/** The position at which checkpoint `checkpoint`'s turn has landed. */
export const turnEnd = (thread: ThreadRecord, checkpoint: number) =>
  turnStart(thread, checkpoint + 1);

/** Where a new paragraph goes: after the note's first paragraph of prose, else at the end. */
function paragraphSlot(text: string): number {
  const lines = text.split("\n");
  let offset = 0;
  let inFrontmatter = lines[0] === "---";
  let inProse = false;
  for (const [index, line] of lines.entries()) {
    if (inFrontmatter) {
      if (index > 0 && line === "---") inFrontmatter = false;
    } else if (inProse && line.trim() === "") {
      return offset - 1;
    } else if (line.trim() !== "" && !line.startsWith("#")) {
      inProse = true;
    }
    offset += line.length + 1;
  }
  return text.length;
}

function insertParagraph(text: string, prose: string): { text: string; end: number } {
  const at = paragraphSlot(text);
  const before = text.slice(0, at);
  const lead =
    before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const inserted = `${lead}${prose}`;
  return {
    text: `${before}${inserted}${at < text.length ? "" : "\n"}${text.slice(at)}`,
    end: at + inserted.length,
  };
}

/** `[[To]]` and `[[To|alias]]` become plain text: the link is gone, the words stay. */
function removeLinks(text: string, to: string): string {
  const escaped = to.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replaceAll(
    new RegExp(`\\[\\[${escaped}(?:#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, "g"),
    (_match, alias: string | undefined) => alias ?? to,
  );
}

/**
 * The thread's files at a position, stepped one event at a time. Within a
 * turn, a link into a note the turn already wrote extends what it wrote, the
 * way an agent adds a link to the paragraph it just amended; otherwise it
 * starts a paragraph of its own.
 */
export class ThreadFiles {
  readonly #thread: ThreadRecord;
  readonly #prose: Readonly<Record<string, string>>;
  readonly texts: Map<string, string>;
  /** Where the current turn last wrote in each note. */
  #cursors = new Map<string, number>();
  #position = 0;

  constructor(
    thread: ThreadRecord,
    seeds: ReadonlyMap<string, string>,
    prose: Readonly<Record<string, string>> = {},
  ) {
    this.#thread = thread;
    this.#prose = prose;
    this.texts = new Map(seeds);
  }

  get position(): number {
    return this.#position;
  }

  /** Applies the next event. Returns the note whose file it changed, or null. */
  step(): string | null {
    let remaining = this.#position;
    for (const turn of this.#thread.turns) {
      if (remaining >= turn.events.length) {
        remaining -= turn.events.length;
        continue;
      }
      if (remaining === 0) this.#cursors = new Map();
      const event = turn.events[remaining];
      this.#position += 1;
      return event === undefined ? null : this.#apply(`${turn.id}:${remaining}`, event);
    }
    return null;
  }

  #apply(id: string, event: ThreadEvent): string | null {
    const note = writtenNote(event);
    if (note === null) return null;
    const text = this.texts.get(note) ?? "";
    const cursor = this.#cursors.get(note);
    let next: { text: string; end: number };
    switch (event.kind) {
      case "write": {
        const body = `# ${event.note}\n\n${this.#prose[id] ?? ""}`;
        next = { text: `${body}\n`, end: body.length };
        break;
      }
      case "amend":
        next = insertParagraph(text, this.#prose[id] ?? "Amended in this turn.");
        break;
      case "link": {
        const prose = this.#prose[id] ?? `See [[${event.to}]].`;
        next =
          cursor === undefined
            ? insertParagraph(text, prose)
            : {
                text: `${text.slice(0, cursor)} ${prose}${text.slice(cursor)}`,
                end: cursor + prose.length + 1,
              };
        break;
      }
      case "unlink": {
        const removed = removeLinks(text, event.to);
        next = { text: removed, end: cursor ?? 0 };
        break;
      }
      case "read":
      case "resolve":
        return null;
    }
    this.texts.set(note, next.text);
    if (event.kind !== "unlink") this.#cursors.set(note, next.end);
    return note;
  }
}

/** The thread's files once `position` events have happened. */
export function filesAt(
  thread: ThreadRecord,
  seeds: ReadonlyMap<string, string>,
  position: number,
  prose?: Readonly<Record<string, string>>,
): ThreadFiles {
  const files = new ThreadFiles(thread, seeds, prose);
  while (files.position < position && files.position < turnEnd(thread, thread.turns.length)) {
    files.step();
  }
  return files;
}

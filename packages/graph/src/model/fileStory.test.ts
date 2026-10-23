import { describe, expect, it } from "vite-plus/test";

import { storyLevel } from "./level.ts";
import type { Memory } from "./memory.ts";
import { memoryBefore, playRows } from "./plays.ts";
import { readingAt, threadIndex, threadUniverse } from "./reading.ts";
import { NO_FILTERS } from "./search.ts";
import { turnGrew, type ThreadEvent, type ThreadRecord, type ThreadTurn } from "./thread.ts";
import { buildUniverse, grewFrom, growUniverse } from "./universe.ts";
import { deriveView, regionShapes } from "./view.ts";

// A thread told at file level, the way T3 Code's Graph surface tells one: each turn writes
// or amends files, a folder written the first time a file lands in it.

const MEMORY: Memory = { id: "t", notes: [], links: [], lenses: [] };

/** A turn writing (or, once written, amending) `files`, with their folders, as the host tells it. */
function turnsOf(files: ReadonlyArray<ReadonlyArray<string>>): ThreadTurn[] {
  const written = new Set<string>();
  return files.map((paths, index) => {
    const events: ThreadEvent[] = [];
    for (const path of paths) {
      const segments = path.split("/");
      let parent: string | undefined;
      for (let depth = 1; depth < segments.length; depth += 1) {
        const folder = segments.slice(0, depth).join("/");
        if (!written.has(folder)) {
          written.add(folder);
          events.push({
            kind: "write",
            note: folder,
            name: segments[depth - 1] ?? folder,
            noteKind: "folder",
            ...(parent === undefined ? {} : { parent }),
          });
        }
        parent = folder;
      }
      const at = parent === undefined ? {} : { parent };
      if (written.has(path)) events.push({ kind: "amend", note: path, noteKind: "file", ...at });
      else {
        written.add(path);
        events.push({
          kind: "write",
          note: path,
          name: segments.at(-1) ?? path,
          noteKind: "file",
          ...at,
        });
      }
    }
    return { id: `turn-${index}`, label: `Turn ${index + 1}`, events };
  });
}

const story = (files: ReadonlyArray<ReadonlyArray<string>>): ThreadRecord => ({
  id: "t",
  title: "",
  memoryId: "t",
  turns: turnsOf(files),
});
const universeOf = (thread: ThreadRecord) =>
  buildUniverse("t/t", threadUniverse(MEMORY, thread), threadIndex(MEMORY, thread));

const LANDING = [
  "apps/web/src/components/graph/a.ts",
  "apps/web/src/components/graph/b.ts",
  "apps/web/src/components/Chat.tsx",
  "apps/web/package.json",
  "packages/x/y.ts",
  "packages/x/z.ts",
];
const FOLLOW_UP = ["apps/web/src/components/graph/a.ts", "apps/web/src/components/graph/b.ts"];

describe("a file-level thread at its story's level", () => {
  const thread = story([LANDING, FOLLOW_UP]);
  const universe = universeOf(thread);
  const reading = readingAt(MEMORY, thread, 1, { depth: 0, thisTurnOnly: false });
  const closed = storyLevel(universe, reading, 10_000);
  const view = deriveView({
    universe,
    lenses: [],
    shownLensSlots: [],
    reading,
    whole: false,
    pickedId: null,
    depth: 0,
    filters: NO_FILTERS,
    closed,
    quietAncestors: true,
  });
  const index = (id: string) => universe.indexOf.get(id) ?? -1;

  it("counts what a closed container holds, in files", () => {
    const packages = view.nodeAt.get(index("packages")) ?? -1;
    expect(packages).toBeGreaterThanOrEqual(0);
    expect(view.nodeCount?.[packages]).toBe("2 files");
    // A file is a note, not a container: it says no count.
    expect(view.nodeCount?.[view.nodeAt.get(index("apps/web/package.json")) ?? -1]).toBe("");
  });

  it("draws the story's group and one parent, named by its path; the ancestors above go bare", () => {
    const regions = regionShapes(view, universe, (each) => each);
    const region = (id: string) => regions.find((each) => each.note === index(id));
    expect(region("apps/web/src/components/graph")?.bare).toBe(false);
    expect(region("apps/web/src/components/graph")?.name).toBe("graph");
    expect(region("apps/web/src/components")?.bare).toBe(false);
    expect(region("apps/web/src/components")?.name).toBe("apps/web/src/components");
    for (const id of ["apps", "apps/web", "apps/web/src"]) {
      expect(region(id)?.bare).toBe(true);
      expect(region(id)?.name).toBe("");
    }
  });

  it("draws every open region when the host leaves the ancestors loud (the default)", () => {
    const loud = regionShapes({ ...view, quietAncestors: false }, universe, (each) => each);
    expect(loud.some((each) => each.bare)).toBe(false);
    expect(loud.find((each) => each.note === index("apps/web/src/components"))?.name).toBe(
      "src/components",
    );
  });
});

describe("a growing thread", () => {
  const before = story([LANDING, ["apps/web/src/components/graph/a.ts"]]);
  const after = story([LANDING, ["apps/web/src/components/graph/a.ts", "apps/web/src/aaa.ts"]]);

  it("keeps every note's index when its universe grows, new notes after", () => {
    const first = universeOf(before);
    const grown = growUniverse(first, universeOf(after));
    expect(grewFrom(first, grown)).toBe(true);
    first.nodes.forEach((node, at) => expect(grown.nodes[at]?.id).toBe(node.id));
    expect(grown.nodes.at(-1)?.id).toBe("apps/web/src/aaa.ts");
    // Containment follows the new indices.
    const aaa = grown.indexOf.get("apps/web/src/aaa.ts") ?? -1;
    const src = grown.indexOf.get("apps/web/src") ?? -1;
    expect(grown.parentOf[aaa]).toBe(src);
    expect(grown.childrenOf[src]).toContain(aaa);
    // A plain build sorts by id, so the new note would have shifted the others.
    expect(grewFrom(first, universeOf(after))).toBe(false);
  });

  it("leaves a universe that is no superset (a rolled-back turn) as built", () => {
    const shrunk = universeOf(story([LANDING]));
    expect(growUniverse(universeOf(after), shrunk)).toBe(shrunk);
  });

  it("knows a turn that grew from one that changed", () => {
    expect(turnGrew(before.turns[1], after.turns[1])).toBe(true);
    expect(turnGrew(after.turns[1], before.turns[1])).toBe(false);
    expect(turnGrew(before.turns[0], after.turns[1])).toBe(false);
  });
});

describe("the cursor popover's rows", () => {
  it("lists the files in order under their folders, without the folders' own writes", () => {
    const thread = story([LANDING]);
    const turn = thread.turns[0];
    if (turn === undefined) throw new Error("no turn");
    const rows = playRows(turn, memoryBefore(MEMORY, thread, 0));
    expect(
      rows.map((row) => (row.kind === "group" ? `# ${row.name}` : `${row.glyph} ${row.text}`)),
    ).toEqual([
      "# apps/web/src/components/graph",
      "+ wrote a.ts",
      "+ wrote b.ts",
      "# apps/web/src/components",
      "+ wrote Chat.tsx",
      "# apps/web",
      "+ wrote package.json",
      "# packages/x",
      "+ wrote y.ts",
      "+ wrote z.ts",
    ]);
    // A heading chooses the plays under it.
    const first = rows[0];
    expect(first?.kind === "group" ? first.plays.length : 0).toBe(2);
  });
});

describe("a story spanning the repository's top, at two frame sizes", () => {
  const files = [
    ...Array.from({ length: 10 }, (_, at) => `packages/graph/src/model/m${at}.ts`),
    ...Array.from({ length: 10 }, (_, at) => `packages/graph/src/render/r${at}.ts`),
    ...Array.from({ length: 8 }, (_, at) => `packages/code-graph/src/c${at}.ts`),
    ...Array.from({ length: 5 }, (_, at) => `packages/editor/e${at}.ts`),
    "pnpm-lock.yaml",
  ];
  const thread = story([files]);
  const universe = universeOf(thread);
  const reading = readingAt(MEMORY, thread, 0, { depth: 0, thisTurnOnly: false });
  const notes = files.map((id) => universe.indexOf.get(id) ?? -1);
  const index = (id: string) => universe.indexOf.get(id) ?? -1;
  /** What shows for `note` at a level: itself, or the outermost closed container above it. */
  const holder = (closed: ReadonlySet<number>, note: number) => {
    let shown = note;
    for (let up = universe.parentOf[note] ?? -1; up >= 0; up = universe.parentOf[up] ?? -1) {
      if (closed.has(up)) shown = up;
    }
    return shown;
  };
  const chain = (note: number) => {
    const up: Array<number> = [];
    for (let at = note; at >= 0; at = universe.parentOf[at] ?? -1) up.push(at);
    return up;
  };

  it("reads as one node per top folder without filling, however wide the frame", () => {
    expect(storyLevel(universe, reading, 200).has(index("packages"))).toBe(true);
  });

  it("fills the frame with the story's folders, a wider frame showing at least what a narrower did", () => {
    const narrow = storyLevel(universe, reading, 8, true);
    const wide = storyLevel(universe, reading, 40, true);
    expect(narrow.has(index("packages"))).toBe(false);
    for (const note of notes) {
      // At the wide level each note shows as the narrow level's thing, or something inside it.
      expect(chain(holder(wide, note))).toContain(holder(narrow, note));
    }
    const shown = (closed: ReadonlySet<number>) =>
      new Set(notes.map((note) => holder(closed, note)));
    expect(shown(wide).size).toBeGreaterThan(shown(narrow).size);
    expect(shown(narrow).size).toBeLessThanOrEqual(8);
    expect(shown(wide).size).toBeLessThanOrEqual(40);
    // Files are the default level: no file is opened past.
    expect(storyLevel(universe, reading, 1000, true).size).toBe(0);
  });
});

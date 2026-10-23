import { afterAll, describe, expect, it } from "vite-plus/test";

// The graph's own replay, by path: its package exports only its React root.
import { readingAt } from "../../graph/src/model/reading.ts";
import { buildIndex } from "./index/build.ts";
import type { Memory, ThreadEvent, ThreadRecord } from "./model/graph.ts";
import { tempRepo, TWO_COMMITS } from "./testing/gitRepo.ts";
import { areaOf, buildStory } from "./story.ts";

const A = (rest: string) => `src/a.ts#${rest}`;
const B = (rest: string) => `src/b.ts#${rest}`;
const OPTIONS = { id: "demo", paths: [], maxBytes: 1 << 20 };

/**
 * What the graph's replay needs of a memory and a thread: notes unique, links
 * and lens edges between known notes, every event naming a note the memory or
 * an earlier write holds (a link may reach toward a red link), and every
 * written note's parent already known.
 */
function expectReplayable(memory: Memory, thread: ThreadRecord) {
  const known = new Set(memory.notes.map((note) => note.id));
  expect(known.size).toBe(memory.notes.length);
  for (const note of memory.notes) {
    if (note.parent !== undefined) expect(known.has(note.parent)).toBe(true);
  }
  for (const link of memory.links) expect(known.has(link.from) && known.has(link.to)).toBe(true);
  expect(thread.memoryId).toBe(memory.id);
  const reachable = (id: string) => known.has(id) || id.startsWith("frontier:");
  for (const turn of thread.turns) {
    for (const event of turn.events) {
      if (event.kind === "write") {
        if (event.parent !== undefined) expect(known.has(event.parent)).toBe(true);
        known.add(event.note);
      } else if (event.kind === "amend" || event.kind === "read") {
        expect(known.has(event.note)).toBe(true);
      } else {
        expect(known.has(event.from)).toBe(true);
        expect(reachable(event.to)).toBe(true);
      }
    }
  }
  for (const lens of memory.lenses) {
    for (const edge of lens.edges) {
      expect(known.has(edge.from) && reachable(edge.to)).toBe(true);
      expect(lens.types[edge.type]).toBeTypeOf("string");
    }
  }
}

const writes = (events: ReadonlyArray<ThreadEvent> = []) =>
  events.flatMap((event) =>
    event.kind === "write" ? [`${event.noteKind} ${event.note} <- ${event.parent ?? "-"}`] : [],
  );

describe("buildStory", () => {
  const repo = tempRepo();
  const root = repo.commit({ "README.md": "start\n" }, "start");
  const first = repo.commit(TWO_COMMITS.first, "Add a, b, and c");
  const second = repo.commit(TWO_COMMITS.second, "Write later, change change, drop drop");
  afterAll(() => repo.remove());

  it("tells each commit as a turn: writes, amends, links, then unlinks, each by kind", async () => {
    const { story } = await buildStory(repo.dir, root, second, OPTIONS);
    const [opening, next] = story.thread.turns;
    expect(story.thread.turns.map((turn) => turn.label)).toEqual([
      "Add a, b, and c",
      "Write later, change change, drop drop",
    ]);
    // The folder first, then each file before its definitions.
    expect(writes(opening?.events)).toEqual([
      "folder src#folder:src <- -",
      `file ${A("file:a.ts")} <- src#folder:src`,
      `function ${A("function:keep")} <- ${A("file:a.ts")}`,
      `function ${A("function:change")} <- ${A("file:a.ts")}`,
      `function ${A("function:drop")} <- ${A("file:a.ts")}`,
      `file ${B("file:b.ts")} <- src#folder:src`,
      `function ${B("function:user")} <- ${B("file:b.ts")}`,
      "file src/c.ts#file:c.ts <- src#folder:src",
      "function src/c.ts#function:other <- src/c.ts#file:c.ts",
    ]);
    expect(opening?.events).toContainEqual({
      kind: "link",
      from: B("function:user"),
      to: "frontier:later",
      linkKind: "calls",
      resolution: "heuristic",
    });

    const about = (id: string, name: string, startLine: number, endLine: number) => ({
      note: id,
      name,
      group: "src/a.ts",
      parent: A("file:a.ts"),
      range: { startLine, endLine },
      signature: `function ${name}()`,
      noteKind: "function" as const,
    });
    expect(next?.events).toEqual([
      { kind: "write", ...about(A("function:later"), "later", 7, 9) },
      { kind: "amend", ...about(A("function:change"), "change", 4, 6) },
      {
        kind: "link",
        from: A("file:a.ts"),
        to: A("function:later"),
        linkKind: "exports",
        resolution: "exact",
      },
      {
        kind: "link",
        from: A("function:later"),
        to: A("function:keep"),
        linkKind: "calls",
        resolution: "exact",
      },
      {
        kind: "link",
        from: B("function:user"),
        to: A("function:later"),
        linkKind: "calls",
        resolution: "exact",
      },
      {
        kind: "unlink",
        from: A("file:a.ts"),
        to: A("function:drop"),
        linkKind: "exports",
        resolution: "exact",
      },
      {
        kind: "unlink",
        from: B("function:user"),
        to: "frontier:later",
        linkKind: "calls",
        resolution: "heuristic",
      },
    ]);
    expect(story.removed).toEqual([A("function:drop")]);
    // Where it was read from, and each turn by its commit, so a viewer can fetch its files.
    expect(story.source).toEqual({ repo: repo.dir, paths: [] });
    expect(story.thread.turns.map((turn) => turn.id)).toEqual([first, second]);
  });

  it("starts the memory at the first commit; an empty start replays", async () => {
    const { story } = await buildStory(repo.dir, root, second, OPTIONS);
    expect(story.memory.notes).toEqual([]);
    expect(story.memory.links).toEqual([]);
    expectReplayable(story.memory, story.thread);
    expect(story.memory.lenses.map((lens) => lens.name)).toEqual(["Packages", "Relationships"]);
    const [packages, relationships] = story.memory.lenses;
    // Every tie to a parent the run ever had, the dropped function's included.
    expect(packages?.edges).toContainEqual({
      from: A("file:a.ts"),
      type: "src",
      to: A("function:drop"),
    });
    expect(Object.keys(relationships?.types ?? {})).toEqual(["imports", "exports", "calls"]);
    expect(relationships?.edges).toContainEqual({
      from: B("function:user"),
      type: "calls",
      to: A("function:later"),
    });
  });

  it("holds the first commit's notes with kind and parent, and its links with kind and resolution", async () => {
    const { story } = await buildStory(repo.dir, first, second, OPTIONS);
    const note = (id: string) => story.memory.notes.find((candidate) => candidate.id === id);
    expect(note("src#folder:src")).toEqual({
      id: "src#folder:src",
      name: "src",
      frontier: false,
      group: "src",
      kind: "folder",
    });
    expect(note(A("function:drop"))).toEqual({
      id: A("function:drop"),
      name: "drop",
      frontier: false,
      group: "src/a.ts",
      kind: "function",
      signature: "function drop()",
      parent: A("file:a.ts"),
      range: { startLine: 7, endLine: 7 },
    });
    expect(note("frontier:later")).toEqual({ id: "frontier:later", name: "later", frontier: true });
    expect(note(A("function:later"))).toBeUndefined();
    expect(story.memory.links).toContainEqual({
      from: B("function:user"),
      to: A("function:change"),
      kind: "calls",
      resolution: "exact",
    });
    expectReplayable(story.memory, story.thread);
  });

  it("names areas by two directories below the story's root", () => {
    const roots = ["packages/graph"];
    expect(areaOf("packages/graph/src/model/memory.ts", roots)).toBe("src/model");
    expect(areaOf("packages/graph/src/render/flat/x.ts", roots)).toBe("src/render");
    expect(areaOf("packages/graph/playground/main.tsx", roots)).toBe("playground");
    expect(areaOf("packages/graph/vite.config.ts", roots)).toBe(".");
    expect(areaOf("aider/coders/base.py", [])).toBe("aider/coders");
  });
});

describe("containers in a story", () => {
  it("never amends a file or folder, and writes a folder once, when first seen", async () => {
    const repo = tempRepo();
    try {
      const root = repo.commit({ "README.md": "start\n" }, "start");
      repo.commit({ "src/m.ts": "export function f() {}\n" }, "add m");
      // The file's own text changes (a new import), and f is untouched.
      repo.commit({ "src/m.ts": 'import "./side.ts";\nexport function f() {}\n' }, "import");
      repo.commit({ "src/deep/n.ts": "export function n() {}\n" }, "add n");
      const last = repo.commit({ "src/deep/o.ts": "export function o() {}\n" }, "add o");
      const { story, deltas } = await buildStory(repo.dir, root, last, OPTIONS);
      // The index saw the file change; the story says nothing of it.
      expect(deltas[1]?.modified.map(({ after }) => after.kind)).toEqual(["file"]);
      expect(story.thread.turns[1]?.events).toEqual([]);
      const events = story.thread.turns.flatMap((turn) => turn.events);
      expect(events.filter((event) => event.kind === "amend")).toEqual([]);
      expect(writes(story.thread.turns[2]?.events)).toEqual([
        "folder src/deep#folder:deep <- src#folder:src",
        "file src/deep/n.ts#file:n.ts <- src/deep#folder:deep",
        "function src/deep/n.ts#function:n <- src/deep/n.ts#file:n.ts",
      ]);
      expect(writes(story.thread.turns[3]?.events)).toEqual([
        "file src/deep/o.ts#file:o.ts <- src/deep#folder:deep",
        "function src/deep/o.ts#function:o <- src/deep/o.ts#file:o.ts",
      ]);
      // Containment is the parent, never a link.
      expect(events.some((event) => event.kind === "link" && event.from.includes("#folder:"))).toBe(
        false,
      );
      expectReplayable(story.memory, story.thread);
      // The graph labels and groups written notes from the events.
      // Cast while this worktree's graph predates the contract and failure link kinds.
      type GraphMemory = Parameters<typeof readingAt>[0];
      type GraphThread = Parameters<typeof readingAt>[1];
      const reading = readingAt(
        story.memory as GraphMemory,
        story.thread as unknown as GraphThread,
        3,
        { depth: 1, thisTurnOnly: false },
      );
      expect(reading.state.byId.get("src/deep/o.ts#function:o")).toMatchObject({
        name: "o",
        group: "src/deep/o.ts",
      });
    } finally {
      repo.remove();
    }
  });

  it("links and unlinks per kind: a call removed under a standing reference breaks the call only", async () => {
    const repo = tempRepo();
    try {
      const root = repo.commit({ "README.md": "start\n" }, "start");
      repo.commit(
        { "src/m.ts": "export function f() {}\nexport function g() {\n  f();\n  run(f);\n}\n" },
        "call and pass f",
      );
      const last = repo.commit(
        { "src/m.ts": "export function f() {}\nexport function g() {\n  run(f);\n}\n" },
        "stop calling f",
      );
      const { story } = await buildStory(repo.dir, root, last, OPTIONS);
      const g = "src/m.ts#function:g";
      const f = "src/m.ts#function:f";
      expect(
        story.thread.turns[0]?.events.filter(
          (event) => event.kind === "link" && event.from === g && event.to === f,
        ),
      ).toEqual([
        { kind: "link", from: g, to: f, linkKind: "calls", resolution: "exact" },
        { kind: "link", from: g, to: f, linkKind: "references", resolution: "exact" },
      ]);
      expect(story.thread.turns[1]?.events).toEqual([
        {
          kind: "amend",
          note: g,
          name: "g",
          group: "src/m.ts",
          parent: "src/m.ts#file:m.ts",
          range: { startLine: 2, endLine: 4 },
          signature: "function g()",
          noteKind: "function",
        },
        { kind: "unlink", from: g, to: f, linkKind: "calls", resolution: "exact" },
      ]);
    } finally {
      repo.remove();
    }
  });
});

describe("design facts in a story", () => {
  const BOUNDARIES = JSON.stringify({
    layers: [
      { name: "model", paths: ["src/model"] },
      { name: "view", paths: ["src/view"] },
    ],
    allowed: [["view", "model"]],
  });

  it("writes a symbol with its signature and doc", async () => {
    const repo = tempRepo();
    try {
      const root = repo.commit({ "README.md": "start\n" }, "start");
      const last = repo.commit(
        {
          "src/m.ts":
            "/** Adds them. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n",
        },
        "add",
      );
      const { story } = await buildStory(repo.dir, root, last, OPTIONS);
      expect(story.thread.turns[0]?.events).toContainEqual({
        kind: "write",
        note: "src/m.ts#function:add",
        name: "add",
        group: "src/m.ts",
        parent: "src/m.ts#file:m.ts",
        range: { startLine: 2, endLine: 4 },
        signature: "function add(a: number, b: number): number",
        doc: "Adds them.",
        noteKind: "function",
      });
    } finally {
      repo.remove();
    }
  });

  it("carries the boundaries declared under the paths' root at the last commit", async () => {
    const repo = tempRepo();
    try {
      const root = repo.commit({ "README.md": "start\n" }, "start");
      const last = repo.commit(
        { "app/.atlas/boundaries.json": BOUNDARIES, "app/src/model/a.ts": "export const A = 1;\n" },
        "declare",
      );
      const { story } = await buildStory(repo.dir, root, last, { ...OPTIONS, paths: ["app"] });
      expect(story.boundaries).toEqual({
        layers: [
          { name: "model", paths: ["app/src/model"] },
          { name: "view", paths: ["app/src/view"] },
        ],
        allowed: [["view", "model"]],
      });
    } finally {
      repo.remove();
    }
  });

  it("reads a boundaries file from disk when given, relative to where it sits", async () => {
    const repo = tempRepo();
    try {
      const root = repo.commit({ "README.md": "start\n" }, "start");
      const last = repo.commit({ "app/src/model/a.ts": "export const A = 1;\n" }, "code");
      const file = `${repo.dir}/app/.atlas/boundaries.json`;
      repo.commit({ "app/.atlas/boundaries.json": BOUNDARIES }, "declare later");
      const { story } = await buildStory(repo.dir, root, last, {
        ...OPTIONS,
        paths: ["app"],
        boundariesFile: file,
      });
      expect(story.boundaries?.layers[0]).toEqual({ name: "model", paths: ["app/src/model"] });
    } finally {
      repo.remove();
    }
  });

  it("warns and carries none when the file does not hold together", async () => {
    const repo = tempRepo();
    try {
      const root = repo.commit({ "README.md": "start\n" }, "start");
      const last = repo.commit(
        { ".atlas/boundaries.json": '{ "layers": [], "allowed": [["a", "b"]] }' },
        "broken",
      );
      const { story } = await buildStory(repo.dir, root, last, OPTIONS);
      expect(story.boundaries).toBeUndefined();
      expect("boundaries" in story).toBe(false);
    } finally {
      repo.remove();
    }
  });
});

describe("resolution on link events", () => {
  it("links a standing link again when a second candidate makes it a guess", async () => {
    const repo = tempRepo();
    try {
      const root = repo.commit({ "README.md": "start\n" }, "start");
      repo.commit(
        {
          "src/a.ts": "export function helper() {}\n",
          "src/b.ts": "export function use() {\n  helper();\n}\n",
        },
        "one helper",
      );
      const last = repo.commit({ "src/c.ts": "export function helper() {}\n" }, "a second helper");
      const { story } = await buildStory(repo.dir, root, last, OPTIONS);
      const use = "src/b.ts#function:use";
      const links = (turn: number) =>
        story.thread.turns[turn]?.events.filter(
          (event) => event.kind === "link" && event.from === use,
        );
      expect(links(0)).toEqual([
        {
          kind: "link",
          from: use,
          to: "src/a.ts#function:helper",
          linkKind: "calls",
          resolution: "exact",
        },
      ]);
      // The new candidate is linked, and the standing link is linked again as a guess.
      expect(links(1)).toEqual([
        {
          kind: "link",
          from: use,
          to: "src/c.ts#function:helper",
          linkKind: "calls",
          resolution: "heuristic",
        },
        {
          kind: "link",
          from: use,
          to: "src/a.ts#function:helper",
          linkKind: "calls",
          resolution: "heuristic",
        },
      ]);
    } finally {
      repo.remove();
    }
  });
});

describe("a story between diverged refs", () => {
  it("starts from the first ref itself, not the merge base", async () => {
    const repo = tempRepo();
    try {
      repo.commit({ "src/shared.ts": "export function shared() {}\n" }, "base");
      repo.git("checkout", "-q", "-b", "side");
      const side = repo.commit({ "src/side.ts": "export function sideOnly() {}\n" }, "side");
      repo.git("checkout", "-q", "main");
      repo.commit({ "src/b.ts": "export function b() {\n  shared();\n}\n" }, "add b");
      const tip = repo.commit({ "src/c.ts": "export function c() {}\n" }, "add c");

      const { story } = await buildStory(repo.dir, side, tip, OPTIONS);
      const start = (await buildIndex(repo.dir, side, OPTIONS)).indexer.snapshot("x", side);
      expect(story.memory.notes.map((note) => note.id).toSorted()).toEqual(
        [
          ...start.symbols.map((symbol) => symbol.id),
          ...start.frontier.map((symbol) => symbol.id),
        ].toSorted(),
      );
      expect(
        story.memory.links.map((link) => `${link.from} ${link.kind} ${link.to}`).toSorted(),
      ).toEqual(start.edges.map((edge) => `${edge.from} ${edge.kind} ${edge.to}`).toSorted());
      // Only the tip's own first-parent commits are turns; the first carries leaving `side`.
      expect(story.thread.turns.map((turn) => turn.label)).toEqual(["add b", "add c"]);
      expect(story.thread.turns[0]?.events).toContainEqual({
        kind: "unlink",
        from: "src/side.ts#file:side.ts",
        to: "src/side.ts#function:sideOnly",
        linkKind: "exports",
        resolution: "exact",
      });
      expect(story.removed).toContain("src/side.ts#function:sideOnly");
    } finally {
      repo.remove();
    }
  });
});

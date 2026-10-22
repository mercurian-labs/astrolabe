import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

import type { CodeStory } from "./story.ts";

const fixturesDir = NodeURL.fileURLToPath(new URL("../fixtures/", import.meta.url));
const stories = NodeFS.readdirSync(fixturesDir)
  .filter((name) => name.endsWith(".story.json"))
  .toSorted();

describe("the committed story fixtures", () => {
  it("are the three stories", () => {
    expect(stories).toEqual([
      "aider.story.json",
      "graph-model.story.json",
      "graph-view.story.json",
    ]);
  });

  it.each(stories)(
    "%s says where it was read from, by commit, with each symbol's lines",
    (name) => {
      const story = JSON.parse(
        NodeFS.readFileSync(NodePath.join(fixturesDir, name), "utf8"),
      ) as CodeStory;
      expect(NodePath.isAbsolute(story.source.repo)).toBe(true);
      expect(story.source.paths.length).toBeGreaterThan(0);
      for (const turn of story.thread.turns) expect(turn.id).toMatch(/^[0-9a-f]{40}$/);

      const isFolder = (kind: string | undefined) => kind === "folder" || kind === "package";
      const lines = (range: { startLine: number; endLine: number } | undefined) =>
        range !== undefined && range.startLine >= 1 && range.endLine >= range.startLine;
      for (const note of story.memory.notes) {
        if (note.frontier) continue;
        // A Rust inline `mod` is a package with lines; a folder never has any.
        if (isFolder(note.kind) && note.range === undefined) continue;
        expect(lines(note.range), note.id).toBe(true);
      }
      for (const event of story.thread.turns.flatMap((turn) => turn.events)) {
        if (event.kind !== "write" && event.kind !== "amend") continue;
        if (isFolder(event.noteKind) && event.range === undefined) continue;
        expect(lines(event.range), event.note).toBe(true);
        if (event.signature !== undefined) expect(event.signature.length).toBeLessThanOrEqual(200);
        if (event.doc !== undefined) expect(event.doc.length).toBeLessThanOrEqual(400);
      }
      // Declared boundaries name only their own layers, under the story's paths.
      if (story.boundaries !== undefined) {
        const names = new Set(story.boundaries.layers.map((layer) => layer.name));
        for (const [from, to] of story.boundaries.allowed) {
          expect(names.has(from) && names.has(to)).toBe(true);
        }
        for (const path of story.boundaries.layers.flatMap((layer) => layer.paths)) {
          expect(story.source.paths.some((root) => path.startsWith(`${root}/`))).toBe(true);
        }
      }
    },
  );
});

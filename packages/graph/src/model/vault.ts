/**
 * Turns a flat vault of Markdown notes into a `Memory`. The index script reads
 * the files and hands their text here; nothing in this module touches a disk.
 *
 * - A note is a top-level `*.md` file; its name is the filename without `.md`.
 * - `[[Target]]`, `[[Target|alias]]`, `[[Target#heading]]`, and embeds all link to `Target`.
 * - A target no file holds is a red link and becomes a frontier note.
 * - A `*.skillmap.md` file is a lens, never a note: its YAML frontmatter lists
 *   typed edges `{ from, type, to, rationale }` and a `types` vocabulary.
 */
import { parse as parseYaml } from "yaml";

import type { LensEdge, Memory, MemoryLens, MemoryLink, MemoryNote } from "./memory.ts";

export interface VaultFile {
  /** The filename, without any directory. */
  readonly fileName: string;
  readonly text: string;
  readonly lastChanged?: string;
}

const SKILL_MAP_SUFFIX = ".skillmap.md";
/** Repository instructions, not knowledge. */
const NON_NOTES = new Set(["AGENTS.md", "CLAUDE.md", "README.md"]);

export const isNoteFile = (fileName: string) =>
  fileName.endsWith(".md") && !fileName.endsWith(SKILL_MAP_SUFFIX) && !NON_NOTES.has(fileName);

export const isSkillMapFile = (fileName: string) => fileName.endsWith(SKILL_MAP_SUFFIX);

/** Code never links: fenced blocks and inline spans are blanked before links are read. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** Every wikilink target in a note's text, in order of appearance, repeats included. */
export function wikilinkTargets(text: string): Array<string> {
  const targets: Array<string> = [];
  for (const match of stripCode(text).matchAll(/!?\[\[([^\]\n]+?)\]\]/g)) {
    const raw = match[1] ?? "";
    const target = (raw.split("|")[0] ?? "").split("#")[0]?.trim() ?? "";
    // A path link names its note by the last segment; notes are flat.
    const name = target.split("/").at(-1)?.trim() ?? "";
    if (name.length > 0) targets.push(name);
  }
  return targets;
}

function frontmatter(text: string): unknown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match === null ? {} : parseYaml(match[1] ?? "");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A skill map's lens, read from its frontmatter; malformed edges are skipped, not guessed. */
export function parseSkillMap(fileName: string, text: string): MemoryLens {
  const data = frontmatter(text);
  const record = isRecord(data) ? data : {};
  const name =
    typeof record.name === "string" ? record.name : fileName.slice(0, -SKILL_MAP_SUFFIX.length);
  const types: Record<string, string> = {};
  if (isRecord(record.types)) {
    for (const [type, meaning] of Object.entries(record.types)) {
      types[type] = typeof meaning === "string" ? meaning : "";
    }
  }
  const edges: Array<LensEdge> = [];
  for (const edge of Array.isArray(record.edges) ? record.edges : []) {
    if (!isRecord(edge)) continue;
    const { from, type, to, rationale } = edge;
    if (typeof from !== "string" || typeof type !== "string" || typeof to !== "string") continue;
    edges.push(typeof rationale === "string" ? { from, type, to, rationale } : { from, type, to });
  }
  return { name, types, edges };
}

/**
 * Index a vault's files. Link targets resolve to written notes ignoring case,
 * as the editor does; an unresolved target keeps its first spelling as the
 * frontier note's name. Output is sorted so the same vault indexes the same.
 */
export function indexVault(id: string, files: ReadonlyArray<VaultFile>): Memory {
  const noteFiles = files.filter((file) => isNoteFile(file.fileName));
  const written = new Map<string, MemoryNote>();
  for (const file of noteFiles) {
    const name = file.fileName.slice(0, -".md".length);
    written.set(
      name,
      file.lastChanged === undefined
        ? { id: name, name, frontier: false }
        : { id: name, name, frontier: false, lastChanged: file.lastChanged },
    );
  }
  const byLowerName = new Map([...written.keys()].map((name) => [name.toLowerCase(), name]));
  const frontier = new Map<string, MemoryNote>();
  const resolve = (target: string) => {
    const known = byLowerName.get(target.toLowerCase());
    if (known !== undefined) return known;
    byLowerName.set(target.toLowerCase(), target);
    frontier.set(target, { id: target, name: target, frontier: true });
    return target;
  };

  const linkKeys = new Set<string>();
  const links: Array<MemoryLink> = [];
  for (const file of noteFiles) {
    const from = file.fileName.slice(0, -".md".length);
    for (const target of wikilinkTargets(file.text)) {
      const to = resolve(target);
      if (to === from) continue;
      const key = `${from}\u0000${to}`;
      if (linkKeys.has(key)) continue;
      linkKeys.add(key);
      links.push({ from, to });
    }
  }

  const lenses = files
    .filter((file) => isSkillMapFile(file.fileName))
    .map((file) => parseSkillMap(file.fileName, file.text))
    .map((lens) => ({
      ...lens,
      edges: lens.edges.map((edge) => ({
        ...edge,
        from: resolve(edge.from),
        to: resolve(edge.to),
      })),
    }));

  const byName = (left: { name: string }, right: { name: string }) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  return {
    id,
    notes: [...written.values(), ...frontier.values()].toSorted(byName),
    links: links.toSorted((left, right) =>
      left.from === right.from ? (left.to < right.to ? -1 : 1) : left.from < right.from ? -1 : 1,
    ),
    lenses: lenses.toSorted(byName),
  };
}

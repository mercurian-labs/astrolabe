import { key, links, noteName, type WikiLink } from "./links.ts";
import { isMapFile, parseMap, type MapEdgeRef, type SkillMap } from "./skillMap.ts";

/** Operational files beside the notes; never knowledge. */
const RESERVED = new Set(["agents.md", "claude.md", "readme.md"]);

export const isWikiDocument = (file: string): boolean =>
  file.endsWith(".md") && !file.includes("/") && !RESERVED.has(key(file));

export interface WikiNote {
  readonly name: string;
  readonly file: string;
  readonly source: string;
  readonly links: ReadonlyArray<WikiLink>;
}

export interface WikiIndexError {
  readonly file: string;
  readonly error: string;
  readonly edge?: MapEdgeRef;
}

/**
 * The derived index over a wiki's files. It is always recomputable from the files and is never
 * written back; any doubt rebuilds it.
 */
export interface WikiIndex {
  readonly notes: ReadonlyMap<string, WikiNote>;
  readonly maps: ReadonlyMap<string, SkillMap>;
  readonly errors: ReadonlyArray<WikiIndexError>;
}

export type WikiFiles = Readonly<Record<string, string>>;

export class WikiCollisionError extends Error {
  override readonly name = "WikiCollisionError";
}

export function indexFiles(files: WikiFiles): WikiIndex {
  const notes = new Map<string, WikiNote>();
  const maps = new Map<string, SkillMap>();
  const errors: WikiIndexError[] = [];
  for (const [file, source] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isWikiDocument(file)) continue;
    if (isMapFile(file)) {
      try {
        maps.set(file, parseMap(source));
      } catch (error) {
        errors.push({ file, error: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    const name = noteName(file);
    if (notes.has(key(name)))
      throw new WikiCollisionError(`Case-insensitive note collision: ${file}`);
    notes.set(key(name), { name, file, source, links: links(source) });
  }
  const partial = { notes };
  for (const [file, map] of maps) {
    for (const edge of map.edges) {
      if (!support(partial, edge).length) {
        errors.push({ file, edge, error: `Missing prose link: ${edge.from} ↔ ${edge.to}` });
      }
    }
  }
  return { notes, maps, errors };
}

export interface ProseSupport {
  readonly note: string;
  readonly line: number;
  readonly prose: string;
}

/** The prose lines whose links, in either direction, hold a map edge up. */
export function support(
  index: Pick<WikiIndex, "notes">,
  edge: Pick<MapEdgeRef, "from" | "to">,
): ReadonlyArray<ProseSupport> {
  const result: ProseSupport[] = [];
  for (const [from, to] of [
    [edge.from, edge.to],
    [edge.to, edge.from],
  ] as const) {
    const note = index.notes.get(key(from));
    if (!note) continue;
    for (const link of note.links) {
      if (key(link.target) !== key(to)) continue;
      const start = note.source.lastIndexOf("\n", link.index) + 1;
      let end = note.source.indexOf("\n", link.index);
      if (end < 0) end = note.source.length;
      const line = note.source.slice(0, start).split("\n").length;
      if (!result.some((item) => item.note === note.name && item.line === line)) {
        result.push({ note: note.name, line, prose: note.source.slice(start, end) });
      }
    }
  }
  return result;
}

export interface UnresolvedNote {
  readonly name: string;
  readonly sources: ReadonlyArray<string>;
}

/** The frontier: names linked to that no note carries yet. */
export function unresolved(index: Pick<WikiIndex, "notes">): ReadonlyArray<UnresolvedNote> {
  const missing = new Map<string, { name: string; sources: string[] }>();
  for (const note of index.notes.values()) {
    for (const link of note.links) {
      if (index.notes.has(key(link.target))) continue;
      const entry = missing.get(key(link.target)) ?? { name: link.target, sources: [] };
      if (!entry.sources.includes(note.name)) entry.sources.push(note.name);
      missing.set(key(link.target), entry);
    }
  }
  return [...missing.values()];
}

export function backlinks(index: Pick<WikiIndex, "notes">, name: string): ReadonlyArray<string> {
  const sources: string[] = [];
  for (const note of index.notes.values()) {
    if (note.links.some((link) => key(link.target) === key(name))) sources.push(note.name);
  }
  return sources;
}

export function findMap(index: WikiIndex, name: string): readonly [string, SkillMap] | undefined {
  for (const entry of index.maps) {
    if (key(entry[0]) === key(name) || key(entry[1].name) === key(name)) return entry;
  }
  return undefined;
}

/** The map's arrangement as an indented text walk, roots first, unplaced cycles last. */
export function walk(map: SkillMap, index: Pick<WikiIndex, "notes">): string {
  const outgoing = new Map<string, MapEdgeRef[]>();
  const targets = new Set<string>();
  const names = new Map<string, string>();
  for (const edge of map.edges) {
    for (const name of [edge.from, edge.to]) names.set(key(name), name);
    const entries = outgoing.get(key(edge.from)) ?? [];
    entries.push(edge);
    outgoing.set(key(edge.from), entries);
    targets.add(key(edge.to));
  }
  const lines: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string, depth: number) => {
    const repeated = visited.has(key(name));
    const unwritten = index.notes.has(key(name)) ? "" : " (unwritten)";
    lines.push(`${"  ".repeat(depth)}${name}${unwritten}${repeated ? " (already shown)" : ""}`);
    if (repeated) return;
    visited.add(key(name));
    for (const edge of outgoing.get(key(name)) ?? []) visit(edge.to, depth + 1);
  };
  for (const [id, name] of names) if (!targets.has(id)) visit(name, 0);
  for (const [id, name] of names) if (!visited.has(id)) visit(name, 0);
  return lines.join("\n");
}

import { baseBlocks, baseProblems, isBaseFile } from "./bases.ts";
import { isCanvasFile, parseCanvas, type CanvasData } from "./canvas.ts";
import { canvasLinks, type CanvasLink } from "./canvasIndex.ts";
import { key, links, noteName, typedLinks, type WikiLink } from "./links.ts";
import {
  isWikiPath,
  linkFiles,
  resolveLink,
  unwrittenFile,
  type WikiLinkFiles,
} from "./resolveLink.ts";
import { isMapFile, parseMap, type MapEdgeRef, type SkillMap } from "./skillMap.ts";

/** Operational files beside the notes; never knowledge. */
const RESERVED = new Set(["agents.md", "claude.md", "readme.md"]);

/** A note, a skill map, a base or a canvas, in any folder. */
export const isWikiDocument = (file: string): boolean =>
  (file.endsWith(".md") || file.endsWith(".base") || file.endsWith(".canvas")) &&
  isWikiPath(file) &&
  !RESERVED.has(key(file.slice(file.lastIndexOf("/") + 1)));

export interface WikiNote {
  readonly name: string;
  readonly file: string;
  readonly source: string;
  readonly links: ReadonlyArray<WikiLink>;
}

/** A `.canvas` file. It is never a note, so no card can hold up a skill map's edge. */
export interface WikiCanvas {
  readonly file: string;
  readonly source: string;
  /** What draws; null when the file isn't JSON, which `errors` reports. */
  readonly data: CanvasData | null;
  readonly links: ReadonlyArray<CanvasLink>;
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
  /** By file, as are the rest: a document is its path, and a link only searches for one. */
  readonly notes: ReadonlyMap<string, WikiNote>;
  readonly maps: ReadonlyMap<string, SkillMap>;
  /** Each `.base` file's source; a base is checked when it is queried. */
  readonly bases: ReadonlyMap<string, string>;
  readonly canvases: ReadonlyMap<string, WikiCanvas>;
  /** Every document, as links search them. */
  readonly documents: WikiLinkFiles;
  readonly errors: ReadonlyArray<WikiIndexError>;
}

export type WikiFiles = Readonly<Record<string, string>>;

type Linkable = Pick<WikiIndex, "documents">;

/** The document a link written in `from` opens; null for a red link. */
export const linkedDocument = (
  index: Linkable,
  target: string,
  from: string | null,
): string | null => resolveLink(target, from, index.documents).file;

/** The file a name means: the document it finds, else where writing it would land. */
export const documentFile = (index: Linkable, name: string, from: string | null = null): string =>
  linkedDocument(index, name, from) ?? unwrittenFile(name, from);

/** Where a canvas's or note's link leads; a file card holds a path, so it's no search. */
export const linkDestination = (
  index: Linkable,
  link: { readonly target: string; readonly card?: "text" | "file" },
  from: string,
): string | null =>
  linkedDocument(index, link.card === "file" ? `/${link.target}` : link.target, from);

/** Whether a link leads to `file`, a red link by where writing it would land. */
const leadsTo = (
  index: Linkable,
  link: { readonly target: string; readonly card?: "text" | "file" },
  from: string,
  file: string,
): boolean => {
  const landed = linkDestination(index, link, from);
  return landed === null ? key(unwrittenFile(link.target, from)) === key(file) : landed === file;
};

export function indexFiles(files: WikiFiles): WikiIndex {
  const notes = new Map<string, WikiNote>();
  const maps = new Map<string, SkillMap>();
  const bases = new Map<string, string>();
  const canvases = new Map<string, WikiCanvas>();
  const errors: WikiIndexError[] = [];
  const entries = Object.entries(files).filter(([file]) => isWikiDocument(file));
  const documents = linkFiles(entries.map(([file]) => file));
  for (const [file, source] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    if (isBaseFile(file)) {
      bases.set(file, source);
      continue;
    }
    if (isCanvasFile(file)) {
      const parsed = parseCanvas(source);
      if (!parsed.ok) errors.push({ file, error: `Not valid JSON: ${parsed.error}` });
      const data = parsed.ok ? parsed.data : null;
      canvases.set(file, {
        file,
        source,
        data,
        links: data === null ? [] : canvasLinks(data),
      });
      continue;
    }
    if (isMapFile(file)) {
      try {
        maps.set(file, parseMap(source));
      } catch (error) {
        errors.push({ file, error: error instanceof Error ? error.message : String(error) });
      }
      continue;
    }
    notes.set(file, { name: noteName(file), file, source, links: links(source) });
  }
  const linked = new Set<string>();
  for (const note of notes.values()) for (const link of note.links) linked.add(key(link.target));
  const named = (name: string) =>
    resolveLink(name, null, documents).file !== null || linked.has(key(name));
  for (const [file, source] of bases) {
    for (const error of baseProblems(source, named)) errors.push({ file, error });
  }
  for (const note of notes.values()) {
    for (const block of baseBlocks(note.source)) {
      for (const error of baseProblems(block, named)) errors.push({ file: note.file, error });
    }
  }
  const partial = { notes, documents };
  for (const [file, map] of maps) {
    for (const edge of map.edges) {
      if (!support(partial, edge, file).length) {
        errors.push({ file, edge, error: `Missing prose link: ${edge.from} ↔ ${edge.to}` });
      }
    }
  }
  return { notes, maps, bases, canvases, documents, errors };
}

export interface ProseSupport {
  readonly note: string;
  readonly line: number;
  readonly prose: string;
}

/** The prose lines whose links, in either direction, hold up an edge of the map in `mapFile`. */
export function support(
  index: Pick<WikiIndex, "notes" | "documents">,
  edge: Pick<MapEdgeRef, "from" | "to">,
  mapFile: string | null = null,
): ReadonlyArray<ProseSupport> {
  const result: ProseSupport[] = [];
  for (const [from, to] of [
    [edge.from, edge.to],
    [edge.to, edge.from],
  ] as const) {
    const note = index.notes.get(linkedDocument(index, from, mapFile) ?? "");
    if (!note) continue;
    const wanted = linkedDocument(index, to, mapFile);
    for (const link of note.links) {
      const landed = linkedDocument(index, link.target, note.file);
      // An edge can stand on a red link: then the two only have their spelling to agree on.
      if (wanted === null ? landed !== null || key(link.target) !== key(to) : landed !== wanted) {
        continue;
      }
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

/** The frontier: names linked to, from notes and text cards, that nothing carries yet. */
export function unresolved(
  index: Pick<WikiIndex, "notes" | "canvases" | "documents">,
): ReadonlyArray<UnresolvedNote> {
  const missing = new Map<string, { name: string; sources: string[] }>();
  const note = (target: string, file: string, source: string) => {
    if (linkedDocument(index, target, file) !== null) return;
    const entry = missing.get(key(target)) ?? { name: target, sources: [] };
    if (!entry.sources.includes(source)) entry.sources.push(source);
    missing.set(key(target), entry);
  };
  for (const { name, file, links } of index.notes.values()) {
    for (const link of links) note(link.target, file, name);
  }
  for (const canvas of index.canvases.values()) {
    for (const link of canvas.links) {
      if (link.card === "text") note(link.target, canvas.file, canvas.file);
    }
  }
  return [...missing.values()];
}

export function backlinks(
  index: Pick<WikiIndex, "notes" | "canvases" | "documents">,
  name: string,
): ReadonlyArray<string> {
  const file = documentFile(index, name);
  const sources: string[] = [];
  for (const note of index.notes.values()) {
    if (note.links.some((link) => leadsTo(index, link, note.file, file))) sources.push(note.name);
  }
  for (const canvas of index.canvases.values()) {
    if (canvas.links.some((link) => leadsTo(index, link, canvas.file, file))) {
      sources.push(canvas.file);
    }
  }
  return sources;
}

/** The types a note's links to `file` carry, its spellings of that link taken together. */
export function typesTo(
  index: Linkable,
  note: Pick<WikiNote, "file" | "source" | "links">,
  file: string,
): ReadonlyArray<string> | undefined {
  const typed = typedLinks(note.source, note.links).filter((link) =>
    leadsTo(index, link, note.file, file),
  );
  return typed.length === 0 ? undefined : [...new Set(typed.flatMap((link) => link.types))];
}

export function findMap(index: WikiIndex, name: string): readonly [string, SkillMap] | undefined {
  const { file } = resolveLink(name, null, linkFiles(index.maps.keys()));
  for (const entry of index.maps) {
    if (entry[0] === file || key(entry[1].name) === key(name)) return entry;
  }
  return undefined;
}

/** The map's arrangement as an indented text walk, roots first, unplaced cycles last. */
export function walk(
  map: SkillMap,
  index: Pick<WikiIndex, "notes" | "documents">,
  mapFile: string | null = null,
): string {
  const idOf = (name: string) => linkedDocument(index, name, mapFile) ?? key(name);
  const outgoing = new Map<string, MapEdgeRef[]>();
  const targets = new Set<string>();
  const names = new Map<string, string>();
  for (const edge of map.edges) {
    for (const name of [edge.from, edge.to]) names.set(idOf(name), name);
    const entries = outgoing.get(idOf(edge.from)) ?? [];
    entries.push(edge);
    outgoing.set(idOf(edge.from), entries);
    targets.add(idOf(edge.to));
  }
  const lines: string[] = [];
  const visited = new Set<string>();
  const visit = (name: string, depth: number) => {
    const id = idOf(name);
    const repeated = visited.has(id);
    const unwritten = index.notes.has(id) ? "" : " (unwritten)";
    lines.push(`${"  ".repeat(depth)}${name}${unwritten}${repeated ? " (already shown)" : ""}`);
    if (repeated) return;
    visited.add(id);
    for (const edge of outgoing.get(id) ?? []) visit(edge.to, depth + 1);
  };
  for (const [id, name] of names) if (!targets.has(id)) visit(name, 0);
  for (const [id, name] of names) if (!visited.has(id)) visit(name, 0);
  return lines.join("\n");
}
